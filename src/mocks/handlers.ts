import { http, HttpResponse } from 'msw';
import { config } from '@config';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  findLanguage,
  findTimeZone,
  resolveTimeZone,
} from '@core/i18n';
import { isoIn, matchHeaderTz } from './serverTime';
import type {
  SuccessAccess,
  UserAuth2fa,
  UserInfo,
  UserSession,
  WaitingConfirmOperation,
} from '@modules/auth';

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

/**
 * Мок-онли: зона, которую «сервер не знает». В справочнике фронта она есть, поэтому её видно
 * в селекте, а сохранение возвращает 400 по полю `tz` — так руками проверяется ветка, ради которой
 * явные значения и объявлены строгими: список фронта — копия серверного и однажды может от него
 * отстать (зону убрали на бэке, файл ещё не пересобрали).
 *
 * Выбрана «(UTC-12:00) Линия перемены дат»: постоянного населения там нет, так что случайно
 * наткнуться на неё почти невозможно.
 */
const MOCK_REJECTED_TZ = 'Etc/GMT+12';

/**
 * Мок-онли: язык, который «сервер не знает», — та же ветка, что у MOCK_REJECTED_TZ, но для поля
 * `lang`. Языков в справочнике всего два, лишний добавить некуда, поэтому отвергается
 * английский — и потому это за флагом, выключенным по умолчанию: иначе в демо нельзя было бы
 * сохранить английский язык профиля. VITE_MOCK_REJECT_LANG=1 включает ветку, когда её надо
 * посмотреть руками: выбрал «English» → Сохранить → 400 по полю. На язык интерфейса это не
 * влияет в любом случае — им управляет переключатель в шапке.
 *
 * Запрет только на ЯВНОЕ значение: в режиме «Авто» подбор не трогаем, иначе демо ломалось бы
 * у любого с английским браузером.
 */
const MOCK_REJECTED_LANG = import.meta.env.VITE_MOCK_REJECT_LANG === '1' ? 'en-US' : null;

/**
 * Мок-онли: второй фактор в ПРОФИЛЕ. По умолчанию `NONE`, как у свежего аккаунта.
 * VITE_MOCK_2FA=PASSWORD|TOTP включает его, чтобы посмотреть зависимую от него часть профиля:
 * остаток аварийных кодов приходит ТОЛЬКО при включённой 2FA. Число кодов задаётся отдельно
 * (VITE_MOCK_RECOVERY_CODES), в том числе `0` — ветка «коды кончились, пора перевыпускать».
 *
 * На сам вход флаг не влияет: цепочку подтверждений со вторым звеном мок не изображает, у него
 * подтверждение всегда одношаговое.
 */
const MOCK_2FA: UserAuth2fa =
  (['PASSWORD', 'TOTP'] as const).find((v) => v === import.meta.env.VITE_MOCK_2FA) ?? 'NONE';
const RECOVERY_CODES_RAW = Number(import.meta.env.VITE_MOCK_RECOVERY_CODES);
const MOCK_RECOVERY_CODES =
  Number.isInteger(RECOVERY_CODES_RAW) && RECOVERY_CODES_RAW >= 0 ? RECOVERY_CODES_RAW : 8;

/**
 * Мок-онли: лимит одновременных сессий. 1 = первое открытие сессии по операции отклоняется `429`,
 * повтор проходит. Так руками видна единственная ветка, где код уже принят, а войти не удалось:
 * подтверждённая операция при отказе НЕ расходуется, поэтому повторять нужно ровно открытие
 * сессии — тем же токеном и уже без `secret`.
 */
const MOCK_SESSION_LIMIT = import.meta.env.VITE_MOCK_SESSION_LIMIT === '1';

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
  /** Мок-онли (MOCK_SESSION_LIMIT): лимит сессий срабатывает по операции ровно один раз. */
  sessionLimitHit?: boolean;
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

/**
 * Язык и пояс живут в ДВУХ местах, как у бэка, — иначе окно рассинхрона в моке не выразить.
 *
 *  - `profileSettings` — профиль: его правит POST /v1/user/settings; когда клиент запросит
 *    GET /v1/user, тот ответит уже новыми значениями, не дожидаясь продления сессии —
 *    в отличие от дат, которые формируются по снимку токена;
 *  - `settingsByAccess` — снимок, вшитый в конкретный access: по нему формируется сам ответ
 *    (даты и, в реальном бэке, тексты). Снимок обновляется только на продлении сессии.
 *
 * Расхождение этих двух записей и есть окно рассинхрона: профиль уже новый, ответ ещё старый.
 */
