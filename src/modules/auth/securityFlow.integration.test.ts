import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@core/auth';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { initI18n } from '@core/i18n';
import { resetMockState } from '@mocks/handlers';
import {
  applyEmail,
  applyOperation,
  applyPassword,
  applyRecoveryCodes,
  applyTotp,
  confirmOperation,
  getTotpQrCode,
  getTotpSecret,
  getUserInfo,
  openSession,
  revokeOperation,
  signin,
  startDisable2fa,
  startEmailChange,
  startEmailChangeByRecovery,
  startPasswordSetup,
  startPhoneChange,
  startRecoveryCodesReissue,
  startTotpSetup,
} from './api/authApi';

/**
 * Сквозная проверка потоков тега Auth.Security через реальный authApi против MSW-сервера — тот же
 * приём, что в authFlow.integration.test.ts. Связка «инициатор → цепочка подтверждений → свой
 * завершающий метод» проверяется здесь целиком: экраны каждый видят только свой отрезок пути.
 */

const CODE = '183947';
const TOTP_CODE = '246810';
const RECOVERY_CODE = 'RECOVRY1-CODE0011';
/**
 * Секрет парольного звена — своя фикстура мока: код из сообщения короче минимальной длины пароля,
 * и одним значением на оба звена не обойтись. Пароль, установленный потоком, мок не запоминает.
 */
const PASSWORD = 'MockPass2026!';

async function authenticate() {
  useAuthStore.getState().setAnonymous();
  // getUserInfo применяет язык профиля через i18next — инстанс должен быть поднят. Идемпотентно.
  initI18n();
  const op = await signin('user@example.com');
  await confirmOperation({ token: op.token, secret: CODE });
  await openSession({ token: op.token });
}

/** Проходит цепочку звеньев подряд и возвращает токен ПОСЛЕДНЕГО: у каждого звена он свой. */
async function confirmChain(token: string, secrets: string[]): Promise<string> {
  let current = token;
  for (const secret of secrets) {
    const next = await confirmOperation({ token: current, secret });
    if (next) current = next.token;
  }
  return current;
}

