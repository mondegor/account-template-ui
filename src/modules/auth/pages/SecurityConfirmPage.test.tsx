import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addTranslations, initI18n, setLanguage } from '@core/i18n';
import { useOperationStore } from '@core/operation';
import { moduleQueryKey } from '@core/module-registry';
import { useAuthStore } from '@core/auth';
import { tr } from '../../../test/i18n';
import { authTranslations } from '../i18n';
import { fillCode } from '../../../test/dom';
import { ApiFieldError } from '@core/api';
import {
  applyEmail,
  applyOperation,
  applyPassword,
  applyRecoveryCodes,
  confirmOperation,
  revokeOperation,
} from '../api/authApi';
import {
  areRecoveryCodesReissued,
  clearRecoveryCodes,
  getRecoveryCodes,
  setRecoveryCodes,
} from '../lib/recoveryCodes';
import { loadSecurityFlow, saveSecurityFlow } from '../lib/securityFlow';
import { SecurityConfirmPage } from './SecurityConfirmPage';

/**
 * Экран подтверждения security-операции: какой терминал он зовёт, куда уводит закрытую операцию и
 * что делает, когда операция ему не принадлежит. Сам ход подтверждения проверяется у общего экрана
 * (OperationConfirm) и у хука (useConfirmFlow) — здесь только специфика потока.
 */

vi.mock('../api/authApi', () => ({
  confirmOperation: vi.fn(),
  resendOperation: vi.fn(),
  revokeOperation: vi.fn(),
  applyPassword: vi.fn(),
  applyRecoveryCodes: vi.fn(),
  applyOperation: vi.fn(),
  applyEmail: vi.fn(),
  startRecoveryCodesReissue: vi.fn(),
}));

/** Набор от сервера — фикстура теста, поэтому литералы английские. */
const CODES = ['AAAA1111-BBBB2222', 'CCCC3333-DDDD4444'];

const EMAIL_LINK = {
  type: 'START' as const,
  parts: {
    token: 't'.repeat(64),
    confirm_method: 'EMAIL',
    remaining_attempts: 3,
    remaining_resends: 1,
    resends_in: 0,
    expires_in: 600,
  },
  now: Date.now(),
};