interface Settings {
  lang: string;
  tz: string;
}

const DEFAULT_SETTINGS: Settings = { lang: 'ru-RU', tz: 'Europe/Moscow' };
/** Пояс/язык приложения по умолчанию — когда источников в запросе нет вовсе (спека: система). */
const SYSTEM_SETTINGS: Settings = { lang: DEFAULT_LANGUAGE.locale, tz: 'UTC' };

let profileSettings: Settings = { ...DEFAULT_SETTINGS };
const settingsByAccess = new Map<string, Settings>();

function hex(len: number): string {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 400 со списком errors. `code` по спеке — либо `КодОшибки`, либо `КодОшибки/имя_поля`, где суффикс
 * совпадает с именем поля в теле запроса: по нему клиент и решает, садится ошибка под поле формы
 * или показывается общим уведомлением.
 */
function fieldError(code: string, detail: string, status = 400) {
  return HttpResponse.json(
    { status, instance: '', errors: [{ code, detail }], time: new Date().toISOString() },
    { status },
  );
}

/**
 * Разбор токена операции. Спека различает два исхода, и клиенту они говорят разное: `OperationInvalid`
 * — токен неизвестен, уже использован или отозван; `OperationAlreadyExpired` — операция была, но её
 * срок вышел, и её нужно создавать заново.
 */
function findOperation(token: string | undefined): MockOperation | 'invalid' | 'expired' {
  const op = token ? operations.get(token) : undefined;
  if (!op) return 'invalid';
  if (Date.now() >= op.createdAt + op.expiresInSec * 1000) {
    operations.delete(op.token);
    return 'expired';
  }
  return op;
}

function operationTokenError(state: 'invalid' | 'expired') {
  return state === 'invalid'
    ? fieldError('OperationInvalid/token', 'Токен операции неизвестен или уже использован')
    : fieldError('OperationAlreadyExpired/token', 'Срок жизни операции истёк, начните заново');
}

/**
 * ОСТАТОК жизни операции, а не её полный срок: по нему findOperation() и признаёт операцию
 * истёкшей, поэтому в ответах должно ехать то же число. Иначе клиент, который пересчитывает
 * дедлайн от каждого ответа, после неверного кода отмотал бы таймер обратно на полный срок —
 * и операция умирала бы, пока на экране ещё остаются минуты.
 */
function expiresLeftSec(op: MockOperation): number {
  return Math.max(0, Math.ceil((op.createdAt + op.expiresInSec * 1000 - Date.now()) / 1000));
}

function operationError(op: MockOperation, code: string, detail: string) {
  return HttpResponse.json(
    {
      status: 400,
      instance: '',
      operation_state: {
        remaining_attempts: op.remainingAttempts,
        remaining_resends: op.remainingResends,
        resends_in: op.resendsInSec,
        expires_in: expiresLeftSec(op),
      },
      errors: [{ code, detail }],
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

/**
 * 429: запрос корректен, но отклонён временно. Тело — то же problem+json, машиночитаемого кода
 * в нём нет; срок повтора клиент берёт из Retry-After (заголовок необязателен).
 */
function tooManyRequests(retryAfterSec: number, detail: string) {
  const res = problem(429, 'Too Many Requests', detail);
  res.headers.set('Retry-After', String(retryAfterSec));
  return res;
}

function waiting(op: MockOperation, message: string): WaitingConfirmOperation {
  return {
    token: op.token,
    confirm_method: 'EMAIL',
    remaining_attempts: op.remainingAttempts,
    remaining_resends: op.remainingResends,
    resends_in: op.resendsInSec,
    expires_in: expiresLeftSec(op),
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
    // Настройки — свойство ОТВЕТА, а не хранимой записи: их проставляет userIn() из профиля.
    // Здесь просто заполняем обязательные поля типа.
    ...profileSettings,
    auth_2fa_type: MOCK_2FA,
    // Аварийные коды существуют только при включённой 2FA — без неё поля в ответе нет вовсе
    // (отсутствие поля клиент трактует как «показывать нечего», а не как ноль).
    ...(MOCK_2FA === 'NONE' ? {} : { recovery_codes_left: MOCK_RECOVERY_CODES }),
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

/** Язык из Accept-Language: терпимо, по первому тегу («ru-RU,ru;q=0.9» → ru-RU). */
function matchHeaderLang(header: string | null): string | undefined {
  if (!header) return undefined;
  const first = header.split(',')[0]?.split(';')[0]?.trim();
  return findLanguage(first)?.locale;
}

/**
 * Настройки, действующие для ЭТОГО ответа: query → снимок токена → заголовок → система.
 *
 * Выбранный пояс прогоняется через resolveTimeZone: дальше по нему считается смещение дат ответа
 * (isoIn), а зона справочника может быть неизвестна ICU браузера — тогда мок падал бы прямо
 * в хендлере. Здесь фолбэк именно UTC, а не «без пояса»: моку нужно конкретное имя, чтобы
 * собрать смещение, — тем же приёмом сделан getOsTimeZone.
 */
function responseSettings(request: Request): Settings {
  const query = new URL(request.url).searchParams;
  const snapshot = settingsByAccess.get(bearer(request));

  const queryLang = query.get('lang');
  const queryTz = query.get('tz');
  const tz =
    (queryTz && findTimeZone(queryTz) ? queryTz : undefined) ??
    snapshot?.tz ??
    matchHeaderTz(request.headers.get('X-Accept-Time-Zone')) ??
    SYSTEM_SETTINGS.tz;
  return {
    // Источники 1–2 строгие: значение принимается только при точном совпадении со справочником.
    lang:
      (queryLang && LANGUAGES.some((l) => l.locale === queryLang) ? queryLang : undefined) ??
      snapshot?.lang ??
      matchHeaderLang(request.headers.get('Accept-Language')) ??
      SYSTEM_SETTINGS.lang,
    tz: resolveTimeZone(tz) ?? 'UTC',
  };
}

/** Те же даты сессии, но в поясе ответа. */
function sessionIn(s: UserSession, tz: string): UserSession {
  return {
    ...s,
    created_at: isoIn(s.created_at, tz),
    last_seen_at: isoIn(s.last_seen_at, tz),
    expires_at: s.expires_at ? isoIn(s.expires_at, tz) : undefined,
  };
}

/**
 * Профиль в том виде, в каком его отдаёт сервер: lang/tz — из ПРОФИЛЯ (новые сразу), а даты —
 * в поясе ответа, то есть из снимка токена, пока сессия не продлилась. В окне рассинхрона они
 * и расходятся: поля новые, даты ещё в прежнем поясе.
 */
function userIn(user: UserInfo, request: Request): UserInfo {
  const { tz } = responseSettings(request);
  return {
    ...user,
    lang: profileSettings.lang,
    tz: profileSettings.tz,
    realms: user.realms.map((r) => ({
      ...r,
      created_at: isoIn(r.created_at, tz),
      updated_at: isoIn(r.updated_at, tz),
      last_logged_at: r.last_logged_at ? isoIn(r.last_logged_at, tz) : undefined,
    })),
  };
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
  settingsByAccess.delete(session.access);
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
    if (!body.realm) return fieldError('ValidateError/realm', 'Realm обязателен');
    if (login.length < 7 || login.length > 64) {
      return fieldError('ValidateError/user_login', 'Укажите корректный email или телефон');
    }
    // Демо: зарезервированный логин, которого «нет в системе». Ошибка садится под поле ввода —
    // суффикс кода совпадает с именем поля запроса.
    if (login.toLowerCase() === 'nobody@example.com') {
      return fieldError('LoginNotExists/user_login', 'Пользователь с таким логином не найден');
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
    if (!body.realm) return fieldError('ValidateError/realm', 'Realm обязателен');
    if (login.length < 7 || login.length > 64 || !login.includes('@')) {
      return fieldError('ValidateError/user_login', 'Укажите корректный email');
    }
    // Демо: зарезервированный «занятый» логин отдаёт 400, остальные свободны.
    if (login.toLowerCase() === 'taken@example.com') {
      return fieldError('EmailAlreadyExists/user_login', 'Этот email уже зарегистрирован');
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Шаг 1 регистрации ---
  http.post(`${BASE}/v1/signup`, async ({ request }) => {
    const body = (await request.json()) as { realm?: string; user_email?: string };
    const email = (body.user_email ?? '').trim();
    if (!body.realm) return fieldError('ValidateError/realm', 'Realm обязателен');
    if (email.length < 7 || email.length > 64 || !email.includes('@')) {
      return fieldError('ValidateError/user_email', 'Укажите корректный email');
    }
    // Демо: по этому емаилу «уже идёт регистрация» — анти-спам троттл. Это 429, а не 400: ответ
    // намеренно не раскрывает, зарегистрирован ли емаил, а лишь просит повторить попытку позже.
    if (email.toLowerCase() === 'inprogress@example.com') {
      return tooManyRequests(600, 'Заявка на регистрацию уже обрабатывается. Попробуйте позже.');
    }
    // Тот же занятый емаил, что и у check-login, но поле здесь своё — `user_email`. Форма зовёт
    // check-login заранее, поэтому в UI ветка видна, только если проверку обошли (быстрый сабмит,
    // сеть моргнула): последнее слово всё равно за signup.
    if (email.toLowerCase() === 'taken@example.com') {
      return fieldError('EmailAlreadyExists/user_email', 'Этот email уже зарегистрирован');
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
    const found = findOperation(body.token);
    if (typeof found === 'string') return operationTokenError(found);
    const op = found;
    // Метод идемпотентен: по уже подтверждённой операции подтверждать нечего — снова 204, а
    // переданный secret игнорируется. Попытка при этом не расходуется.
    if (op.confirmed) return new HttpResponse(null, { status: 204 });
    if (op.remainingAttempts <= 0) {
      return operationError(op, 'NoAttemptsToConfirmOperation/secret', 'Попытки исчерпаны');
    }

    if (body.secret === MOCK_CODE) {
      op.confirmed = true;
      return new HttpResponse(null, { status: 204 });
    }
    op.remainingAttempts -= 1;
    return operationError(
      op,
      'ConfirmCodeIsIncorrect/secret',
      'Неверный код. Проверьте письмо и попробуйте ещё раз.',
    );
  }),

  // --- Повторная отправка кода ---
  http.patch(`${BASE}/v1/operation/resend`, async ({ request }) => {
    const body = (await request.json()) as { token?: string };
    const found = findOperation(body.token);
    if (typeof found === 'string') return operationTokenError(found);
    const op = found;
    // Подтверждённой операции код больше не нужен — отправлять нечего.
    if (op.confirmed) {
      return fieldError('OperationAlreadyConfirmed/token', 'Операция уже подтверждена');
    }
    // Отправки израсходованы ОКОНЧАТЕЛЬНО — это не троттл: ждать бессмысленно, операцию нужно
    // создавать заново (`SendingNewMessagesIsTemporarilyRestricted` спека оставляет за временным
    // ограничением, у которого счётчик ещё не исчерпан).
    if (op.remainingResends <= 0) {
      return operationError(
        op,
        'NoAttemptsToResendCode/token',
        'Повторные отправки закончились. Начните заново.',
      );
    }
    op.remainingResends -= 1;
    op.resendsInSec = 30;
    // Новый код — новый срок жизни операции, иначе продлённым он был бы только на словах.
    op.expiresInSec = 600;
    op.createdAt = Date.now();
    op.remainingAttempts = 3;
    // eslint-disable-next-line no-console
    console.info(`[MSW] Повторный код для ${op.login}: ${MOCK_CODE}`);
    return HttpResponse.json(waiting(op, 'Код отправлен повторно'));
  }),

  // --- Отмена операции ---
  http.patch(`${BASE}/v1/operation/revoke`, async ({ request }) => {
    // Единственный из методов операции с bearer (x-auth-scopes any-users) — гостю, отменяющему
    // своё подтверждение входа, тут прилетает штатный 401.
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Требуется авторизация');
    const body = (await request.json()) as { token?: string };
    if (body.token) operations.delete(body.token);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Открытие сессии ---
  http.post(`${BASE}/v1/session`, async ({ request }) => {
    const body = (await request.json()) as { token?: string; secret?: string };
    const found = findOperation(body.token);
    if (typeof found === 'string') return operationTokenError(found);
    const op = found;
    // Метод совмещает подтверждение последнего звена и открытие сессии, поэтому secret нужен ровно
    // до тех пор, пока операция не подтверждена; по подтверждённой он игнорируется (повтор входа
    // после отказа — идемпотентен).
    if (!op.confirmed) {
      // Подтверждать нечем: это не ошибка ввода, а его отсутствие, поэтому попытка не расходуется.
      if (body.secret === undefined) {
        return operationError(op, 'ConfirmCodeIsRequired/secret', 'Введите код подтверждения');
      }
      // Попытки общие с PATCH /v1/operation/confirm: этот метод подтверждает то же звено, поэтому
      // и счётчик расходует так же — и так же перестаёт их принимать, когда счётчик исчерпан.
      if (op.remainingAttempts <= 0) {
        return operationError(op, 'NoAttemptsToConfirmOperation/secret', 'Попытки исчерпаны');
      }
      if (body.secret !== MOCK_CODE) {
        op.remainingAttempts -= 1;
        return operationError(op, 'ConfirmCodeIsIncorrect/secret', 'Неверный код подтверждения');
      }
    }

    // Звено подтверждено (сейчас или раньше) — отсюда операция уже не требует secret. Отказ по
    // лимиту сессий приходит именно на этом рубеже, поэтому признак ставим до него.
    op.confirmed = true;
    if (MOCK_SESSION_LIMIT && !op.sessionLimitHit) {
      op.sessionLimitHit = true;
      return tooManyRequests(30, 'Превышен лимит одновременных сессий. Повторите попытку позже.');
    }

    const access = hex(64);
    const refresh = hex(64);
    const user = buildUser(op);
    const sessionId = hex(8);
    const now = new Date().toISOString();
    sessionsByRefresh.set(refresh, { access, user, sessionId, realm: op.realm });
    userByAccess.set(access, user);
    // Токен выпускается с текущими настройками профиля — это и есть снимок.
    settingsByAccess.set(access, { ...profileSettings });
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
    // Токена нет ни в куке, ни в теле — 400: нарушена схема запроса. Спека называет для этого
    // ровно один код, `ValidateError/refresh_token`, независимо от того, откуда токен ждали.
    if (!refresh) return fieldError('ValidateError/refresh_token', 'Refresh токен не указан');
    const session = sessionsByRefresh.get(refresh);
    // Токен предъявлен, но негоден (неизвестен, истёк, уже использован) — 401: право на продление
    // даёт сам refresh токен, а не схема аутентификации. Кода ошибки тело 401 не несёт: причина
    // однозначно задана методом.
    if (!session) {
      return problem(401, 'Unauthorized', 'Сессия не найдена или refresh недействителен');
    }

    // Ротация: новый access + новый refresh, sid (sessionId) сохраняется — сессия та же.
    userByAccess.delete(session.access);
    settingsByAccess.delete(session.access);
    sessionsByRefresh.delete(refresh);
    const newAccess = hex(64);
    const newRefresh = hex(64);
    sessionsByRefresh.set(newRefresh, { ...session, access: newAccess });
    userByAccess.set(newAccess, session.user);
    // Ровно здесь сохранённые настройки «доезжают» до токена и окно рассинхрона закрывается.
    settingsByAccess.set(newAccess, { ...profileSettings });
    const current = realmSessions(session.realm).find((s) => s.session_id === session.sessionId);
    if (current) current.last_seen_at = new Date().toISOString();

    const payload: SuccessAccess = { access_token: newAccess, expires_in: 1800 };
    if (cookies.RTID) {
      return HttpResponse.json(payload, {
        status: 201,
        headers: { 'Set-Cookie': `RTID=${newRefresh}; Path=/; SameSite=Strict` },
      });
    }
    return HttpResponse.json({ ...payload, refresh_token: newRefresh }, { status: 201 });
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
    if (!refresh) return fieldError('ValidateError/refresh_token', 'Refresh токен не указан');
    // Метод идемпотентен: неизвестный токен и уже закрытая сессия молча игнорируются и тоже дают
    // 204 — закрывать нечего, а цель вызова (сессии нет) уже достигнута. Куку гасим в обоих
    // случаях: клиент до HttpOnly не дотянется, и протухший токен уезжал бы на каждом продлении.
    const session = sessionsByRefresh.get(refresh);
    if (session) dropSession(refresh, session);
    return new HttpResponse(null, {
      status: 204,
      headers: { 'Set-Cookie': 'RTID=; Path=/; Max-Age=0' },
    });
  }),

  // --- Открытые сессии реалма ---
  http.get(`${BASE}/v1/sessions`, ({ request }) => {
    const user = authUser(request);
    if (!user) return problem(401, 'Unauthorized', 'Требуется авторизация');
    const asked = new URL(request.url).searchParams.get('realm');
    // Параметр по схеме 4..32 символа; вне диапазона — отказ по значению поля.
    if (asked !== null && (asked.length < 4 || asked.length > 32)) {
      return fieldError('ValidateError/realm', `Realm «${asked}» не входит в список realm'ов`);
    }
    // Чужой кабинет — 403: спрашивать сессии realm'а, к которому пользователь не привязан, нельзя.
    if (asked !== null && !user.realms.some((r) => r.name === asked)) {
      return problem(403, 'Forbidden', 'Пользователь не привязан к запрошенному realm’у');
    }
    const realm = asked ?? config.realm;
    // is_current — не хранимый флаг, а свойство ответа: «та ли это сессия, из которой спросили».
    const mine = callerSession(request);
    const { tz } = responseSettings(request);
    const list = realmSessions(realm).map((s) => ({
      ...sessionIn(s, tz),
      is_current: s.session_id === mine?.sessionId,
    }));
    return HttpResponse.json(list);
  }),

  // --- Закрытие перечисленных сессий ---
  http.post(`${BASE}/v1/sessions/close`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Требуется авторизация');
    const body = (await request.json().catch(() => null)) as { session_ids?: string[] } | null;
    const ids = body?.session_ids;
    // Всё это — проверка схемы, поэтому код один: спека относит к `ValidateError/session_ids` и
    // размер списка, и формат элемента (8-символьный hex). Отдельный `SessionIDIsInvalid` она
    // оставляет за элементом, который схему прошёл, а числом не разобрался, — воспроизвести это
    // моком нечем: 8 hex-символов разбираются всегда.
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 64 ||
      ids.some((id) => !/^[0-9a-f]{8}$/i.test(id))
    ) {
      return fieldError('ValidateError/session_ids', 'Укажите от 1 до 64 идентификаторов сессий');
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
    return HttpResponse.json(userIn(user, request));
  }),

  // --- Смена языка и часового пояса ---
  http.post(`${BASE}/v1/user/settings`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Требуется авторизация');
    const body = (await request.json().catch(() => null)) as Partial<Settings> | null;

    // Пустая строка по спеке невалидна: «Авто» — это ОТСУТСТВИЕ поля.
    if (body?.lang === '') {
      return fieldError('ValidateError/lang', 'Язык не может быть пустой строкой');
    }
    if (body?.tz === '') {
      return fieldError('ValidateError/tz', 'Часовой пояс не может быть пустой строкой');
    }

    // Явные значения строгие: подбор ближайшего здесь не выполняется.
    if (
      body?.lang &&
      (body.lang === MOCK_REJECTED_LANG || !LANGUAGES.some((l) => l.locale === body.lang))
    ) {
      return fieldError('ValidateError/lang', `Язык «${body.lang}» не поддерживается`);
    }
    if (body?.tz && (body.tz === MOCK_REJECTED_TZ || !findTimeZone(body.tz))) {
      return fieldError('ValidateError/tz', `Часовой пояс «${body.tz}» не поддерживается`);
    }

    // Режим «авто»: подбираем по самому запросу, уже сохранённые настройки в подборе НЕ участвуют.
    const query = new URL(request.url).searchParams;
    const autoLang =
      matchHeaderLang(query.get('lang')) ??
      matchHeaderLang(request.headers.get('Accept-Language')) ??
      SYSTEM_SETTINGS.lang;
    const autoTz = matchHeaderTz(request.headers.get('X-Accept-Time-Zone')) ?? SYSTEM_SETTINGS.tz;

    profileSettings = { lang: body?.lang ?? autoLang, tz: body?.tz ?? autoTz };
    // Токен остаётся со старым снимком — до ближайшего PATCH /v1/session даты в ответах будут
    // приходить в прежнем поясе, хотя профиль уже отдаёт новый.
    return HttpResponse.json(profileSettings);
  }),
];