describe('security flows (initiator → confirmation chain → apply)', () => {
  beforeEach(async () => {
    // Второй фактор переживает отдельный кейс, поэтому состояние возвращаем к начальному.
    resetMockState();
    await authenticate();
  });

  it('setting a password turns 2FA on and issues recovery codes', async () => {
    const op = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    expect(op.confirm_method).toBe('EMAIL');

    const token = await confirmChain(op.token, [CODE]);
    const { recovery_codes } = await applyPassword({ token });
    expect(recovery_codes).toHaveLength(10);

    const user = await getUserInfo();
    expect(user.auth_2fa_type).toBe('PASSWORD');
    expect(user.recovery_codes_left).toBe(10);

    // Активный второй фактор не перезаписывается: сначала его нужно отключить.
    await expect(startPasswordSetup({ new_password: 'An0therPass!42' })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 409,
    );
  });

  it('a password below STRONG is refused under the field', async () => {
    await expect(startPasswordSetup({ new_password: 'weakpass' })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'PasswordIsTooWeak/new_password',
    );
  });

  it('reissuing recovery codes asks for the email code and the second factor', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const op = await startRecoveryCodesReissue();
    const next = await confirmOperation({ token: op.token, secret: CODE });
    expect(next?.confirm_method).toBe('PASSWORD');
    // Звено второго фактора повторную отправку не поддерживает — полей резенда в ответе нет.
    expect(next?.remaining_resends).toBeUndefined();
    expect(next?.resends_in).toBeUndefined();

    const { recovery_codes } = await applyRecoveryCodes({
      token: await confirmChain(next!.token, [PASSWORD]),
    });
    expect(recovery_codes).toHaveLength(10);
  });

  it('the totp blank is readable only once the operation is confirmed', async () => {
    const op = await startTotpSetup();

    // Токен приходит path-параметром, поэтому имени поля у кода ошибки нет — общее уведомление.
    await expect(getTotpSecret(op.token)).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'OperationIsNotConfirmed',
    );

    const token = await confirmChain(op.token, [CODE]);
    const blank = await getTotpSecret(token);
    expect(blank.secret).toHaveLength(16);
    expect(blank.otpauth_uri).toContain(`secret=${blank.secret}`);
    expect((await getTotpQrCode(token)).type).toBe('image/png');

    await expect(applyTotp({ token, totp_code: '000000' })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'TOTPCodeIsIncorrect/totp_code',
    );

    await applyTotp({ token, totp_code: TOTP_CODE });
    expect((await getUserInfo()).auth_2fa_type).toBe('TOTP');
  });

  it('disabling 2FA takes a recovery code instead of the second factor', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const op = await startDisable2fa();
    await applyOperation({ token: await confirmChain(op.token, [CODE, RECOVERY_CODE]) });

    const user = await getUserInfo();
    expect(user.auth_2fa_type).toBe('NONE');
    expect(user.recovery_codes_left).toBeUndefined();
  });

  /** Код одноразовый: принятый — он уходит из набора, и профиль сразу показывает остаток меньше. */
  it('an accepted recovery code leaves the set', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    // Отключение ещё не завершено, поэтому второй фактор на месте и остаток виден.
    const op = await startDisable2fa();
    await confirmChain(op.token, [CODE, RECOVERY_CODE]);

    expect((await getUserInfo()).recovery_codes_left).toBe(9);
  });

  it('reissuing recovery codes does NOT take a recovery code instead of the second factor', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const op = await startRecoveryCodesReissue();
    const next = await confirmOperation({ token: op.token, secret: CODE });
    await expect(confirmOperation({ token: next!.token, secret: RECOVERY_CODE })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'ConfirmCodeIsIncorrect/secret',
    );
  });

  it('a terminal method refuses a token that belongs to another flow', async () => {
    const op = await startTotpSetup();
    const token = await confirmChain(op.token, [CODE]);

    await expect(applyPassword({ token })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 403,
    );
    // Универсальный apply-operation тип totp не применяет: у него свой завершающий метод.
    await expect(applyOperation({ token })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 403,
    );
  });

  it('a session cannot be opened on a security operation', async () => {
    const op = await startTotpSetup();
    const token = await confirmChain(op.token, [CODE]);
    await expect(openSession({ token })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 403,
    );
  });

  it('changing the email takes two operations: the address changes only after the second', async () => {
    const op = await startEmailChange({ new_email: 'new@example.com' });
    expect(op.confirm_method).toBe('EMAIL');

    const second = await applyEmail({ token: await confirmChain(op.token, [CODE]) });
    expect(second.confirm_method).toBe('EMAIL');
    // Подтверждение нового адреса ждёт человека долго — порядка трёх суток, а не минуты.
    expect(second.expires_in).toBeGreaterThan(24 * 60 * 60);
    expect((await getUserInfo()).email).toBe('user@example.com');

    await applyOperation({ token: await confirmChain(second.token, [CODE]) });
    expect((await getUserInfo()).email).toBe('new@example.com');
  });

  /** По этой записи карточка настроек возвращает человека к вводу кода — без лишнего запроса. */
  it('the pending confirmation of the new address is in the profile with its counters', async () => {
    const op = await startEmailChange({ new_email: 'new@example.com' });
    const second = await applyEmail({ token: await confirmChain(op.token, [CODE]) });

    const pending = (await getUserInfo()).pending_operations?.find(
      (o) => o.type === 'CHANGE_EMAIL_CONFIRM',
    );
    expect(pending).toMatchObject({
      token: second.token,
      extra_value: 'new@example.com',
      status: 'OPENED',
      confirm_method: 'EMAIL',
      remaining_attempts: second.remaining_attempts,
      remaining_resends: second.remaining_resends,
    });

    await revokeOperation({ token: second.token });
    const left = (await getUserInfo()).pending_operations ?? [];
    expect(left.some((o) => o.type === 'CHANGE_EMAIL_CONFIRM')).toBe(false);
  });

  /** Профиль ищет операции по логину аккаунта, а смена емаила меняет и логин. */
  it('a finished email change keeps the other pending operations in the profile', async () => {
    const phone = await startPhoneChange({ new_phone: '+7 912 345 67 89' });

    const op = await startEmailChange({ new_email: 'new@example.com' });
    const second = await applyEmail({ token: await confirmChain(op.token, [CODE]) });
    await applyOperation({ token: await confirmChain(second.token, [CODE]) });

    const user = await getUserInfo();
    expect(user.email).toBe('new@example.com');
    expect(user.pending_operations?.find((o) => o.type === 'CHANGE_PHONE')?.token).toBe(
      phone.token,
    );
  });

  it('a new change closes the one still waiting for its code', async () => {
    const first = await startEmailChange({ new_email: 'first@example.com' });
    const firstPending = await applyEmail({ token: await confirmChain(first.token, [CODE]) });

    const again = await startEmailChange({ new_email: 'second@example.com' });
    await applyEmail({ token: await confirmChain(again.token, [CODE]) });

    const pending = (await getUserInfo()).pending_operations ?? [];
    expect(pending.filter((o) => o.type === 'CHANGE_EMAIL_CONFIRM')).toHaveLength(1);
    await expect(confirmOperation({ token: firstPending.token, secret: CODE })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'OperationInvalid/token',
    );
  });

  it('turning 2FA on closes an email change in progress', async () => {
    const op = await startEmailChange({ new_email: 'new@example.com' });
    const second = await applyEmail({ token: await confirmChain(op.token, [CODE]) });

    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const pending = (await getUserInfo()).pending_operations ?? [];
    expect(pending.some((o) => o.type === 'CHANGE_EMAIL_CONFIRM')).toBe(false);
    await expect(confirmOperation({ token: second.token, secret: CODE })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'OperationInvalid/token',
    );
  });

  it('turning 2FA off closes an email change in progress', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const op = await startEmailChange({ new_email: 'new@example.com' });
    const second = await applyEmail({ token: await confirmChain(op.token, [CODE, PASSWORD]) });

    const disable = await startDisable2fa();
    await applyOperation({ token: await confirmChain(disable.token, [CODE, PASSWORD]) });

    const pending = (await getUserInfo()).pending_operations ?? [];
    expect(pending.some((o) => o.type === 'CHANGE_EMAIL_CONFIRM')).toBe(false);
    await expect(confirmOperation({ token: second.token, secret: CODE })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'OperationInvalid/token',
    );
  });

  it('with 2FA on, the first step asks for the second factor too', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const op = await startEmailChange({ new_email: 'new@example.com' });
    const next = await confirmOperation({ token: op.token, secret: CODE });
    expect(next?.confirm_method).toBe('PASSWORD');
    // Аварийный код вместо второго фактора смена емаила не принимает.
    await expect(confirmOperation({ token: next!.token, secret: RECOVERY_CODE })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'ConfirmCodeIsIncorrect/secret',
    );
  });

  it('without access to the email: the second factor, a recovery code, then the new address', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!42' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const op = await startEmailChangeByRecovery({ new_email: 'new@example.com' });
    expect(op.confirm_method).toBe('PASSWORD');
    const next = await confirmOperation({ token: op.token, secret: PASSWORD });
    expect(next?.confirm_method).toBe('RECOVERY');

    const second = await applyEmail({ token: await confirmChain(next!.token, [RECOVERY_CODE]) });
    await applyOperation({ token: await confirmChain(second.token, [CODE]) });
    expect((await getUserInfo()).email).toBe('new@example.com');
  });

  it('without 2FA there is no email-less path', async () => {
    await expect(startEmailChangeByRecovery({ new_email: 'new@example.com' })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 409,
    );
  });

  it('a taken or malformed email is refused under the field', async () => {
    await expect(startEmailChange({ new_email: 'taken@example.com' })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'EmailAlreadyExists/new_email',
    );
    await expect(startEmailChange({ new_email: 'not-an-email' })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'ValidateError/new_email',
    );
  });

  it('setting the phone is confirmed with the email code', async () => {
    const op = await startPhoneChange({ new_phone: '+7 912 345 67 89' });
    expect(op.confirm_method).toBe('EMAIL');

    await applyOperation({ token: await confirmChain(op.token, [CODE]) });
    expect((await getUserInfo()).phone).toBe('+7 912 345 67 89');
  });

  it('a pending phone change shows the new number in the profile', async () => {
    const op = await startPhoneChange({ new_phone: '+7 912 345 67 89' });

    const pending = (await getUserInfo()).pending_operations?.find(
      (o) => o.type === 'CHANGE_PHONE',
    );
    expect(pending).toMatchObject({ token: op.token, extra_value: '+7 912 345 67 89' });
  });

  it('a taken or malformed phone is refused under the field', async () => {
    await expect(startPhoneChange({ new_phone: '+7 (900) 000-00-00' })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'PhoneAlreadyExists/new_phone',
    );
    await expect(startPhoneChange({ new_phone: '+7 999 12' })).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'ValidateError/new_phone',
    );
  });
});
