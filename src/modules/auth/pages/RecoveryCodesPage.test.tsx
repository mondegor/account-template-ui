import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { useOperationStore } from '@core/operation';
import { useAuthStore } from '@core/auth';
import { tr } from '../../../test/i18n';
import { authTranslations } from '../i18n';
import { getUserInfo, startRecoveryCodesReissue } from '../api/authApi';
import type { UserAuth2fa, UserInfo, WaitingConfirmOperation } from '../api/types';
import { clearRecoveryCodes, getRecoveryCodes, setRecoveryCodes } from '../lib/recoveryCodes';
import { loadSecurityFlow } from '../lib/securityFlow';
import { RecoveryCodesPage } from './RecoveryCodesPage';

/**
 * Единственный показ набора: ворота главной кнопки, отказ выноса кодов из вкладки и ветка «показ
 * уже закрыт». Сами коды — фикстура теста, поэтому литералы английские.
 */

vi.mock('../api/authApi', () => ({
  startRecoveryCodesReissue: vi.fn(),
  getUserInfo: vi.fn(),
}));

const CODES = ['AAAA1111-BBBB2222', 'CCCC3333-DDDD4444'];

/** Профиль — фикстура теста, поэтому литералы английские; от него здесь нужна одна 2FA. */
function profile(type: UserAuth2fa): UserInfo {
  return {
    email: 'user@example.com',
    lang: 'en-US',
    tz: 'Europe/London',
    auth_2fa_type: type,
    ...(type === 'NONE' ? {} : { recovery_codes_left: 5 }),
    realms: [
      { name: 'account-template/standard', user_kind: 'standard', created_at: '', updated_at: '' },
    ],
    status: 'ENABLED',
  };
}

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/security/codes']}>
        <Routes>
          <Route path="/security/codes" element={<RecoveryCodesPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const doneButton = () => screen.getByRole('button', { name: tr('auth.codes.done') });

/** Имя файла и адрес блоба — фикстуры теста, поэтому литералы английские. */
const FILE_NAME = 'recovery-codes.txt';
const BLOB_URL = 'blob:http://localhost/recovery-codes';

/**
 * Буфера обмена в jsdom нет — подменяем его целиком: отказ записи это отдельная ветка экрана, и
 * глобальная заглушка спрятала бы её.
 */
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
}

/**
 * Адресов блоба в jsdom нет вовсе — подменяем обе половины. Освобождение и возвращается наружу: оно
 * и есть предмет проверки — освободи адрес до того, как браузер дочитал блоб, и скачивание не
 * случится, а сказать об этом будет нечем.
 */
function stubObjectUrl() {
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => BLOB_URL),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  return revoke;
}

beforeAll(() => {
  setLanguage('en');
  initI18n();
  // Без словаря модуля tr() вернул бы сам ключ, и он же стоял бы на экране: проверка сравнивала
  // бы ключ с ключом и зеленела при любом тексте.
  addTranslations(authTranslations);
});

beforeEach(() => {
  sessionStorage.clear();
  clearRecoveryCodes();
  useOperationStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated' });
  vi.mocked(startRecoveryCodesReissue).mockReset();
  // Живой набор бывает только при включённой защите — с ним закрытая ветка и не рисуется.
  vi.mocked(getUserInfo).mockReset().mockResolvedValue(profile('PASSWORD'));
  stubClipboard(() => Promise.resolve());
});

afterEach(cleanup);

