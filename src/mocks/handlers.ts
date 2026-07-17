import { http, HttpResponse } from 'msw';
import { config } from '@config';
import type { SuccessAccess, UserInfo, UserSession, WaitingConfirmOperation } from '@modules/auth';

/**
 * MSW-мок Auth API для вертикального среза. Держит операции и сессии в памяти.
 * Код подтверждения фиксированный — печатается в консоль (см. signin).
 */

const BASE = config.authApiBaseUrl; // '/api/auth'
const MOCK_CODE = '183947';
/** Второй реалм пользователя — чтобы на /sessions было из чего выбирать. */
const SECOND_REALM = 'print-shop/admin';
/** Мок-онли: 0 = у пользователя один кабинет (UI без выбора кабинета). Живёт здесь, а не в config. */
const MOCK_MULTI_REALM = import.meta.env.VITE_MOCK_MULTI_REALM !== '0';

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
  /** Связь с записью в sessionsByRealm: переживает ротацию refresh (sid не меняется). */
  sessionId: string;
  realm: string;
}

const operations = new Map<string, MockOperation>();
const sessionsByRefresh = new Map<string, MockSession>();
const userByAccess = new Map<string, UserInfo>();
/** Открытые сессии по реалмам; сид создаётся лениво — при первом обращении к реалму. */
const sessionsByRealm = new Map<string, UserSession[]>();

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
  const isEmail = op.login.includes('@');
  const registered = '2025-01-10T09:00:00.000+03:00';
  const staffRegistered = '2025-03-02T14:30:00.000+03:00';
  return {
    email: isEmail ? op.login : 'user@example.com',
    phone: isEmail ? undefined : op.login,
    lang: 'ru-RU',
    auth_2fa_type: 'NONE',
    realms: [
      {
        name: op.realm,
        user_kind: 'standard',
        last_location: 'Moscow, RU',
        // buildUser зовётся в момент подтверждения входа — «последний вход» и есть этот вход,
        // иначе свежезалогинившийся видел бы в профиле вход, которого не было.
        last_logged_at: ago(0),
        created_at: registered,
        updated_at: registered,
      },
      // Второй кабинет — только в multi-режиме: без него UI показывает одиночный вариант
      // (в профиле один блок с заголовком «Учётная запись», на /sessions нет выбора кабинета).
      // Заодно это ветка «данных нет»: отсутствие last_location/last_logged_at даёт прочерки.
      ...(MOCK_MULTI_REALM
        ? [
            {
              name: SECOND_REALM,
              user_kind: 'staff',
              created_at: staffRegistered,
              updated_at: staffRegistered,
            },
          ]
        : []),
    ],
    status: 'ENABLED',
  };
}

/** ISO-время «N минут назад» — чтобы в сиде было и относительное («5 минут назад»), и абсолютное. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** ISO-время «через N минут» — expires_at сессий всегда в будущем. */
function ahead(minutes: number): string {
  return ago(-minutes);
}

function otherSession(s: Omit<UserSession, 'session_id' | 'is_current'>): UserSession {
  return { session_id: hex(8), is_current: false, ...s };
}

/** Чужие сессии реалма. Наборы разные, чтобы смена реалма в комбобоксе была заметна. */
function seedSessions(realm: string): UserSession[] {
  if (realm === SECOND_REALM) {
    return [
      otherSession({
        app_name: 'Web, Chrome',
        device_name: 'MacBook Pro',
        last_ip: '85.140.3.77',
        location: 'Moscow, Russia',
        created_at: ago(60 * 24 * 5),
        last_seen_at: ago(7),
        expires_at: ahead(60 * 24 * 25),
      }),
      // Без location — ветка «бэк не вычислил местоположение», в карточке прочерк.
      otherSession({
        app_name: 'API, curl',
        device_name: 'CI runner',
        last_ip: '10.8.0.14',
        created_at: ago(60 * 24 * 30),
        last_seen_at: ago(60 * 26),
        expires_at: ahead(60 * 24 * 1),
      }),
    ];
  }
  return [
    otherSession({
      app_name: 'Mobile, iOS',
      device_name: 'iPhone 14',
      last_ip: '31.173.80.7',
      location: 'Saint Petersburg, Russia',
      created_at: ago(60 * 24 * 3),
      last_seen_at: ago(4),
      expires_at: ahead(60 * 24 * 27),
    }),
    otherSession({
      app_name: 'Web, Firefox',
      device_name: 'Рабочий ноутбук',
      last_ip: '95.165.1.1',
      location: 'Moscow, Russia',
      created_at: ago(60 * 24 * 12),
      last_seen_at: ago(60 * 9),
      expires_at: ahead(60 * 24 * 18),
    }),
    otherSession({
      app_name: 'Web, Chrome',
      device_name: 'Домашний ПК',
      last_ip: '178.176.72.19',
      location: 'Kazan, Russia',
      created_at: ago(60 * 24 * 44),
      last_seen_at: ago(60 * 24 * 2),
      expires_at: ahead(60 * 24 * 10),
    }),
  ];
}

function realmSessions(realm: string): UserSession[] {
  let list = sessionsByRealm.get(realm);
  if (!list) {
    list = seedSessions(realm);
    sessionsByRealm.set(realm, list);
  }
  return list;
}

