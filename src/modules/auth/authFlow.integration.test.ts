import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@core/auth';
import { ApiFieldError } from '@core/api';
import {
  checkLogin,
  confirmOperation,
  getUserInfo,
  openSession,
  resendOperation,
  signin,
  signup,
} from './api/authApi';

/**
 * Сквозная проверка среза через реальный authApi + интерсепторы httpClient против MSW-сервера
 * (cookie-mode happy-path: refresh не дёргаем, access берётся из applyAccess). Проверяет, что
 * signin → confirm(204) → openSession(201) → getUserInfo связаны корректно и что неверный код
 * возвращает operation_state.
 */
describe('auth flow (signin → confirm → session → profile)', () => {
  beforeEach(() => {
    useAuthStore.getState().setAnonymous();
  });

  it('успешный вход открывает сессию и отдаёт профиль', async () => {
    const op = await signin('user@example.com');
    expect(op.token).toHaveLength(64);
    expect(op.confirm_method).toBe('EMAIL');
    expect(op.remaining_attempts).toBe(3);

    const next = await confirmOperation({ token: op.token, secret: '183947' });
    expect(next).toBeNull(); // 204 — подтверждено

    const result = await openSession({ token: op.token, secret: '183947' });
    expect(result.kind).toBe('access');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().accessToken).toBeTruthy();

    const user = await getUserInfo();
    expect(user.email).toBe('user@example.com');
    expect(user.realms[0]?.user_kind).toBe('standard');
    expect(user.status).toBe('ENABLED');
  });

  it('неверный код → ApiFieldError с operation_state и уменьшенным счётчиком', async () => {
    const op = await signin('user@example.com');
    await expect(confirmOperation({ token: op.token, secret: '000000' })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiFieldError &&
        e.operationState?.remaining_attempts === 2 &&
        e.fields[0]?.code === 'secret',
    );
  });

  it('регистрация создаёт операцию с confirm_method EMAIL и открывает сессию', async () => {
    const op = await signup('newuser@example.com');
    expect(op.token).toHaveLength(64);
    expect(op.confirm_method).toBe('EMAIL');
    expect(op.remaining_attempts).toBe(3);

    const confirmed = await confirmOperation({ token: op.token, secret: '183947' });
    expect(confirmed).toBeNull();

    const result = await openSession({ token: op.token, secret: '183947' });
    expect(result.kind).toBe('access');

    const user = await getUserInfo();
    expect(user.email).toBe('newuser@example.com');
  });

  it('check-login: свободный email → true (204)', async () => {
    await expect(checkLogin('brand-new@example.com')).resolves.toBe(true);
  });

  it('check-login: занятый email → ApiFieldError (400) с деталью под поле', async () => {
    await expect(checkLogin('taken@example.com')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code === 'user_login',
    );
  });

  it('signup с активным локом регистрации → ApiFieldError с бизнес-code (не поле формы)', async () => {
    await expect(signup('inprogress@example.com')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code !== 'user_email',
    );
  });

  it('resend возвращает новый WaitingConfirmOperation со сброшенными счётчиками', async () => {
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '000000' }).catch(() => undefined);
    const resent = await resendOperation({ token: op.token });
    expect(resent.remaining_attempts).toBe(3);
    expect(resent.remaining_resends).toBe(1);
  });
});
