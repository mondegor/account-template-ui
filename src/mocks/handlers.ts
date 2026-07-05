import { http, HttpResponse } from 'msw';
import { config } from '@config';
import type { SuccessAccess, UserInfo, WaitingConfirmOperation } from '@modules/auth';

/**
 * MSW-мок Auth API для вертикального среза. Держит операции и сессии в памяти.
 * Код подтверждения фиксированный — печатается в консоль (см. signin).
 */

const BASE = config.authApiBaseUrl; // '/api/auth'
const MOCK_CODE = '183947';

interface MockOperation {
  token: string;
  realm: string;
  login: string;
  remainingAttempts: number;
  remainingResends: number;
  resendsInSec: number;
  expiresInSec: number;
  createdAt: number;
  confirmed: boolean;
}

interface MockSession {
  access: string;
  user: UserInfo;
}

const operations = new Map<string, MockOperation>();
const sessionsByRefresh = new Map<string, MockSession>();
const userByAccess = new Map<string, UserInfo>();

function hex(len: number): string {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fieldError(code: string, detail: string, status = 400) {
  return HttpResponse.json(
    { status, instance: '', errors: [{ code, detail }], time: new Date().toISOString() },
    { status },
  );
}

function operationError(op: MockOperation, detail: string) {
  return HttpResponse.json(
    {
      status: 400,
      instance: '',
      operation_state: {
        remaining_attempts: op.remainingAttempts,
        remaining_resends: op.remainingResends,
        resends_in: op.resendsInSec,
        expires_in: op.expiresInSec,
      },
      errors: [{ code: 'secret', detail }],
      time: new Date().toISOString(),
    },
    { status: 400 },
  );
}

function problem(status: number, title: string, detail: string) {
  return HttpResponse.json(
    {
      title,
      status,
      detail,
      instance: '',
      time: new Date().toISOString(),
      error_trace_id: hex(16),
    },
    { status, headers: { 'Content-Type': 'application/problem+json;charset=UTF-8' } },
  );
}

function waiting(op: MockOperation, message: string): WaitingConfirmOperation {
  return {
    token: op.token,
    confirm_method: 'EMAIL',
    remaining_attempts: op.remainingAttempts,
    remaining_resends: op.remainingResends,
    resends_in: op.resendsInSec,
    expires_in: op.expiresInSec,
    message,
  };
}

function buildUser(op: MockOperation): UserInfo {
  const now = new Date().toISOString();
  const isEmail = op.login.includes('@');
  return {
    email: isEmail ? op.login : 'user@example.com',
    phone: isEmail ? undefined : op.login,
    lang: 'ru-RU',
    last_login_ip: '95.165.1.1',
    last_logged_at: now,
    auth_2fa_type: 'NONE',
    realms: [
      {
        name: op.realm,
        user_kind: 'standard',
        created_at: '2025-01-10T09:00:00.000+03:00',
        updated_at: now,
      },
    ],
    status: 'ENABLED',
    created_at: '2025-01-10T09:00:00.000+03:00',
    updated_at: now,
  };
}

export const handlers = [
  // --- Шаг 1 входа ---
  http.post(`${BASE}/v1/signin`, async ({ request }) => {
    const body = (await request.json()) as { realm?: string; user_login?: string };
    const login = (body.user_login ?? '').trim();
    if (!body.realm) return fieldError('realm', 'Realm обязателен');
    if (login.length < 7 || login.length > 64) {
      return fieldError('user_login', 'Укажите корректный email или телефон');
    }
    const op: MockOperation = {
      token: hex(64),
      realm: body.realm,
      login,
      remainingAttempts: 3,
      remainingResends: 2, // намеренно немного для демо состояний «последняя отправка» / «тупик»
      resendsInSec: 30,
      expiresInSec: 600,
      createdAt: Date.now(),
      confirmed: false,
    };
    operations.set(op.token, op);
    // eslint-disable-next-line no-console
    console.info(`[MSW] Код подтверждения для ${login}: ${MOCK_CODE}`);
    return HttpResponse.json(
      waiting(op, 'Для входа введите код, отправленный на ваш email/телефон'),
    );
  }),

  // --- Проверка доступности логина (для регистрации) ---
  http.post(`${BASE}/v1/check/check-login`, async ({ request }) => {
    const body = (await request.json()) as { realm?: string; user_login?: string };
    const login = (body.user_login ?? '').trim();
    if (!body.realm) return fieldError('realm', 'Realm обязателен');
    if (login.length < 7 || login.length > 64 || !login.includes('@')) {
      return fieldError('user_login', 'Укажите корректный email');
    }
    // Демо: зарезервированный «занятый» логин отдаёт 400, остальные свободны.
    if (login.toLowerCase() === 'taken@example.com') {
      return fieldError('user_login', 'Этот email уже зарегистрирован');
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Шаг 1 регистрации ---
  http.post(`${BASE}/v1/signup`, async ({ request }) => {
    const body = (await request.json()) as { realm?: string; user_email?: string };
    const email = (body.user_email ?? '').trim();
    if (!body.realm) return fieldError('realm', 'Realm обязателен');
    if (email.length < 7 || email.length > 64 || !email.includes('@')) {
      return fieldError('user_email', 'Укажите корректный email');
    }
    // Демо: распределённый лок регистрации (realm+email, 10 мин) → анти-спам-ошибка.
    if (email.toLowerCase() === 'inprogress@example.com') {
      return fieldError('signup', 'Заявка на регистрацию уже обрабатывается. Попробуйте позже.');
    }
    const op: MockOperation = {
      token: hex(64),
      realm: body.realm,
      login: email,
      remainingAttempts: 3,
      remainingResends: 2,
      resendsInSec: 30,
      expiresInSec: 600,
      createdAt: Date.now(),
      confirmed: false,
    };
    operations.set(op.token, op);
    // eslint-disable-next-line no-console
    console.info(`[MSW] Код подтверждения регистрации для ${email}: ${MOCK_CODE}`);
    return HttpResponse.json(
      waiting(op, 'Для завершения регистрации введите код, отправленный на ваш email'),
    );
  }),

  // --- Подтверждение кода ---
  http.patch(`${BASE}/v1/operation/confirm`, async ({ request }) => {
    const body = (await request.json()) as { token?: string; secret?: string };
    const op = body.token ? operations.get(body.token) : undefined;
    if (!op) return fieldError('token', 'Некорректный токен операции');
    if (op.remainingAttempts <= 0) return operationError(op, 'Попытки исчерпаны');

    if (body.secret === MOCK_CODE) {
      op.confirmed = true;
      return new HttpResponse(null, { status: 204 });
    }
    op.remainingAttempts -= 1;
    return operationError(op, 'Неверный код. Проверьте письмо и попробуйте ещё раз.');
  }),

  // --- Повторная отправка кода ---
  http.patch(`${BASE}/v1/operation/resend`, async ({ request }) => {
    const body = (await request.json()) as { token?: string };
    const op = body.token ? operations.get(body.token) : undefined;
    if (!op) return fieldError('token', 'Некорректный токен операции');
    if (op.remainingResends <= 0) {
      return operationError(op, 'Слишком частая повторная отправка. Попробуйте позже.');
    }
    op.remainingResends -= 1;
    op.resendsInSec = 30;
    op.expiresInSec = 600;
    op.remainingAttempts = 3;
    // eslint-disable-next-line no-console
    console.info(`[MSW] Повторный код для ${op.login}: ${MOCK_CODE}`);
    return HttpResponse.json(waiting(op, 'Код отправлен повторно'));
  }),

  // --- Отмена операции ---
  http.patch(`${BASE}/v1/operation/revoke`, async ({ request }) => {
    const body = (await request.json()) as { token?: string };
    if (body.token) operations.delete(body.token);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Открытие сессии ---
  http.post(`${BASE}/v1/session`, async ({ request }) => {
    const body = (await request.json()) as { token?: string; secret?: string };
    const op = body.token ? operations.get(body.token) : undefined;
    if (!op) return fieldError('token', 'Некорректный токен операции');
    if (!op.confirmed && body.secret !== MOCK_CODE) {
      return operationError(op, 'Операция не подтверждена');
    }

    const access = hex(64);
    const refresh = hex(64);
    const user = buildUser(op);
    sessionsByRefresh.set(refresh, { access, user });
    userByAccess.set(access, user);
    operations.delete(op.token);

    const payload: SuccessAccess = { access_token: access, expires_in: 1800 };
    const useCookie = request.headers.get('X-Use-Cookie') === 'true';
    if (useCookie) {
      return HttpResponse.json(payload, {
        status: 201,
        headers: { 'Set-Cookie': `RTID=${refresh}; Path=/; SameSite=Strict` },
      });
    }
    return HttpResponse.json({ ...payload, refresh_token: refresh }, { status: 201 });
  }),

  // --- Продление сессии (refresh) ---
  http.patch(`${BASE}/v1/session`, async ({ request, cookies }) => {
    let refresh: string | undefined = cookies.RTID;
    if (!refresh) {
      const body = (await request.json().catch(() => null)) as { refresh_token?: string } | null;
      refresh = body?.refresh_token;
    }
    const session = refresh ? sessionsByRefresh.get(refresh) : undefined;
    if (!refresh || !session) {
      return problem(401, 'Unauthorized', 'Сессия не найдена или refresh недействителен');
    }

    // Ротация: новый access + новый refresh, sid сохраняется (в моке не моделируем sid явно).
    userByAccess.delete(session.access);
    sessionsByRefresh.delete(refresh);
    const newAccess = hex(64);
    const newRefresh = hex(64);
    sessionsByRefresh.set(newRefresh, { access: newAccess, user: session.user });
    userByAccess.set(newAccess, session.user);

    const payload: SuccessAccess = { access_token: newAccess, expires_in: 1800 };
    if (cookies.RTID) {
      return HttpResponse.json(payload, {
        status: 200,
        headers: { 'Set-Cookie': `RTID=${newRefresh}; Path=/; SameSite=Strict` },
      });
    }
    return HttpResponse.json({ ...payload, refresh_token: newRefresh }, { status: 200 });
  }),

  // --- Закрытие сессии ---
  http.delete(`${BASE}/v1/session`, ({ cookies }) => {
    if (cookies.RTID) sessionsByRefresh.delete(cookies.RTID);
    return new HttpResponse(null, {
      status: 204,
      headers: { 'Set-Cookie': 'RTID=; Path=/; Max-Age=0' },
    });
  }),

  // --- Профиль текущего пользователя ---
  http.get(`${BASE}/v1/user`, ({ request }) => {
    const auth = request.headers.get('Authorization') ?? '';
    const access = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const user = userByAccess.get(access);
    if (!user) return problem(401, 'Unauthorized', 'Требуется авторизация');
    return HttpResponse.json(user);
  }),
];