function bearer(request: Request): string {
  const auth = request.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

/** Пользователь по Bearer-токену; undefined → 401. */
function authUser(request: Request): UserInfo | undefined {
  return userByAccess.get(bearer(request));
}

/** Сессия, из которой пришёл запрос: относительно неё сервер считает is_current. */
function callerSession(request: Request): MockSession | undefined {
  const access = bearer(request);
  if (!access) return undefined;
  for (const session of sessionsByRefresh.values()) {
    if (session.access === access) return session;
  }
  return undefined;
}

/** Полное закрытие сессии: убираем и из списка реалма, и из access/refresh-хранилищ. */
function dropSession(refresh: string, session: MockSession): void {
  sessionsByRefresh.delete(refresh);
  userByAccess.delete(session.access);
  const list = sessionsByRealm.get(session.realm);
  if (list) {
    sessionsByRealm.set(
      session.realm,
      list.filter((s) => s.session_id !== session.sessionId),
    );
  }
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
    const sessionId = hex(8);
    const now = new Date().toISOString();
    sessionsByRefresh.set(refresh, { access, user, sessionId, realm: op.realm });
    userByAccess.set(access, user);
    // is_current в хранилище всегда false — GET /v1/sessions выставит его вызывающей сессии.
    realmSessions(op.realm).unshift({
      session_id: sessionId,
      app_name: 'Web, этот браузер',
      device_name: 'Текущее устройство',
      last_ip: '95.165.1.1',
      location: 'Moscow, Russia',
      created_at: now,
      last_seen_at: now,
      expires_at: ahead(60 * 24 * 30),
      is_current: false,
    });
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

    // Ротация: новый access + новый refresh, sid (sessionId) сохраняется — сессия та же.
    userByAccess.delete(session.access);
    sessionsByRefresh.delete(refresh);
    const newAccess = hex(64);
    const newRefresh = hex(64);
    sessionsByRefresh.set(newRefresh, { ...session, access: newAccess });
    userByAccess.set(newAccess, session.user);
    const current = realmSessions(session.realm).find((s) => s.session_id === session.sessionId);
    if (current) current.last_seen_at = new Date().toISOString();

    const payload: SuccessAccess = { access_token: newAccess, expires_in: 1800 };
    if (cookies.RTID) {
      return HttpResponse.json(payload, {
        status: 200,
        headers: { 'Set-Cookie': `RTID=${newRefresh}; Path=/; SameSite=Strict` },
      });
    }
    return HttpResponse.json({ ...payload, refresh_token: newRefresh }, { status: 200 });
  }),

  // --- Закрытие сессии (выход) ---
  http.delete(`${BASE}/v1/session`, async ({ request, cookies }) => {
    // Bearer обязателен (openapi: security bearerAuth, x-auth-scopes any-users) — в отличие от
    // PATCH /v1/session, который продлевает сессию как раз тогда, когда access уже протух.
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Требуется авторизация');
    let refresh: string | undefined = cookies.RTID;
    if (!refresh) {
      const body = (await request.json().catch(() => null)) as { refresh_token?: string } | null;
      refresh = body?.refresh_token;
    }
    const session = refresh ? sessionsByRefresh.get(refresh) : undefined;
    // Идемпотентно: неизвестный refresh — тоже 204, но чистим только то, что нашли.
    if (refresh && session) dropSession(refresh, session);
    return new HttpResponse(null, {
      status: 204,
      headers: { 'Set-Cookie': 'RTID=; Path=/; Max-Age=0' },
    });
  }),

  // --- Открытые сессии реалма ---
  http.get(`${BASE}/v1/sessions`, ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Требуется авторизация');
    const realm = new URL(request.url).searchParams.get('realm') ?? config.realm;
    // is_current — не хранимый флаг, а свойство ответа: «та ли это сессия, из которой спросили».
    const mine = callerSession(request);
    const list = realmSessions(realm).map((s) => ({
      ...s,
      is_current: s.session_id === mine?.sessionId,
    }));
    return HttpResponse.json(list);
  }),

  // --- Закрытие перечисленных сессий ---
  http.post(`${BASE}/v1/sessions/close`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Требуется авторизация');
    const body = (await request.json().catch(() => null)) as { session_ids?: string[] } | null;
    const ids = body?.session_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return fieldError('session_ids', 'Укажите хотя бы одну сессию');
    }

    const closing = new Set(ids);
    // Реальные сессии (с токенами) закрываем целиком через общий dropSession — он снимает и список
    // реалма, и access/refresh. Засеянные сессии-витрины токенов не имеют, поэтому список реалма
    // всё равно доводим отдельным проходом.
    for (const [refresh, session] of sessionsByRefresh) {
      if (closing.has(session.sessionId)) dropSession(refresh, session);
    }
    for (const [realm, list] of sessionsByRealm) {
      sessionsByRealm.set(
        realm,
        list.filter((s) => !closing.has(s.session_id)),
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Профиль текущего пользователя ---
  http.get(`${BASE}/v1/user`, ({ request }) => {
    const user = authUser(request);
    if (!user) return problem(401, 'Unauthorized', 'Требуется авторизация');
    return HttpResponse.json(user);
  }),
];
