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
  ConfirmMethod,
  SuccessAccess,
  UserAuth2fa,
  UserInfo,
  UserSession,
  WaitingConfirmOperation,
} from '@modules/auth';

/**
 * MSW-мок Auth API для вертикального среза. Держит операции и сессии в памяти.
 * Секреты подтверждения фиксированные — печатаются в консоль (см. signin).
 */

const BASE = config.authApiBaseUrl; // '/api/auth'
const MOCK_CODE = '183947';
/**
 * Аварийный код для звена `RECOVERY` (резервный вход). Отдельная константа, а не MOCK_CODE: на
 * экране подтверждения эти звенья идут подряд, и один и тот же секрет на обоих скрыл бы саму суть
 * цепочки — что второе звено спрашивает уже другое доказательство.
 */
const MOCK_RECOVERY_CODE = 'RECOVRY1-CODE0011';
/**
 * Пароль для звена `PASSWORD`. Тоже отдельная константа: код из сообщения короче минимальной длины
 * пароля, и звено, подтверждаемое им, руками не проходилось бы вовсе — форма не включила бы кнопку.
 */
const MOCK_PASSWORD = 'MockPass2026!';
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
 * Мок-онли: НАЧАЛЬНЫЙ второй фактор в профиле. По умолчанию `NONE`, как у свежего аккаунта.
 * VITE_MOCK_2FA=PASSWORD|TOTP включает его, чтобы попасть сразу в зависимую от него часть
 * профиля: остаток аварийных кодов приходит ТОЛЬКО при включённой 2FA. Начальное число кодов
 * задаётся отдельно (VITE_MOCK_RECOVERY_CODES), в том числе `0` — ветка «коды кончились».
 *
 * Обычному входу флаг добавляет второе звено — фактор после кода из письма; резервному он выбирает
 * ПЕРВОЕ звено цепочки. Само звено одно и то же: `TOTP` при TOTP, иначе пароль. Ветку «у аккаунта
 * 2FA нет, подтвердить нечем» мок не изображает — резервный вход у него проходится при любом
 * значении флага.
 */
const INITIAL_2FA: UserAuth2fa =
  (['PASSWORD', 'TOTP'] as const).find((v) => v === import.meta.env.VITE_MOCK_2FA) ?? 'NONE';
const RECOVERY_CODES_RAW = Number(import.meta.env.VITE_MOCK_RECOVERY_CODES);
const INITIAL_RECOVERY_CODES =
  Number.isInteger(RECOVERY_CODES_RAW) && RECOVERY_CODES_RAW >= 0 ? RECOVERY_CODES_RAW : 8;

/**
 * Мок-онли: заготовка TOTP-генератора. Секрет и ссылка постоянные (границы схемы: Base32 16..128,
 * ссылка 16..512). Код «из приложения» — свой, не совпадающий с кодом из письма: привязка
 * генератора спрашивает именно его, и одинаковые значения скрыли бы разницу.
 */
const MOCK_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const MOCK_TOTP_URI = `otpauth://totp/account-template:user@example.com?issuer=account-template&secret=${MOCK_TOTP_SECRET}`;
const MOCK_TOTP_CODE = '246810';

/**
 * Мок-онли: чёрный квадрат 1×1 вместо QR-кода — рисовать настоящий моку нечем. Ветка нужна ради
 * бинарного ответа нужного типа; секрет для ручного ввода отдаёт соседняя ручка строкой.
 */
const MOCK_QR_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR42mNgAAAAAgAB5Sfe/AAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** Сколько аварийных кодов выдаётся за раз. */
const RECOVERY_CODES_ISSUED = 10;
const RECOVERY_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Мок-онли: лимит одновременных сессий. 1 = первое открытие сессии по операции отклоняется `429`,
 * повтор проходит. Так руками видна единственная ветка, где код уже принят, а войти не удалось:
 * подтверждённая операция при отказе НЕ расходуется, поэтому повторять нужно ровно открытие
 * сессии — тем же токеном и уже без `secret`.
 */
const MOCK_SESSION_LIMIT = import.meta.env.VITE_MOCK_SESSION_LIMIT === '1';

/**
 * Назначение операции. Завершающий метод сверяется с ним раньше, чем с подтверждённостью: свой
 * `apply-*` на чужой тип отвечает `403`, а универсальный `apply-operation` — `500`, потому что
 * для него это тип, которого развёртывание не поддерживает.
 */
type MockOperationKind =
  'signin' | 'signup' | 'password' | 'totp' | 'recovery-codes' | 'disable2fa';