describe('RecoveryCodesPage', () => {
  /** Весь выданный набор показан целиком: это его единственный показ. */
  it('shows every issued code', () => {
    setRecoveryCodes(CODES);
    renderPage();

    const list = screen.getByTestId('recovery-codes');
    for (const code of CODES) expect(within(list).getByText(code)).toBeInTheDocument();
  });

  /**
   * Главная кнопка гасит список навсегда, поэтому до выноса кодов из вкладки она заперта: нажать её
   * вслепую — остаться без запасного входа.
   */
  it('keeps the main button locked until the codes leave the tab', async () => {
    setRecoveryCodes(CODES);
    renderPage();
    expect(doneButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.codes.copy') }));

    await waitFor(() => expect(doneButton()).toBeEnabled());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODES.join('\n'));
    // Знак сменился: копирование обязано ответить, иначе неясно, случилось ли оно.
    expect(screen.getByRole('button', { name: tr('auth.codes.copied') })).toBeInTheDocument();
  });

  /** Отказ буфера говорится строкой: молча запертая кнопка не объяснила бы, почему она заперта. */
  it('says out loud that the copy failed', async () => {
    setRecoveryCodes(CODES);
    stubClipboard(() => Promise.reject(new Error('denied')));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.codes.copy') }));

    expect(await screen.findByText(tr('auth.codes.copyFailed'))).toBeInTheDocument();
    expect(doneButton()).toBeDisabled();
  });

  /** Отказ после удачи снимает галочку: удачным было прошлое копирование, а не это. */
  it('takes the copied mark back when the next copy fails', async () => {
    setRecoveryCodes(CODES);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.codes.copy') }));
    const copied = await screen.findByRole('button', { name: tr('auth.codes.copied') });

    stubClipboard(() => Promise.reject(new Error('denied')));
    fireEvent.click(copied);

    expect(await screen.findByText(tr('auth.codes.copyFailed'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('auth.codes.copy') })).toBeInTheDocument();
  });

  /**
   * Второй способ вынести коды из вкладки. Молча не сработать ему нельзя: отказа скачивание не
   * бросает, а ворота главной кнопки открывает — и набор погас бы, ни разу никуда не попав.
   */
  it('clicks the download link from inside the document and frees the address after', async () => {
    setRecoveryCodes(CODES);
    const revoke = stubObjectUrl();
    const clicked: { name: string; href: string; inDocument: boolean }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({
        name: this.download,
        href: this.href,
        // Оторванную от документа ссылку часть браузеров не нажимает вовсе.
        inDocument: document.body.contains(this),
      });
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.codes.download') }));

    expect(clicked).toEqual([{ name: FILE_NAME, href: BLOB_URL, inDocument: true }]);
    expect(doneButton()).toBeEnabled();
    // Адрес переживает сам клик: блоб браузер читает уже после него.
    expect(revoke).not.toHaveBeenCalled();
    // Освобождается он следующим кадром, а ссылка в документе не задерживается.
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(BLOB_URL));
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });

  /** «Я сохранил коды» гасит набор и возвращает в настройки — показ на этом закрыт. */
  it('drops the codes and returns to the settings', async () => {
    setRecoveryCodes(CODES);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.codes.copy') }));
    await waitFor(() => expect(doneButton()).toBeEnabled());
    fireEvent.click(doneButton());

    expect(getRecoveryCodes()).toBeNull();
    expect(screen.getByTestId('loc')).toHaveTextContent('/settings');
  });

  /** Перевыпуск говорит о себе своим: старые коды после него не работают. */
  it('names the reissue by its own lead', () => {
    setRecoveryCodes(CODES, { reissued: true });
    renderPage();

    expect(screen.getByText(tr('auth.codes.leadReissued'))).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.codes.lead'))).not.toBeInTheDocument();
  });

  /**
   * Список жил в памяти вкладки и не пережил перезагрузку. Без этой ветки человек застал бы пустой
   * экран; выход отсюда один — перевыпустить набор.
   */
  it('offers a reissue once the showing is closed', async () => {
    const operation: WaitingConfirmOperation = {
      token: 't'.repeat(64),
      confirm_method: 'EMAIL',
      remaining_attempts: 3,
      remaining_resends: 1,
      resends_in: 0,
      expires_in: 600,
    };
    vi.mocked(startRecoveryCodesReissue).mockResolvedValue(operation);
    renderPage();
    expect(screen.getByText(tr('auth.codes.goneOnce'))).toBeInTheDocument();

    // Перевыпуск ждёт профиля: предлагать его, не зная про защиту, значит звать в отказ.
    fireEvent.click(await screen.findByRole('button', { name: tr('auth.codes.reissue') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/confirm'));
    expect(useOperationStore.getState().snapshot?.token).toBe(operation.token);
    expect(loadSecurityFlow()).toEqual({ kind: 'recovery-codes', token: undefined });
  });

  /**
   * Перевыпуск бывает только при включённой защите: по спеке его инициатор отвечает 409, пока
   * второго фактора нет. Кнопка, которой отказано заранее, тут не стоит — вместо неё дорога туда,
   * где защиту включают.
   */
  it('sends to the settings instead of a reissue that would be refused', async () => {
    vi.mocked(getUserInfo).mockResolvedValue(profile('NONE'));
    renderPage();

    expect(
      await screen.findByText(tr('auth.codes.goneNo2fa'), { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('auth.codes.goneSettingsLink') })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(
      screen.queryByRole('button', { name: tr('auth.codes.reissue') }),
    ).not.toBeInTheDocument();
    expect(startRecoveryCodesReissue).not.toHaveBeenCalled();
  });
});
