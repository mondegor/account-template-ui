import { authClient } from '@core/api';
import { realmProvider, tokenStorage, applyAccess } from '@core/auth';
import type {
  ConfirmOperationRequest,
  LoginByTokenRequest,
  OpenSessionResult,
  OperationTokenRequest,
  SuccessAccess,
  UserInfo,
  WaitingConfirmOperation,
} from './types';

/**
 * Тонкий слой над Auth API. realm подставляется из realmProvider (в UI не вводится).
 * Ошибки уже нормализованы интерсептором (ApiFieldError / ApiProblemError).
 */

/** Шаг 1 входа: инициирует операцию, сервер шлёт код. → WaitingConfirmOperation (200). */
export async function signin(userLogin: string): Promise<WaitingConfirmOperation> {
  const res = await authClient.post<WaitingConfirmOperation>('/v1/signin', {
    realm: realmProvider.getRealm(),
    user_login: userLogin,
  });
  return res.data;
}

/** Шаг 1 регистрации: создаёт операцию по email, сервер шлёт код. → WaitingConfirmOperation (200). */
export async function signup(userEmail: string): Promise<WaitingConfirmOperation> {
  const res = await authClient.post<WaitingConfirmOperation>('/v1/signup', {
    realm: realmProvider.getRealm(),
    user_email: userEmail,
  });
  return res.data;
}

/**
 * Проверка доступности логина для регистрации. 204 → свободно (true).
 * 400 (ApiFieldError) «занят/невалиден» НЕ глотаем — прокидываем вызывающему.
 * Поле запроса — `user_login` (схема CheckLogin), значение — тот же email.
 */
export async function checkLogin(userLogin: string): Promise<boolean> {
  const res = await authClient.post('/v1/check/check-login', {
    realm: realmProvider.getRealm(),
    user_login: userLogin,
  });
  return res.status === 204;
}

/** Подтверждение кода. 204 = операция подтверждена; 200 = следующее звено цепочки. */
export async function confirmOperation(
  req: ConfirmOperationRequest,
): Promise<WaitingConfirmOperation | null> {
  const res = await authClient.patch<WaitingConfirmOperation | ''>('/v1/operation/confirm', req);
  return res.status === 204 ? null : (res.data as WaitingConfirmOperation);
}

/** Повторная отправка кода. → новый WaitingConfirmOperation (сброс счётчиков). */
export async function resendOperation(
  req: OperationTokenRequest,
): Promise<WaitingConfirmOperation> {
  const res = await authClient.patch<WaitingConfirmOperation>('/v1/operation/resend', req);
  return res.data;
}

/** Отмена операции (204). */
export async function revokeOperation(req: OperationTokenRequest): Promise<void> {
  await authClient.patch('/v1/operation/revoke', req);
}

/**
 * Открытие сессии по подтверждённой операции. 200 = ещё подтверждение (2FA), 201 = токены.
 * Веб шлёт X-Use-Cookie: true — refresh уедет в HttpOnly-cookie RTID.
 */
export async function openSession(req: LoginByTokenRequest): Promise<OpenSessionResult> {
  const res = await authClient.post<WaitingConfirmOperation | SuccessAccess>('/v1/session', req, {
    headers: tokenStorage.useCookieHeader ? { 'X-Use-Cookie': 'true' } : undefined,
  });
  if (res.status === 201) {
    const access = res.data as SuccessAccess;
    applyAccess(access);
    return { kind: 'access', access };
  }
  return { kind: 'waiting', operation: res.data as WaitingConfirmOperation };
}

/** Профиль текущего пользователя. */
export async function getUserInfo(): Promise<UserInfo> {
  const res = await authClient.get<UserInfo>('/v1/user');
  return res.data;
}