interface MockOperation {
  token: string;
  realm: string;
  login: string;
  kind: MockOperationKind;
  /**
   * Звенья подтверждения по порядку. У входа и регистрации оно одно (код с емаила), у резервного
   * входа их два — второй фактор, затем аварийный код. Токен принадлежит ТЕКУЩЕМУ звену: на
   * переходе к следующему он меняется, как и на настоящем сервере.
   */
  chain: ConfirmMethod[];
  /**
   * Второй фактор аккаунта на момент СОЗДАНИЯ операции. Цепочка звеньев фиксируется тогда же,
   * поэтому по нему видно, отключили ли фактор уже после — см. secretAccepted.
   */
  twoFaAtCreate: UserAuth2fa;
  linkIndex: number;
  remainingAttempts: number;
  remainingResends: number;
  resendsInSec: number;
  expiresInSec: number;
  createdAt: number;
  /** Цепочка пройдена целиком — операции остаётся только терминальное действие. */
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

/**
 * Второй фактор — состояние, а не константа: его двигают методы `/v1/security/*` (`apply-password`
 * и `apply-totp` включают, `apply-operation` по операции отключения — выключает). Env-флаги задают
 * лишь начальное значение. Рядом живёт остаток аварийных кодов: он существует только при включённой
 * 2FA и заменяется целиком вместе с набором.
 */
let auth2fa: UserAuth2fa = INITIAL_2FA;
let recoveryCodesLeft = INITIAL_RECOVERY_CODES;

/** Звено второго фактора по ТЕКУЩЕМУ состоянию 2FA. */
function factorLink(): ConfirmMethod {
  return auth2fa === 'TOTP' ? 'TOTP' : 'PASSWORD';
}

/**
 * Только для тестов: вернуть всё серверное состояние мока к тому, от которого написаны кейсы, —
 * второй фактор, остаток аварийных кодов, незакрытые операции, настройки профиля и выданные
 * сессии. Каждая из этих записей переживает отдельный кейс, поэтому без сброса следующий зависел бы
 * от того, чем кончился прошлый. Список сессий реалма пересоздаётся лениво, при первом обращении.
 *
 * Значения здесь фиксированы, а не взяты из env-флагов: флаг задаёт, с чего начинается ручное демо,
 * и на ожидания тестов влиять не должен — иначе сьюты краснели бы у того, кто настроил окружение по
 * `.env.example`, и зеленели бы только там, где `.env` нет вовсе.
 */
const TEST_2FA: UserAuth2fa = 'NONE';
const TEST_RECOVERY_CODES = 8;

export function resetMockState(): void {
  auth2fa = TEST_2FA;
  recoveryCodesLeft = TEST_RECOVERY_CODES;
  operations.clear();
  profileSettings = { ...DEFAULT_SETTINGS };
  settingsByAccess.clear();
  userByAccess.clear();
  sessionsByRefresh.clear();
  sessionsByRealm.clear();
}

/**
 * Новый набор аварийных кодов в формате примера спеки: две группы по 8 символов через дефис.
 * Прежний набор он заменяет целиком, но рабочим остаётся всё тот же MOCK_RECOVERY_CODE, и стоит он
 * первым: подтверждать звено `RECOVERY` мок умеет только им, а после перевыпуска подтверждать
 * что-то всё ещё нужно. Остальные коды набора — наполнение для экрана показа.
 */
function issueRecoveryCodes(): string[] {
  const group = () =>
    Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (b) => RECOVERY_CODE_CHARS[b % RECOVERY_CODE_CHARS.length],
    ).join('');
  const list = [
    MOCK_RECOVERY_CODE,
    ...Array.from({ length: RECOVERY_CODES_ISSUED - 1 }, () => `${group()}-${group()}`),
  ];
  recoveryCodesLeft = list.length;
  return list;
}

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

/**
 * `field` пустой там, где токен приходит path-параметром: имени поля у него нет, поэтому суффикс
 * к коду не добавляется и клиент показывает такую ошибку общим уведомлением.
 */
