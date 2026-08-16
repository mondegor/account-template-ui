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
import {
  applyOperation,
  applyPassword,
  applyRecoveryCodes,
  confirmOperation,
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
  return <div data-testid="loc">{useLocation().pathname}</div>;
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
  sessionStorage.clear();
  clearRecoveryCodes();
  useOperationStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated' });
  vi.mocked(confirmOperation).mockResolvedValue(null);
  vi.mocked(applyPassword).mockResolvedValue({ recovery_codes: CODES });
  vi.mocked(applyRecoveryCodes).mockResolvedValue({ recovery_codes: CODES });
  vi.mocked(applyOperation).mockResolvedValue(undefined);
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
   * Поток, экрана под который здесь нет (установка TOTP-генератора): вести операцию нечем, и
   * оставленная запись гоняла бы её между /confirm и этим экраном без выхода.
   */
  it('drops a flow it cannot run instead of leaving the record behind', async () => {
    saveSecurityFlow({ kind: 'totp' });
    useOperationStore.getState().dispatch(EMAIL_LINK);
    renderPage();

    expect(screen.getByTestId('loc')).toHaveTextContent('/settings');
    await waitFor(() => expect(loadSecurityFlow()).toBeNull());
    expect(useOperationStore.getState().snapshot).toBeNull();
  });
});