function LocationProbe() {
  const { pathname, hash, state } = useLocation();
  return (
    <>
      <div data-testid="loc">{pathname}</div>
      <div data-testid="hash">{hash}</div>
      <div data-testid="state">{JSON.stringify(state)}</div>
    </>
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/security/confirm']}>
        <Routes>
          <Route path="/security/confirm" element={<SecurityConfirmPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** Ввод кода и отправка — единственный жест экрана на звене с кодом из сообщения. */
function submit(code: string) {
  fillCode(code);
  fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.submit') }));
}

beforeAll(() => {
  setLanguage('en');
  initI18n();
  // Без словаря модуля tr() вернул бы сам ключ, и он же стоял бы на экране: проверка сравнивала
  // бы ключ с ключом и зеленела при любом тексте.
  addTranslations(authTranslations);
});

beforeEach(() => {
  // Счётчики вызовов считает каждый тест сам: без сброса «этот метод не звали» видел бы вызовы
  // соседнего теста.
  vi.clearAllMocks();
  sessionStorage.clear();
  clearRecoveryCodes();
  useOperationStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated' });
  vi.mocked(confirmOperation).mockResolvedValue(null);
  vi.mocked(applyPassword).mockResolvedValue({ recovery_codes: CODES });
  vi.mocked(applyRecoveryCodes).mockResolvedValue({ recovery_codes: CODES });
  vi.mocked(applyOperation).mockResolvedValue(undefined);
  vi.mocked(revokeOperation).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('SecurityConfirmPage', () => {
  /**
   * Установка пароля кончается своим apply-password, а выданный им набор — единственный: он ложится
   * в память вкладки и экран сменяется на его показ.
   */
  it('finishes the password flow with apply-password and shows the codes', async () => {
    saveSecurityFlow({ kind: 'password' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();
    expect(screen.getByText(tr('auth.security.password.title'))).toBeInTheDocument();

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/codes'));
    expect(applyPassword).toHaveBeenCalledWith({ token: EMAIL_LINK.parts.token });
    expect(getRecoveryCodes()).toEqual(CODES);
    // Первая выдача признака не ставит: набор у неё новый, а не заменённый.
    expect(areRecoveryCodesReissued()).toBe(false);
    // Запись потока гаснет вместе с операцией: следующий заход сюда не должен считать её своей.
    expect(loadSecurityFlow()).toBeNull();
  });

  /** Перевыпуск закрывается своим методом и приводит на тот же показ набора — но своими словами. */
  it('finishes the reissue with apply-recovery-codes', async () => {
    saveSecurityFlow({ kind: 'recovery-codes' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();
    expect(screen.getByText(tr('auth.security.recoveryCodes.title'))).toBeInTheDocument();

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/codes'));
    expect(applyRecoveryCodes).toHaveBeenCalledWith({ token: EMAIL_LINK.parts.token });
    // Без признака показ назвал бы заменённый набор первым и умолчал, что старые коды уже мертвы.
    expect(areRecoveryCodesReissued()).toBe(true);
  });

  /**
   * У отключения своего apply-метода нет — его закрывает универсальный apply-operation, и кодов оно
   * не выдаёт, поэтому возвращает в настройки. Профиль перечитывается: там состояние 2FA.
   */
  it('finishes the disable flow with apply-operation and refreshes the profile', async () => {
    saveSecurityFlow({ kind: 'disable2fa' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    const client = renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(applyOperation).toHaveBeenCalledWith({ token: EMAIL_LINK.parts.token });
    expect(getRecoveryCodes()).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moduleQueryKey('auth', 'user') });
  });

  /**
   * Подмена аварийным кодом положена только отключению: спека разрешает её входу и отключению 2FA и
   * прямо запрещает перевыпуску — тот заменяет сам набор и требует оба постоянных доказательства.
   */
  it.each([
    ['disable2fa' as const, true],
    ['recovery-codes' as const, false],
  ])('offers the recovery swap on %s: %s', async (kind, offered) => {
    saveSecurityFlow({ kind });
    useOperationStore.getState().dispatch({
      ...EMAIL_LINK,
      parts: { ...EMAIL_LINK.parts, confirm_method: 'PASSWORD' },
    });
    renderPage();

    const swap = screen.queryByRole('button', { name: tr('auth.confirm.mode.RECOVERY') });
    expect(Boolean(swap)).toBe(offered);
  });

  /**
   * Набор от прошлого потока переживает уход с показа: гасит его только «Я сохранил коды». Отключение
   * защиты отзывает коды на сервере, поэтому уводить на них — показывать мёртвый список под призывом
   * его сохранить.
   */
  it('drops the codes left over from an earlier flow when the protection goes off', async () => {
    setRecoveryCodes(CODES);
    saveSecurityFlow({ kind: 'disable2fa' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(getRecoveryCodes()).toBeNull();
  });

  /** Операции нет — заходить не на что. */
  it('leaves for the settings without an operation', () => {
    renderPage();

    expect(screen.getByTestId('loc')).toHaveTextContent('/settings');
  });

  /** Записи потока нет — операция чужая: вход и регистрацию ведёт /confirm. */
  it('hands an operation without a flow record over to /confirm', () => {
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    expect(screen.getByTestId('loc')).toHaveTextContent('/confirm');
  });

  /**
   * У подключения генератора терминала здесь нет: код с емаила операцию только подтверждает, а
   * применяет её экран привязки — туда и уходит токен последнего звена.
   */
  it('hands the confirmed token over to the totp screen instead of applying anything', async () => {
    saveSecurityFlow({ kind: 'totp' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();
    expect(screen.getByText(tr('auth.security.totp.title'))).toBeInTheDocument();

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/security/totp'));
    // Операция не применена ничем: включает 2FA уже apply-totp с кодом из приложения.
    expect(applyPassword).not.toHaveBeenCalled();
    expect(applyRecoveryCodes).not.toHaveBeenCalled();
    expect(applyOperation).not.toHaveBeenCalled();
    expect(getRecoveryCodes()).toBeNull();
    // Запись переживает переход вместе с токеном: без неё завершать операцию нечем.
    expect(loadSecurityFlow()).toEqual({ kind: 'totp', token: EMAIL_LINK.parts.token });
  });

  /**
   * Шаг 1 смены емаила кончается apply-email, который адрес ещё не меняет, а открывает подтверждение
   * нового: экран остаётся на месте, а поток переезжает на следующий вид вместе с новым адресом.
   */
  it('the first email step opens the confirmation of the new address in place', async () => {
    const NEW = {
      ...EMAIL_LINK.parts,
      confirm_method: 'EMAIL' as const,
      token: 's'.repeat(64),
      expires_in: 72 * 3600,
    };
    vi.mocked(applyEmail).mockResolvedValue(NEW);
    saveSecurityFlow({ kind: 'email', value: 'new@example.com' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();
    expect(screen.getByText(tr('auth.security.email.title'))).toBeInTheDocument();
    expect(screen.getByText(tr('auth.settings.title'))).toBeInTheDocument();

    submit('183947');

    await waitFor(() =>
      expect(
        screen.getByText(tr('auth.security.emailConfirm.hint.EMAIL', { value: 'new@example.com' })),
      ).toBeInTheDocument(),
    );
    expect(applyEmail).toHaveBeenCalledWith({ token: EMAIL_LINK.parts.token });
    expect(applyOperation).not.toHaveBeenCalled();
    expect(useOperationStore.getState().snapshot?.token).toBe(NEW.token);
    expect(loadSecurityFlow()).toEqual({ kind: 'email-confirm', value: 'new@example.com' });
    // Ступени сдвинулись: текущий адрес пройден, спрашивают новый.
    expect(screen.getByText(tr('auth.security.steps.new')).closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('the second email step applies the change and returns to the email card with the result', async () => {
    saveSecurityFlow({ kind: 'email-confirm', value: 'new@example.com' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(applyOperation).toHaveBeenCalledWith({ token: EMAIL_LINK.parts.token });
    expect(screen.getByTestId('hash')).toHaveTextContent('#email');
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({ contactDone: 'email' });
    expect(loadSecurityFlow()).toBeNull();
  });

  /**
   * К шагу 2 вернулись из профиля: путь шага 1 оттуда не виден, поэтому ступеней нет — указатель
   * с чужим путём назвал бы доказательство, которого человек не предъявлял.
   */
  it('the change resumed from the profile confirms the new address without steps', async () => {
    saveSecurityFlow({ kind: 'email-confirm-resume', value: 'new@example.com' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();
    expect(
      screen.getByText(tr('auth.security.emailConfirm.hint.EMAIL', { value: 'new@example.com' })),
    ).toBeInTheDocument();
    expect(screen.queryByText(tr('auth.security.steps.current'))).not.toBeInTheDocument();
    expect(screen.queryByText(tr('auth.security.steps.factor'))).not.toBeInTheDocument();
    expect(screen.queryByText(tr('auth.security.steps.new'))).not.toBeInTheDocument();

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(applyOperation).toHaveBeenCalledWith({ token: EMAIL_LINK.parts.token });
    expect(screen.getByTestId('hash')).toHaveTextContent('#email');
  });

  /** Адрес заняли, пока шло подтверждение: повтор ответит тем же — смену начинают заново. */
  it('a taken address at the end is a dead end, not a retry', async () => {
    const detail = 'This email was taken while the change was being confirmed';
    vi.mocked(applyOperation).mockRejectedValue(
      new ApiFieldError([{ code: 'EmailAlreadyExists', detail }], 400),
    );
    saveSecurityFlow({ kind: 'email-confirm', value: 'new@example.com' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    submit('183947');

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(useOperationStore.getState().snapshot?.phase).toBe('dead');
    expect(
      screen.queryByRole('button', { name: tr('auth.confirm.retryFinish') }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['PASSWORD', 'factor'],
    ['RECOVERY', 'recovery'],
  ])('the email-less change marks the current step by the link: %s', (method, step) => {
    saveSecurityFlow({ kind: 'email-recovery', value: 'new@example.com' });
    useOperationStore.getState().dispatch({
      ...EMAIL_LINK,
      parts: {
        ...EMAIL_LINK.parts,
        confirm_method: method,
        remaining_resends: undefined,
        resends_in: undefined,
      },
    });
    renderPage();

    expect(screen.getByText(tr(`auth.security.steps.${step}`)).closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('the phone flow names the number and returns to the phone card with the result', async () => {
    saveSecurityFlow({ kind: 'phone', value: '+7 912 345 67 89' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();
    expect(
      screen.getByText(tr('auth.security.phone.hint.EMAIL', { value: '+7 912 345 67 89' })),
    ).toBeInTheDocument();
    // Ступень у телефона одна — указателя нет.
    expect(screen.queryByText(tr('auth.security.steps.current'))).not.toBeInTheDocument();
    expect(screen.queryByText(tr('auth.security.steps.new'))).not.toBeInTheDocument();

    submit('183947');

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(screen.getByTestId('hash')).toHaveTextContent('#phone');
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({ contactDone: 'phone' });
  });

  /**
   * Отмена возвращает туда, откуда смену начали, — к карточке. Итога при этом нет: показывать
   * нечего, адрес остался прежним.
   */
  it('cancelling a contact flow returns to the card the change started from', async () => {
    saveSecurityFlow({ kind: 'email', value: 'new@example.com' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.revoke') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(revokeOperation).toHaveBeenCalledWith({ token: EMAIL_LINK.parts.token });
    expect(screen.getByTestId('hash')).toHaveTextContent('#email');
    // Итога у отмены нет: в записи истории пусто, и карточка ничего не покажет.
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toBeNull();
    expect(loadSecurityFlow()).toBeNull();
  });

  /**
   * Шаг 2 смены емаила уход переживает: сервер держит операцию долго и отдаёт её в профиле. Выход
   * с экрана там не отменяет её, а оставляет ждать — и ведёт туда же, к карточке, где она видна
   * вместе со сроком и отменой.
   */
  it('leaving the new-address step keeps the operation waiting', async () => {
    saveSecurityFlow({ kind: 'email-confirm', value: 'new@example.com' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.later') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(screen.getByTestId('hash')).toHaveTextContent('#email');
    expect(revokeOperation).not.toHaveBeenCalled();
    // Экран закрыт целиком: и запись потока, и снимок — иначе возврат через карточку столкнулся бы
    // со вчерашними счётчиками.
    expect(loadSecurityFlow()).toBeNull();
    expect(useOperationStore.getState().snapshot).toBeNull();
  });

  /**
   * Уход без отмены есть ровно у тех потоков, чья операция его переживает: сервер держит только
   * подтверждение нового адреса. Операция любого другого потока уходит вместе с экраном, и выход
   * у него один — отмена. Перечисление полное: поток, заведённый позже, попадёт в один из списков
   * осознанно, а не по умолчанию.
   */
  describe.each([
    ['email-confirm', true],
    ['email-recovery-confirm', true],
    ['email-confirm-resume', true],
    ['password', false],
    ['totp', false],
    ['recovery-codes', false],
    ['disable2fa', false],
    ['email', false],
    ['email-recovery', false],
    ['phone', false],
  ] as const)('the way out of %s', (kind, resumable) => {
    it(`offers ${resumable ? 'leaving' : 'only the cancellation'}`, () => {
      saveSecurityFlow({ kind, value: 'new@example.com' });
      useOperationStore.getState().dispatch(EMAIL_LINK);
      renderPage();

      const leaving = screen.queryByText(tr('auth.confirm.later'));
      const cancelling = screen.queryByText(tr('auth.confirm.revoke'));
      expect(Boolean(leaving)).toBe(resumable);
      expect(Boolean(cancelling)).toBe(!resumable);
    });
  });

  /**
   * У остальных потоков исход живёт на своём экране, и тот ждёт доведённую до конца операцию:
   * брошенной там делать нечего, поэтому отмена уводит в настройки.
   */
  it('cancelling a flow with a screen of its own still leaves for the settings', async () => {
    saveSecurityFlow({ kind: 'password' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: tr('auth.confirm.revoke') }));

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/settings'));
    expect(screen.getByTestId('hash')).toBeEmptyDOMElement();
    expect(applyPassword).not.toHaveBeenCalled();
  });
});