function operationTokenError(state: 'invalid' | 'expired', field = '/token') {
  return state === 'invalid'
    ? fieldError(`OperationInvalid${field}`, 'The operation token is unknown or already used')
    : fieldError(`OperationAlreadyExpired${field}`, 'The operation has expired, start over');
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
        // Те же поля и по тому же правилу, что в waiting(): звену без повторной отправки их слать
        // не из чего.
        ...(isResendable(currentMethod(op))
          ? { remaining_resends: op.remainingResends, resends_in: op.resendsInSec }
          : {}),
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
 *
 * Срок повтора называет и сама `detail`: заголовок клиент разбирает для логов, но пользователю
 * не пересказывает — серверный текст показывается как есть, без добавок.
 */
function tooManyRequests(retryAfterSec: number, detail: string) {
  const res = problem(429, 'Too Many Requests', detail);
  res.headers.set('Retry-After', String(retryAfterSec));
  return res;
}

function currentMethod(op: MockOperation): ConfirmMethod {
  return op.chain[op.linkIndex];
}

/** Код приходит сообщением только у этих звеньев — только им есть что отправлять повторно. */
function isResendable(method: ConfirmMethod): boolean {
  return method === 'EMAIL' || method === 'PHONE';
}

/**
 * Что вводить на текущем звене. Свой секрет у аварийного кода и у пароля — каждый в своём формате:
 * форма меряет звено по нему же и короткое значение до сервера не пустит. Остальные звенья мок
 * не различает: и код из сообщения, и код из TOTP-приложения он принимает один и тот же.
 */
function expectedSecret(op: MockOperation): string {
  switch (currentMethod(op)) {
    case 'RECOVERY':
      return MOCK_RECOVERY_CODE;
    case 'PASSWORD':
      return MOCK_PASSWORD;
    default:
      return MOCK_CODE;
  }
}

/**
 * Принят ли предъявленный секрет текущим звеном. Обычно это ровно ожидаемое значение, но на звене
 * второго фактора спека разрешает ввести ВМЕСТО него аварийный код — и только там, где такая замена
 * объявлена: у входа и у отключения 2FA. Перевыпуск аварийных кодов, регистрация и установка
 * пароля/TOTP её не допускают — предъявленный там код отклоняется как неверный и не расходуется.
 *
 * Цепочка, где аварийный код стоит отдельным звеном, замену тоже исключает: иначе за один вход
 * ушло бы два кода, а спека разрешает не больше одного.
 *
 * Пустой набор аварийных кодов не подтверждает ничего: предъявленный код отклоняется как неверный,
 * иначе остаток в профиле не значил бы ничего. Считается это только там, где набор вообще есть: у
 * аккаунта без второго фактора его нет, остаток не приходит и не убывает, и опустеть ему не с чего.
 */
function secretAccepted(op: MockOperation, secret: string | undefined): boolean {
  if (secret === MOCK_RECOVERY_CODE && auth2fa !== 'NONE' && recoveryCodesLeft <= 0) return false;
  const onFactorLink = currentMethod(op) === 'PASSWORD' || currentMethod(op) === 'TOTP';
  // Фактор отключили уже после создания операции: предъявить его больше нечем — ни им самим, ни
  // аварийным кодом, набора которых у аккаунта без 2FA нет. Звено отвечает обычным «неверный код»:
  // отдельный отказ выдал бы состояние 2FA аккаунта, а метод подтверждения гостевой.
  if (onFactorLink && op.twoFaAtCreate !== 'NONE' && auth2fa === 'NONE') return false;
  if (secret === expectedSecret(op)) return true;
  const allowsSwap =
    (op.kind === 'signin' || op.kind === 'disable2fa') && !op.chain.includes('RECOVERY');
  return onFactorLink && allowsSwap && secret === MOCK_RECOVERY_CODE;
}

/**
 * Принятый аварийный код уходит из набора: остаток убывает, и после восьмого раза ветка «коды
 * закончились» открывается сама, без перезапуска с флагом. Вызывать только по принятому секрету —
 * отклонённый код набор не трогает.
 *
 * Рабочим при этом остаётся всё то же единственное значение: набор мок держит числом, а не
 * списком, иначе демо кончалось бы после первого прохода.
 *
 * У аккаунта без второго фактора набора нет вовсе — остаток ему и в профиль не приходит. Такому
 * аккаунту мок разрешает резервный вход, чтобы ветка была достижима с любым значением флага, и
 * убавлять там нечего: иначе после восьмого входа код перестал бы подтверждать что-либо.
 */
function consumeSecret(secret: string | undefined): void {
  if (secret === MOCK_RECOVERY_CODE && auth2fa !== 'NONE') recoveryCodesLeft -= 1;
}

/**
 * Общая часть завершающих методов: операция должна существовать, быть нужного типа и быть
 * подтверждённой — именно в этом порядке (спека проверяет тип раньше подтверждённости).
 * `wrongType` у потребителей разный, поэтому приходит аргументом, — см. MockOperationKind.
 */
function confirmedOperation(
  token: string | undefined,
  kinds: readonly MockOperationKind[],
  wrongType: Response,
  field = '/token',
): MockOperation | Response {
  const found = findOperation(token);
  if (typeof found === 'string') return operationTokenError(found, field);
  if (!kinds.includes(found.kind)) return wrongType;
  if (!found.confirmed) {
    return fieldError(`OperationIsNotConfirmed${field}`, 'Confirm the operation first');
  }
  return found;
}

/** 403 завершающего метода: токен указывает на операцию не того потока. */
function wrongOperationType(): Response {
  return problem(403, 'Forbidden', 'The token points to an operation of a different type');
}

/**
 * Сопроводительный текст звена — по самому звену, а не по его месту в цепочке и не по потоку:
 * этим же текстом отвечают звенья security-операций, у которых свой только первый шаг.
 */
function linkMessage(op: MockOperation): string {
  switch (currentMethod(op)) {
    case 'RECOVERY':
      return 'Enter one of your single-use recovery codes';
    case 'PASSWORD':
    case 'TOTP':
      return 'Confirm the operation with your second factor';
    default:
      // Код всегда уходит на емаил: по логину-телефону — на емаил, привязанный к аккаунту.
      return 'Enter the code sent to your email';
  }
}

/**
 * Звено принято. Есть следующее — операция переезжает на НОВЫЙ токен (предыдущий по спеке сразу
 * перестаёт действовать) и получает свой счётчик попыток; вернули `true`, значит подтверждение
 * продолжается. Звеньев больше нет — цепочка пройдена, дальше только терминальный метод.
 */
function advanceLink(op: MockOperation): boolean {
  if (op.linkIndex + 1 >= op.chain.length) {
    op.confirmed = true;
    return false;
  }
  operations.delete(op.token);
  op.token = hex(64);
  op.linkIndex += 1;
  op.remainingAttempts = 3;
  operations.set(op.token, op);
  // eslint-disable-next-line no-console
  console.info(`[MSW] ${currentMethod(op)} secret for ${op.login}: ${expectedSecret(op)}`);
  return true;
}

/**
 * Ответ по ТЕКУЩЕМУ звену операции. Поля повторной отправки несут только звенья с кодом из
 * сообщения: у второго фактора и аварийного кода отправлять нечего, и клиент читает это по
 * отсутствию самих полей, а не по нулю в них.
 */
function waiting(op: MockOperation, message: string): WaitingConfirmOperation {
  const method = currentMethod(op);
  return {
    token: op.token,
    confirm_method: method,
    remaining_attempts: op.remainingAttempts,
    ...(isResendable(method)
      ? { remaining_resends: op.remainingResends, resends_in: op.resendsInSec }
      : {}),
    expires_in: expiresLeftSec(op),
    message,
  };
}

/**
 * Операция security-потока. Методы тега авторизованные, поэтому логин и реалм берутся у текущей
 * сессии, а не из тела: операция принадлежит тому, кто её создал. Первое звено у всех потоков одно
 * и то же — код на текущий емаил; звено второго фактора, где оно есть, добавляет вызывающий.
 */
function startSecurityOperation(
  request: Request,
  kind: MockOperationKind,
  chain: ConfirmMethod[],
  message: string,
): WaitingConfirmOperation {
  const op: MockOperation = {
    token: hex(64),
    realm: callerSession(request)?.realm ?? config.realm,
    login: authUser(request)?.email ?? '',
    kind,
    chain,
    twoFaAtCreate: auth2fa,
    linkIndex: 0,
    remainingAttempts: 3,
    remainingResends: 2,
    resendsInSec: 30,
    expiresInSec: 600,
    createdAt: Date.now(),
    confirmed: false,
  };
  operations.set(op.token, op);
  // eslint-disable-next-line no-console
  console.info(`[MSW] ${currentMethod(op)} secret for ${op.login}: ${expectedSecret(op)}`);
  return waiting(op, message);
}

function buildUser(op: MockOperation): UserInfo {
  const isEmail = op.login.includes('@');
  const registered = '2025-01-10T09:00:00.000+03:00';
  const employeeRegistered = '2025-03-02T14:30:00.000+03:00';
  return {
    email: isEmail ? op.login : 'user@example.com',
    phone: isEmail ? undefined : op.login,
    // Настройки и второй фактор — свойство ОТВЕТА, а не хранимой записи: их проставляет userIn()
    // из профиля и текущего состояния 2FA. Здесь просто заполняем обязательные поля типа;
    // остатка аварийных кодов среди них нет, потому что при выключенной 2FA поля нет вовсе.
    ...profileSettings,
    auth_2fa_type: auth2fa,
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
              user_kind: 'employee',
              created_at: employeeRegistered,
              updated_at: employeeRegistered,
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
      device_name: 'Work laptop',
      last_ip: '95.165.1.1',
      location: 'Moscow, Russia',
      created_at: ago(60 * 24 * 12),
      last_seen_at: ago(60 * 9),
      expires_at: ahead(60 * 24 * 18),
    }),
    otherSession({
      app_name: 'Web, Chrome',
      device_name: 'Home PC',
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
 * Query-источники строгие: значение принимается только при точном совпадении со справочником,
 * подбор ближайшего здесь не выполняется. Невалидное — как будто параметра не было вовсе, и подбор
 * уезжает в заголовок. Терпимость нужна только заголовку: его пишет браузер по своим настройкам, а
 * параметр запроса клиент выбирает из того же справочника, и `?lang=ru` вместо точной локали —
 * не «почти то», а ошибка вызова.
 */
function strictQueryLang(query: URLSearchParams): string | undefined {
  const value = query.get('lang');
  return value && LANGUAGES.some((l) => l.locale === value) ? value : undefined;
}

function strictQueryTz(query: URLSearchParams): string | undefined {
  const value = query.get('tz');
  return value && findTimeZone(value) ? value : undefined;
}

/** Хвост подбора, общий у всех источников: заголовок клиента (терпимо) → умолчание приложения. */
function envSettings(request: Request): Settings {
  return {
    lang: matchHeaderLang(request.headers.get('Accept-Language')) ?? SYSTEM_SETTINGS.lang,
    tz: matchHeaderTz(request.headers.get('X-Accept-Time-Zone')) ?? SYSTEM_SETTINGS.tz,
  };
}

/**
 * Настройки, подобранные по САМОМУ запросу: query → заголовок → умолчание приложения. Уже
 * сохранённые настройки пользователя в подборе не участвуют — это и есть режим «авто»
 * у POST /v1/user/settings: клиент просит определить настройку по текущему окружению.
 */
function requestSettings(request: Request): Settings {
  const query = new URL(request.url).searchParams;
  const env = envSettings(request);
  return {
    lang: strictQueryLang(query) ?? env.lang,
    tz: strictQueryTz(query) ?? env.tz,
  };
}

/**
 * Настройки, действующие для ЭТОГО ответа: query → снимок токена → заголовок → умолчание.
 *
 * Выбранный пояс прогоняется через resolveTimeZone: дальше по нему считается смещение дат ответа
 * (isoIn), а зона справочника может быть неизвестна ICU браузера — тогда мок падал бы прямо
 * в хендлере. Здесь фолбэк именно UTC, а не «без пояса»: моку нужно конкретное имя, чтобы
 * собрать смещение, — тем же приёмом сделан getOsTimeZone.
 */
function responseSettings(request: Request): Settings {
  const query = new URL(request.url).searchParams;
  const snapshot = settingsByAccess.get(bearer(request));
  const env = envSettings(request);
  return {
    lang: strictQueryLang(query) ?? snapshot?.lang ?? env.lang,
    tz: resolveTimeZone(strictQueryTz(query) ?? snapshot?.tz ?? env.tz) ?? 'UTC',
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
    auth_2fa_type: auth2fa,
    // Аварийные коды существуют только при включённой 2FA — без неё поля в ответе нет вовсе
    // (отсутствие поля клиент трактует как «показывать нечего», а не как ноль).
    ...(auth2fa === 'NONE' ? {} : { recovery_codes_left: recoveryCodesLeft }),
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
    if (!body.realm) return fieldError('ValidateError/realm', 'Realm is required');
    if (login.length < 7 || login.length > 64) {
      return fieldError('ValidateError/user_login', 'Enter a valid email or phone number');
    }
    // Демо: зарезервированный логин, которого «нет в системе». Ошибка садится под поле ввода —
    // суффикс кода совпадает с именем поля запроса.
    if (login.toLowerCase() === 'nobody@example.com') {
      return fieldError('LoginNotExists/user_login', 'No user with this login');
    }
    const op: MockOperation = {
      token: hex(64),
      realm: body.realm,
      login,
      kind: 'signin',
      // При включённой 2FA за кодом с емаила идёт звено второго фактора (спека, шаг 4.1). Вместо
      // пароля/TOTP на нём принимается и аварийный код — выбор заранее не объявляется.
      chain: auth2fa === 'NONE' ? ['EMAIL'] : ['EMAIL', factorLink()],
      twoFaAtCreate: auth2fa,
      linkIndex: 0,
      remainingAttempts: 3,
      remainingResends: 2, // намеренно немного для демо состояний «последняя отправка» / «тупик»
      resendsInSec: 30,
      expiresInSec: 600,
      createdAt: Date.now(),
      confirmed: false,
    };
    operations.set(op.token, op);
    // eslint-disable-next-line no-console
    console.info(`[MSW] Confirmation code for ${login}: ${MOCK_CODE}`);
    return HttpResponse.json(waiting(op, linkMessage(op)));
  }),

  // --- Шаг 1 резервного входа (доступ к почте утрачен) ---
  http.post(`${BASE}/v1/signin/recovery`, async ({ request }) => {
    const body = (await request.json()) as { realm?: string; user_login?: string };
    const login = (body.user_login ?? '').trim();
    if (!body.realm) return fieldError('ValidateError/realm', 'Realm is required');
    if (login.length < 7 || login.length > 64) {
      return fieldError('ValidateError/user_login', 'Enter a valid email or phone number');
    }
    if (login.toLowerCase() === 'nobody@example.com') {
      return fieldError('LoginNotExists/user_login', 'No user with this login');
    }
    // Письма здесь нет вовсе, поэтому нет и повторных отправок: цепочка из двух звеньев —
    // второй фактор аккаунта, затем одноразовый аварийный код.
    const op: MockOperation = {
      token: hex(64),
      realm: body.realm,
      login,
      kind: 'signin',
      chain: [factorLink(), 'RECOVERY'],
      twoFaAtCreate: auth2fa,
      linkIndex: 0,
      remainingAttempts: 3,
      remainingResends: 0,
      resendsInSec: 0,
      expiresInSec: 600,
      createdAt: Date.now(),
      confirmed: false,
    };
    operations.set(op.token, op);
    // eslint-disable-next-line no-console
    console.info(`[MSW] ${currentMethod(op)} secret for ${login}: ${expectedSecret(op)}`);
    return HttpResponse.json(waiting(op, linkMessage(op)));
  }),

  // --- Проверка доступности логина (для регистрации) ---
  http.post(`${BASE}/v1/check/check-login`, async ({ request }) => {
    const body = (await request.json()) as { realm?: string; user_login?: string };
    const login = (body.user_login ?? '').trim();
    if (!body.realm) return fieldError('ValidateError/realm', 'Realm is required');
    if (login.length < 7 || login.length > 64 || !login.includes('@')) {
      return fieldError('ValidateError/user_login', 'Enter a valid email');
    }
    // Демо: зарезервированный «занятый» логин отдаёт 400, остальные свободны.
    if (login.toLowerCase() === 'taken@example.com') {
      return fieldError('EmailAlreadyExists/user_login', 'This email is already registered');
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Шаг 1 регистрации ---
  http.post(`${BASE}/v1/signup`, async ({ request }) => {
    const body = (await request.json()) as { realm?: string; user_email?: string };
    const email = (body.user_email ?? '').trim();
    if (!body.realm) return fieldError('ValidateError/realm', 'Realm is required');
    if (email.length < 7 || email.length > 64 || !email.includes('@')) {
      return fieldError('ValidateError/user_email', 'Enter a valid email');
    }
    // Демо: по этому емаилу «уже идёт регистрация» — анти-спам троттл. Это 429, а не 400: ответ
    // намеренно не раскрывает, зарегистрирован ли емаил, а лишь просит повторить попытку позже.
    if (email.toLowerCase() === 'inprogress@example.com') {
      return tooManyRequests(
        600,
        'Your sign-up request is already being processed. Please try again in 10 minutes.',
      );
    }
    // Тот же занятый емаил, что и у check-login, но поле здесь своё — `user_email`. Форма зовёт
    // check-login заранее, поэтому в UI ветка видна, только если проверку обошли (быстрый сабмит,
    // сеть моргнула): последнее слово всё равно за signup.
    if (email.toLowerCase() === 'taken@example.com') {
      return fieldError('EmailAlreadyExists/user_email', 'This email is already registered');
    }
    const op: MockOperation = {
      token: hex(64),
      realm: body.realm,
      login: email,
      kind: 'signup',
      chain: ['EMAIL'],
      twoFaAtCreate: auth2fa,
      linkIndex: 0,
      remainingAttempts: 3,
      remainingResends: 2,
      resendsInSec: 30,
      expiresInSec: 600,
      createdAt: Date.now(),
      confirmed: false,
    };
    operations.set(op.token, op);
    // eslint-disable-next-line no-console
    console.info(`[MSW] Sign-up confirmation code for ${email}: ${MOCK_CODE}`);
    return HttpResponse.json(
      waiting(op, 'To finish signing up, enter the code sent to your email'),
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
      return operationError(op, 'NoAttemptsToConfirmOperation/secret', 'No attempts left');
    }

    if (secretAccepted(op, body.secret)) {
      consumeSecret(body.secret);
      // Цепочка не кончилась — 200 со следующим звеном (у него свой токен), иначе 204.
      return advanceLink(op)
        ? HttpResponse.json(waiting(op, linkMessage(op)))
        : new HttpResponse(null, { status: 204 });
    }
    // Звено второго фактора и аварийного кода письмом не подтверждается — совет «проверьте письмо»
    // отправил бы искать не там.
    const detail = isResendable(currentMethod(op))
      ? 'Wrong code. Check the email and try again.'
      : 'Wrong value. Please try again.';
    op.remainingAttempts -= 1;
    return operationError(op, 'ConfirmCodeIsIncorrect/secret', detail);
  }),

  // --- Повторная отправка кода ---
  http.patch(`${BASE}/v1/operation/resend`, async ({ request }) => {
    const body = (await request.json()) as { token?: string };
    const found = findOperation(body.token);
    if (typeof found === 'string') return operationTokenError(found);
    const op = found;
    // Подтверждённой операции код больше не нужен — отправлять нечего.
    if (op.confirmed) {
      return fieldError('OperationAlreadyConfirmed/token', 'The operation is already confirmed');
    }
    // Звено второго фактора и аварийного кода сообщением не подтверждается: слать нечего и некуда.
    // Сама операция при этом цела, поэтому это не тупик, а отказ по одному методу.
    if (!isResendable(currentMethod(op))) {
      return operationError(
        op,
        'ResendCodeIsNotSupported/token',
        'This step is confirmed without a code from a message — there is nothing to send',
      );
    }
    // Отправки израсходованы ОКОНЧАТЕЛЬНО — это не троттл: ждать бессмысленно, операцию нужно
    // создавать заново (`SendingNewMessagesIsTemporarilyRestricted` спека оставляет за временным
    // ограничением, у которого счётчик ещё не исчерпан).
    if (op.remainingResends <= 0) {
      return operationError(op, 'NoAttemptsToResendCode/token', 'No resends left. Start over.');
    }
    op.remainingResends -= 1;
    op.resendsInSec = 30;
    // Новый код — новый срок жизни операции, иначе продлённым он был бы только на словах.
    op.expiresInSec = 600;
    op.createdAt = Date.now();
    op.remainingAttempts = 3;
    // eslint-disable-next-line no-console
    console.info(`[MSW] Resent code for ${op.login}: ${MOCK_CODE}`);
    return HttpResponse.json(waiting(op, 'The code has been sent again'));
  }),

  // --- Отмена операции ---
  http.patch(`${BASE}/v1/operation/revoke`, async ({ request }) => {
    // Единственный из методов операции с bearer (x-auth-scopes any-users) — гостю, отменяющему
    // своё подтверждение входа, тут прилетает штатный 401.
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
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
    // Сессию открывают только операции входа и регистрации: по любой другой это 403, а не отказ
    // по состоянию — открывать сессию по смене пароля нельзя в принципе.
    if (op.kind !== 'signin' && op.kind !== 'signup') {
      return problem(403, 'Forbidden', 'This operation cannot open a session');
    }
    // Метод совмещает подтверждение последнего звена и открытие сессии, поэтому secret нужен ровно
    // до тех пор, пока операция не подтверждена; по подтверждённой он игнорируется (повтор входа
    // после отказа — идемпотентен).
    if (!op.confirmed) {
      // Подтверждать нечем: это не ошибка ввода, а его отсутствие, поэтому попытка не расходуется.
      if (body.secret === undefined) {
        return operationError(op, 'ConfirmCodeIsRequired/secret', 'Enter the confirmation code');
      }
      // Попытки общие с PATCH /v1/operation/confirm: этот метод подтверждает то же звено, поэтому
      // и счётчик расходует так же — и так же перестаёт их принимать, когда счётчик исчерпан.
      if (op.remainingAttempts <= 0) {
        return operationError(op, 'NoAttemptsToConfirmOperation/secret', 'No attempts left');
      }
      if (!secretAccepted(op, body.secret)) {
        op.remainingAttempts -= 1;
        return operationError(op, 'ConfirmCodeIsIncorrect/secret', 'Wrong confirmation code');
      }
      consumeSecret(body.secret);
      // Секрет передали прямо сюда, минуя подтверждение, а цепочка ещё не кончилась: сессии пока
      // нет — отвечаем очередным звеном (200), как и PATCH /v1/operation/confirm.
      if (advanceLink(op)) {
        return HttpResponse.json(waiting(op, linkMessage(op)));
      }
    }

    // Цепочка пройдена (сейчас или раньше) — отсюда операция уже не требует secret. Отказ по
    // лимиту сессий приходит именно на этом рубеже, поэтому признак ставим до него.
    op.confirmed = true;
    if (MOCK_SESSION_LIMIT && !op.sessionLimitHit) {
      op.sessionLimitHit = true;
      return tooManyRequests(
        30,
        'The concurrent session limit is reached. Please try again in 30 seconds.',
      );
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
      app_name: 'Web, this browser',
      device_name: 'Current device',
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
    if (!refresh) return fieldError('ValidateError/refresh_token', 'The refresh token is missing');
    const session = sessionsByRefresh.get(refresh);
    // Токен предъявлен, но негоден (неизвестен, истёк, уже использован) — 401: право на продление
    // даёт сам refresh токен, а не схема аутентификации. Кода ошибки тело 401 не несёт: причина
    // однозначно задана методом.
    if (!session) {
      return problem(
        401,
        'Unauthorized',
        'The session was not found or the refresh token is invalid',
      );
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
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    let refresh: string | undefined = cookies.RTID;
    if (!refresh) {
      const body = (await request.json().catch(() => null)) as { refresh_token?: string } | null;
      refresh = body?.refresh_token;
    }
    if (!refresh) return fieldError('ValidateError/refresh_token', 'The refresh token is missing');
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
    if (!user) return problem(401, 'Unauthorized', 'Authorization required');
    const asked = new URL(request.url).searchParams.get('realm');
    // Параметр по схеме 4..32 символа; вне диапазона — отказ по значению поля.
    if (asked !== null && (asked.length < 4 || asked.length > 32)) {
      return fieldError('ValidateError/realm', `Realm “${asked}” is not in the list of realms`);
    }
    // Чужой кабинет — 403: спрашивать сессии realm'а, к которому пользователь не привязан, нельзя.
    if (asked !== null && !user.realms.some((r) => r.name === asked)) {
      return problem(403, 'Forbidden', 'The user is not linked to the requested realm');
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
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
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
      return fieldError('ValidateError/session_ids', 'Provide from 1 to 64 session ids');
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
    if (!user) return problem(401, 'Unauthorized', 'Authorization required');
    return HttpResponse.json(userIn(user, request));
  }),

  // --- Смена языка и часового пояса ---
  http.post(`${BASE}/v1/user/settings`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    const body = (await request.json().catch(() => null)) as Partial<Settings> | null;

    // Пустая строка по спеке невалидна: «Авто» — это ОТСУТСТВИЕ поля.
    if (body?.lang === '') {
      return fieldError('ValidateError/lang', 'The language cannot be an empty string');
    }
    if (body?.tz === '') {
      return fieldError('ValidateError/tz', 'The time zone cannot be an empty string');
    }

    // Явные значения строгие: подбор ближайшего здесь не выполняется.
    if (
      body?.lang &&
      (body.lang === MOCK_REJECTED_LANG || !LANGUAGES.some((l) => l.locale === body.lang))
    ) {
      return fieldError('ValidateError/lang', `Language “${body.lang}” is not supported`);
    }
    if (body?.tz && (body.tz === MOCK_REJECTED_TZ || !findTimeZone(body.tz))) {
      return fieldError('ValidateError/tz', `Time zone “${body.tz}” is not supported`);
    }

    // Режим «авто» — отсутствующее поле: подбираем по самому запросу, уже сохранённые настройки
    // в подборе НЕ участвуют.
    const auto = requestSettings(request);

    profileSettings = { lang: body?.lang ?? auto.lang, tz: body?.tz ?? auto.tz };
    // Токен остаётся со старым снимком — до ближайшего PATCH /v1/session даты в ответах будут
    // приходить в прежнем поясе, хотя профиль уже отдаёт новый.
    return HttpResponse.json(profileSettings);
  }),

  // --- Установка пароля вторым фактором ---
  http.post(`${BASE}/v1/security/password`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    const body = (await request.json()) as { new_password?: string };
    const password = body.new_password ?? '';
    if (password.length < 8 || password.length > 32) {
      return fieldError('ValidateError/new_password', 'The password must be 8 to 32 characters');
    }
    // Активный второй фактор не перезаписывается — сначала его нужно отключить.
    if (auth2fa !== 'NONE') {
      return problem(409, 'Conflict', 'Two-factor protection is already on — turn it off first');
    }
    return HttpResponse.json(
      startSecurityOperation(
        request,
        'password',
        ['EMAIL'],
        'To set a password, enter the code sent to your email',
      ),
    );
  }),

  // --- Завершение установки пароля: включает 2FA и выдаёт аварийные коды ---
  http.post(`${BASE}/v1/security/apply-password`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    const body = (await request.json()) as { token?: string };
    const found = confirmedOperation(body.token, ['password'], wrongOperationType());
    if (found instanceof Response) return found;
    if (auth2fa !== 'NONE') {
      return problem(409, 'Conflict', 'Two-factor protection is already on — turn it off first');
    }
    auth2fa = 'PASSWORD';
    operations.delete(found.token);
    return HttpResponse.json({ recovery_codes: issueRecoveryCodes() });
  }),

  // --- Подключение TOTP-генератора ---
  http.post(`${BASE}/v1/security/totp`, ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    if (auth2fa !== 'NONE') {
      return problem(409, 'Conflict', 'Two-factor protection is already on — turn it off first');
    }
    return HttpResponse.json(
      startSecurityOperation(
        request,
        'totp',
        ['EMAIL'],
        'To connect the authenticator, enter the code sent to your email',
      ),
    );
  }),

  // --- Заготовка генератора текстом ---
  http.get(`${BASE}/v1/security/totp/:token`, ({ request, params }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    // Токен пришёл path-параметром, поэтому суффикса поля у кодов ошибок нет.
    const found = confirmedOperation(String(params.token), ['totp'], wrongOperationType(), '');
    if (found instanceof Response) return found;
    // eslint-disable-next-line no-console
    console.info(`[MSW] TOTP authenticator code: ${MOCK_TOTP_CODE}`);
    return HttpResponse.json({ secret: MOCK_TOTP_SECRET, otpauth_uri: MOCK_TOTP_URI });
  }),

  // --- Та же заготовка картинкой ---
  http.get(`${BASE}/v1/security/totp/:token/qrcode`, ({ request, params }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    const found = confirmedOperation(String(params.token), ['totp'], wrongOperationType(), '');
    if (found instanceof Response) return found;
    return HttpResponse.arrayBuffer(MOCK_QR_PNG.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'image/png' },
    });
  }),

  // --- Завершение привязки TOTP: код из приложения включает 2FA и выдаёт аварийные коды ---
  http.post(`${BASE}/v1/security/apply-totp`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    const body = (await request.json()) as { token?: string; totp_code?: string };
    // Проверка схемы идёт раньше состояния операции: это отказ по самому телу запроса.
    if (!/^\d{6}$/.test(body.totp_code ?? '')) {
      return fieldError('ValidateError/totp_code', 'The code must be 6 digits');
    }
    const found = confirmedOperation(body.token, ['totp'], wrongOperationType());
    if (found instanceof Response) return found;
    if (body.totp_code !== MOCK_TOTP_CODE) {
      return fieldError('TOTPCodeIsIncorrect/totp_code', 'The code did not match — check the app');
    }
    if (auth2fa !== 'NONE') {
      return problem(409, 'Conflict', 'Two-factor protection is already on — turn it off first');
    }
    auth2fa = 'TOTP';
    operations.delete(found.token);
    return HttpResponse.json({ recovery_codes: issueRecoveryCodes() });
  }),

  // --- Перевыпуск аварийных кодов ---
  http.post(`${BASE}/v1/security/recovery-codes`, ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    if (auth2fa === 'NONE') {
      return problem(409, 'Conflict', 'Two-factor protection is off — nothing to reissue');
    }
    // Перевыпуск требует оба постоянных доказательства: доступ к емаилу и второй фактор.
    return HttpResponse.json(
      startSecurityOperation(
        request,
        'recovery-codes',
        ['EMAIL', factorLink()],
        'To reissue the codes, enter the code sent to your email',
      ),
    );
  }),

  // --- Завершение перевыпуска: набор заменяется на новый ---
  http.post(`${BASE}/v1/security/apply-recovery-codes`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    const body = (await request.json()) as { token?: string };
    const found = confirmedOperation(body.token, ['recovery-codes'], wrongOperationType());
    if (found instanceof Response) return found;
    if (auth2fa === 'NONE') {
      return problem(409, 'Conflict', 'Two-factor protection is off — nothing to reissue');
    }
    operations.delete(found.token);
    return HttpResponse.json({ recovery_codes: issueRecoveryCodes() });
  }),

  // --- Отключение 2FA ---
  http.post(`${BASE}/v1/security/disable2fa`, ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    if (auth2fa === 'NONE') {
      return problem(409, 'Conflict', 'Two-factor protection is already off');
    }
    return HttpResponse.json(
      startSecurityOperation(
        request,
        'disable2fa',
        ['EMAIL', factorLink()],
        'To turn the protection off, enter the code sent to your email',
      ),
    );
  }),

  // --- Универсальное завершение операции ---
  http.post(`${BASE}/v1/security/apply-operation`, async ({ request }) => {
    if (!authUser(request)) return problem(401, 'Unauthorized', 'Authorization required');
    const body = (await request.json()) as { token?: string };
    // Этим методом закрываются операции, у которых нет своего `apply-*`; у мока такая одна —
    // отключение 2FA. Тип, которого развёртывание не поддерживает, спека относит к ошибке
    // конфигурации сервера, а не к отказу по правам, — отсюда 500, а не 403.
    const found = confirmedOperation(
      body.token,
      ['disable2fa'],
      problem(500, 'Internal Server Error', 'An operation of this type is not supported'),
    );
    if (found instanceof Response) return found;
    auth2fa = 'NONE';
    operations.delete(found.token);
    return new HttpResponse(null, { status: 204 });
  }),
];
