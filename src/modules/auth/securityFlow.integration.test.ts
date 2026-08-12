import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@core/auth';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { initI18n } from '@core/i18n';
import { resetMockState } from '@mocks/handlers';
import {
  applyOperation,
  applyPassword,
  applyRecoveryCodes,
  applyTotp,
  confirmOperation,
  getTotpQrCode,
  getTotpSecret,
  getUserInfo,
  openSession,
  signin,
  startDisable2fa,
  startPasswordSetup,
  startRecoveryCodesReissue,
  startTotpSetup,
} from './api/authApi';

/**
 * Сквозная проверка потоков тега Auth.Security через реальный authApi против MSW-сервера — тот же
 * приём, что в authFlow.integration.test.ts. Экранов у этих потоков ещё нет, поэтому связку
 * «инициатор → цепочка подтверждений → свой завершающий метод» больше проверить нечем.
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
    const op = await startPasswordSetup({ new_password: 'Str0ngPass!' });
    expect(op.confirm_method).toBe('EMAIL');

    const token = await confirmChain(op.token, [CODE]);
    const { recovery_codes } = await applyPassword({ token });
    expect(recovery_codes).toHaveLength(10);

    const user = await getUserInfo();
    expect(user.auth_2fa_type).toBe('PASSWORD');
    expect(user.recovery_codes_left).toBe(10);

    // Активный второй фактор не перезаписывается: сначала его нужно отключить.
    await expect(startPasswordSetup({ new_password: 'An0therPass!' })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 409,
    );
  });

  it('reissuing recovery codes asks for the email code and the second factor', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!' });
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
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    const op = await startDisable2fa();
    await applyOperation({ token: await confirmChain(op.token, [CODE, RECOVERY_CODE]) });

    const user = await getUserInfo();
    expect(user.auth_2fa_type).toBe('NONE');
    expect(user.recovery_codes_left).toBeUndefined();
  });

  /** Код одноразовый: принятый — он уходит из набора, и профиль сразу показывает остаток меньше. */
  it('an accepted recovery code leaves the set', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!' });
    await applyPassword({ token: await confirmChain(setup.token, [CODE]) });

    // Отключение ещё не завершено, поэтому второй фактор на месте и остаток виден.
    const op = await startDisable2fa();
    await confirmChain(op.token, [CODE, RECOVERY_CODE]);

    expect((await getUserInfo()).recovery_codes_left).toBe(9);
  });

  it('reissuing recovery codes does NOT take a recovery code instead of the second factor', async () => {
    const setup = await startPasswordSetup({ new_password: 'Str0ngPass!' });
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
    // Универсальный apply-operation тип totp не обслуживает вовсе: для него это ошибка
    // конфигурации сервера, а не отказ по правам.
    await expect(applyOperation({ token })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 500,
    );
  });

  it('a session cannot be opened on a security operation', async () => {
    const op = await startTotpSetup();
    const token = await confirmChain(op.token, [CODE]);
    await expect(openSession({ token })).rejects.toSatisfy(
      (e) => e instanceof ApiProblemError && e.status === 403,
    );
  });
});
