import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { useOperationStore } from '@core/operation';
import { useAuthStore } from '@core/auth';
import { tr } from '../../../test/i18n';
import { fillCode } from '../../../test/dom';
import { authTranslations } from '../i18n';
import { applyTotp, getTotpQrCode, getTotpSecret, revokeOperation } from '../api/authApi';
import { clearRecoveryCodes, getRecoveryCodes } from '../lib/recoveryCodes';
import { loadSecurityFlow, saveSecurityFlow } from '../lib/securityFlow';
import { TotpSetupPage } from './TotpSetupPage';

/**
 * Экран привязки генератора: две дороги к одной заготовке (QR сразу, секрет по нажатию), доказательство
 * кодом из приложения и разбор отказов apply-totp. Что отдаёт сервер, решает спека — все четыре
 * ручки мокаем.
 */

vi.mock('../api/authApi', () => ({
  applyTotp: vi.fn(),
  getTotpQrCode: vi.fn(),
  getTotpSecret: vi.fn(),
  revokeOperation: vi.fn(),
  startTotpSetup: vi.fn(),
}));

/** Заготовка от сервера — фикстура теста, поэтому литералы английские. */
const TOKEN = 't'.repeat(64);
const SECRET = 'JBSWY3DPEHPK3PXP';
const OTPAUTH_URI = `otpauth://totp/app:user@example.com?issuer=app&secret=${SECRET}`;
const CODES = ['AAAA1111-BBBB2222', 'CCCC3333-DDDD4444'];
const CODE = '246810';
const WRONG_CODE_DETAIL = 'The code did not match — check the app';
const BLOB_URL = 'blob:totp-qr';

/** Запись в буфер — часть окружения, а не сервера: ветку отказа кейс задаёт этой подменой. */
const writeText = vi.fn<(value: string) => Promise<void>>();

/** Тело problem+json — фикстура теста; статус в нём и есть то, по чему экран выбирает ветку. */
const problem = (status: number, detail: string) =>
  new ApiProblemError({ title: 'Error', status, detail, instance: '', time: '' });

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/security/totp']}>
        <Routes>
          <Route path="/security/totp" element={<TotpSetupPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const submitButton = () => screen.getByRole('button', { name: tr('auth.totp.submit') });

/** Набирает код и отправляет форму. */
function submit(code = CODE) {
  fillCode(code, 'totp_code');
  fireEvent.click(submitButton());
}

beforeAll(() => {
  setLanguage('en');
  initI18n();
  // Без словаря модуля tr() вернул бы сам ключ, и он же стоял бы на экране: проверка сравнивала
  // бы ключ с ключом и зеленела при любом тексте.
  addTranslations(authTranslations);
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  clearRecoveryCodes();
  useOperationStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated' });
  saveSecurityFlow({ kind: 'totp', token: TOKEN });
  vi.mocked(getTotpQrCode).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  vi.mocked(getTotpSecret).mockResolvedValue({ secret: SECRET, otpauth_uri: OTPAUTH_URI });
  vi.mocked(applyTotp).mockResolvedValue({ recovery_codes: CODES });
  vi.mocked(revokeOperation).mockResolvedValue(undefined);
  // jsdom адресов для blob не заводит, а без них картинке нечего показывать.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => BLOB_URL),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(cleanup);

describe('TotpSetupPage', () => {
  /** Заготовка живёт внутри операции: без её токена показывать нечего и применять нечего. */
  it('leaves for the settings without a confirmed operation of its own', () => {
    saveSecurityFlow({ kind: 'totp' });
    renderPage();

    expect(screen.getByTestId('loc')).toHaveTextContent('/settings');
    expect(getTotpQrCode).not.toHaveBeenCalled();
  });

  /**
   * Основной путь — отсканировать код. Секрет строкой стоит за ссылкой, и до нажатия запрос за ним
   * не уходит вовсе: показанный секрет это ещё один путь его утечки.
   */
  it('loads the qr at once and the secret only when asked', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByAltText(tr('auth.totp.qrAlt'))).toBeInTheDocument());
    expect(getTotpQrCode).toHaveBeenCalledWith(TOKEN);
    expect(getTotpSecret).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.secretReveal') }));

    await waitFor(() => expect(screen.getByText(SECRET)).toBeInTheDocument());
    expect(getTotpSecret).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole('link', { name: tr('auth.totp.openInApp') })).toHaveAttribute(
      'href',
      OTPAUTH_URI,
    );
  });

  /** Без картинки ручной ввод — единственный оставшийся путь, и прятать его за ссылкой не за чем. */
  it('opens the secret by itself when the qr does not arrive', async () => {
    vi.mocked(getTotpQrCode).mockRejectedValue(problem(500, 'Service unavailable'));
    renderPage();

    await waitFor(() => expect(screen.getByText(tr('auth.totp.qrFailed'))).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(SECRET)).toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: tr('auth.totp.secretReveal') }),
    ).not.toBeInTheDocument();
  });

  /**
   * QR при этом жив, и основной путь остаётся открытым — поэтому отказ секрета говорится строкой на
   * месте значения, а не плашкой над всем экраном. Рядом повтор: запрос ленивый, сам он не
   * переспросит.
   */
  it('offers a retry right where the secret should have been', async () => {
    vi.mocked(getTotpSecret).mockRejectedValueOnce(problem(500, 'Service unavailable'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.secretReveal') }));
    await waitFor(() => expect(screen.getByText(tr('auth.totp.secretFailed'))).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.retrySecret') }));

    await waitFor(() => expect(screen.getByText(SECRET)).toBeInTheDocument());
  });

  /**
   * Отказать могут обе дороги к заготовке разом, и подпись у повторов одна — значит различать их
   * обязано доступное имя: иначе в списке ссылок два «Повторить» подряд неразличимы.
   */
  it('names the two retries apart when both blanks fail', async () => {
    vi.mocked(getTotpQrCode).mockRejectedValue(problem(500, 'Service unavailable'));
    vi.mocked(getTotpSecret).mockRejectedValue(problem(500, 'Service unavailable'));
    renderPage();

    await waitFor(() => expect(screen.getByText(tr('auth.totp.secretFailed'))).toBeInTheDocument());
    expect(screen.getByRole('button', { name: tr('auth.totp.retryQr') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.totp.retrySecret') })).toBeInTheDocument();
  });

  /**
   * Копирование обязано ответить, и отвечает ровно та кнопка, которую нажали: подменённая узлом,
   * она увела бы фокус на страницу у того, кто нажал её с клавиатуры.
   */
  it('answers the copy with the same button', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.secretReveal') }));
    await waitFor(() => expect(screen.getByText(SECRET)).toBeInTheDocument());
    const button = screen.getByRole('button', { name: tr('auth.totp.copy') });

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: tr('auth.totp.copied') })).toBe(button),
    );
    expect(writeText).toHaveBeenCalledWith(SECRET);
  });

  /** Буфер доступен не всегда — нужен защищённый контекст и разрешение браузера. */
  it('says so when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('Clipboard is not available'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.secretReveal') }));
    await waitFor(() => expect(screen.getByText(SECRET)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.copy') }));

    await waitFor(() => expect(screen.getByText(tr('auth.totp.copyFailed'))).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: tr('auth.totp.copied') })).not.toBeInTheDocument();
  });

  /** Код доказывает владение генератором: после него 2FA включена, а набор кодов выдан единожды. */
  it('applies the generator and hands the codes over to their showing', async () => {
    renderPage();

    submit();

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/codes'));
    expect(applyTotp).toHaveBeenCalledWith({ token: TOKEN, totp_code: CODE });
    expect(getRecoveryCodes()).toEqual(CODES);
    // Операция применена — запись потока больше не нужна и не должна встретить следующий заход.
    expect(loadSecurityFlow()).toBeNull();
  });

  /** Отправлять короче нечего: у формата нижняя граница совпадает с верхней. */
  it('keeps the button off until all six digits are typed', () => {
    renderPage();

    expect(submitButton()).toBeDisabled();
    fillCode('246', 'totp_code');
    expect(submitButton()).toBeDisabled();
    fillCode(CODE, 'totp_code');
    expect(submitButton()).toBeEnabled();
  });

  /** Вердикт по набранному: красит весь ряд и раскрывается строкой под ним. */
  it('puts the wrong code under the row and paints it', async () => {
    vi.mocked(applyTotp).mockRejectedValue(
      new ApiFieldError(
        [{ code: 'TOTPCodeIsIncorrect/totp_code', detail: WRONG_CODE_DETAIL }],
        400,
      ),
    );
    renderPage();

    submit('135791');

    await waitFor(() => expect(screen.getByText(WRONG_CODE_DETAIL)).toBeInTheDocument());
    expect(screen.getByTestId('field-totp_code-0')).toHaveAttribute('aria-invalid', 'true');
    // Экран остаётся рабочим: неверный код это отказ по значению, а не по самой операции.
    expect(submitButton()).toBeInTheDocument();
  });

  /**
   * Не отказ по значению, а состояние аккаунта: активный второй фактор не перезаписывается. Поэтому
   * у него своя плашка с дорогой туда, где отключают, а не строка под полем.
   */
  it('sends to the settings when 2FA got turned on meanwhile', async () => {
    vi.mocked(applyTotp).mockRejectedValue(problem(409, '2FA is already on'));
    renderPage();

    submit();

    await waitFor(() => expect(screen.getByText(tr('auth.totp.conflict'))).toBeInTheDocument());
    expect(screen.getByRole('link', { name: tr('auth.totp.conflictLink') })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.queryByTestId('field-totp_code')).not.toBeInTheDocument();
    // Применить эту операцию больше нечем, и запись потока держаться не за что: уйти отсюда можно
    // и мимо ссылки, а оставленная запись встретила бы следующий заход полной формой.
    await waitFor(() => expect(loadSecurityFlow()).toBeNull());
  });

  /** Тупик: заготовка генератора живёт внутри операции и умирает вместе с ней. */
  it('turns into a dead end when the operation is gone', async () => {
    vi.mocked(applyTotp).mockRejectedValue(
      new ApiFieldError(
        [{ code: 'OperationAlreadyExpired/token', detail: 'The operation has expired' }],
        400,
      ),
    );
    renderPage();

    submit();

    await waitFor(() => expect(screen.getByText(tr('auth.totp.gone'))).toBeInTheDocument());
    expect(screen.getByRole('button', { name: tr('auth.totp.restart') })).toBeInTheDocument();
    // Вводить больше нечего: этот токен сервер уже не примет.
    expect(screen.queryByTestId('field-totp_code')).not.toBeInTheDocument();
    // Уйти отсюда можно и мимо кнопки перезапуска — записи потока не за что держаться, иначе
    // следующий заход встретил бы полную форму с мёртвым токеном.
    expect(loadSecurityFlow()).toBeNull();
  });

  /**
   * 403 спека отдаёт на чужую операцию и на операцию не того типа: завершить её нельзя ничем, и
   * оставленное поле ввода звало бы перебирать коды до бесконечности.
   */
  it('turns into a dead end when the operation is not ours', async () => {
    vi.mocked(applyTotp).mockRejectedValue(problem(403, 'The operation belongs to someone else'));
    renderPage();

    submit();

    await waitFor(() => expect(screen.getByText(tr('auth.totp.gone'))).toBeInTheDocument());
    expect(screen.queryByTestId('field-totp_code')).not.toBeInTheDocument();
  });

  /**
   * Заготовку отдаёт та же операция, поэтому её смерть видна и до ввода кода. Иначе экран остался бы
   * с «Повторить», которое не может сработать ни разу.
   */
  it('turns into a dead end when the blank itself says the operation is gone', async () => {
    vi.mocked(getTotpQrCode).mockRejectedValue(problem(400, 'The operation is invalid'));
    vi.mocked(getTotpSecret).mockRejectedValue(
      new ApiFieldError([{ code: 'OperationInvalid', detail: 'The operation is invalid' }], 400),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText(tr('auth.totp.gone'))).toBeInTheDocument());
    expect(screen.queryByText(tr('auth.totp.secretFailed'))).not.toBeInTheDocument();
    expect(loadSecurityFlow()).toBeNull();
  });

  /** Раскрытый секрет уже переписывают в приложение: удавшийся повтор QR не вправе его схлопнуть. */
  it('keeps the secret open after the qr retry succeeds', async () => {
    vi.mocked(getTotpQrCode).mockRejectedValueOnce(problem(500, 'Service unavailable'));
    renderPage();

    await waitFor(() => expect(screen.getByText(SECRET)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.retryQr') }));

    await waitFor(() => expect(screen.getByAltText(tr('auth.totp.qrAlt'))).toBeInTheDocument());
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  /** Брошенное подключение не оставляет за собой ни живой операции, ни записи потока. */
  it('revokes the operation on cancel', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.totp.cancel') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(revokeOperation).toHaveBeenCalledWith({ token: TOKEN });
    expect(loadSecurityFlow()).toBeNull();
  });
});
