import axios from 'axios';
import { config, PROACTIVE_REFRESH_SKEW_SEC } from '@config';
import { clearProfileLanguage } from '@core/i18n';
import { clearSettingsOverride, commonHeaders } from '@core/request-meta';
import { authStore } from './authStore';
import { tokenStorage } from './tokenStorage';

/**
 * Единая точка продления сессии. Single-flight: параллельные вызовы (реактивный на 401 +
 * проактивный по таймеру) сливаются в один PATCH /v1/session. Успех — 201 с SuccessAccessBody.
 * Серверное grace-окно (60с, повтор тем же токеном возвращает те же токены) делает повторы
 * идемпотентными, поэтому navigator.locks не нужен.
 *
 * Отказ разбирается по причине, потому что продление чаще всего идёт в фоне (проактивно, за
 * PROACTIVE_REFRESH_SKEW_SEC до истечения access): вкладка не должна разлогиниваться из-за
 * моргнувшей сети, когда серверная сессия жива, — см. RenewOutcome.
 */

// Отдельный axios без auth-response-интерсептора → нет рекурсии refresh→401→refresh. Заодно мимо
// request-интерсептора, поэтому X-Accept-Time-Zone тут не появляется — и не нужен: язык и пояс
// нового токена сервер берёт из профиля, а не из окружения запроса.
const rawClient = axios.create({
  baseURL: config.authApiBaseUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json;charset=UTF-8' },
});

interface SuccessAccessBody {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

/**
 * Исход попытки продления. Граница между «продлевать нечем» и «не дозвонились» задана спекой:
 * `PATCH /v1/session` отвечает `401`, когда refresh-токен неизвестен, истёк или уже использован,
 * и `400`, когда его в запросе нет вовсе. И то, и другое неисправимо — нужен новый вход. А `5xx`
 * и недоехавший запрос про сам токен не говорят ничего: сессия на сервере жива, и единственное
 * верное действие — повторить позже.
 */
type RenewOutcome = 'renewed' | 'rejected' | 'unreachable';

/**
 * Паузы между повторами после транзиентного отказа; дальше — по последнему значению. Потолка по
 * числу попыток нет намеренно: цикл обрывается сам, когда истечёт refresh-токен и сервер ответит
 * `401` — то есть ровно тогда, когда продлевать станет действительно нечего.
 */
const RETRY_DELAYS_SEC = [2, 5, 10, 20, 30];

let inflight: Promise<RenewOutcome> | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let loggingOut = false;

/** Обработчики разлогина (guard-и подписываются, чтобы редиректнуть на /signin). */
type LogoutListener = () => void;
const logoutListeners = new Set<LogoutListener>();
export function onForcedLogout(fn: LogoutListener): () => void {
  logoutListeners.add(fn);
  return () => logoutListeners.delete(fn);
}
function emitForcedLogout(): void {
  logoutListeners.forEach((fn) => fn());
}

/**
 * Обработчики восстановления сессии ПОСЛЕ цикла повторов. Пока цикл крутился, продлить было нечем,
 * и все запросы этого времени отбились 401-ми — их результат осел в кэше вызывающего как ошибка.
 * Сами такие запросы не переиграются, поэтому о восстановлении нужно сказать наружу.
 * Штатное продление (проактивное, с первой попытки) сюда не приходит: терять там нечего.
 */
type RecoveryListener = () => void;
const recoveryListeners = new Set<RecoveryListener>();
export function onSessionRecovered(fn: RecoveryListener): () => void {
  recoveryListeners.add(fn);
  return () => recoveryListeners.delete(fn);
}
function emitSessionRecovered(): void {
  recoveryListeners.forEach((fn) => fn());
}

export function applyAccess(body: SuccessAccessBody): void {
  authStore.setAccess(body.access_token, body.expires_in);
  tokenStorage.setRefreshFromBody(body.refresh_token);
  // Новый токен несёт сохранённые язык и пояс сам, поэтому локальный override с этого момента
  // не нужен. Зовётся и на первом access при входе: для свежего токена утверждение тоже верно.
  clearSettingsOverride();
  scheduleProactiveRefresh();
}

function cancelRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

/** Взводит следующую попытку продления. Пауза растёт по RETRY_DELAYS_SEC. */
function scheduleRetry(): void {
  const delay = RETRY_DELAYS_SEC[Math.min(retryAttempt, RETRY_DELAYS_SEC.length - 1)]!;
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void refresh();
  }, delay * 1000);
}

/** Один запрос продления (single-flight): сливает параллельные вызовы, пока запрос в полёте. */
function attempt(): Promise<RenewOutcome> {
  if (inflight) return inflight;

  inflight = (async (): Promise<RenewOutcome> => {
    try {
      const bodyToken = tokenStorage.getRefreshForBody();
      const res = await rawClient.patch<SuccessAccessBody>(
        '/v1/session',
        bodyToken ? { refresh_token: bodyToken } : undefined,
        { headers: commonHeaders() },
      );
      applyAccess(res.data);
      return 'renewed';
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : null;
      // Ответа нет вовсе (сеть, таймаут, обрыв) либо сервер сломался. Прочее — включая ошибку не от
      // axios, то есть сбой в самом клиенте, — считаем терминальным: повтор её не вылечит.
      return status === undefined || (status !== null && status >= 500)
        ? 'unreachable'
        : 'rejected';
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Продление как таковое. Отдельно от refresh(), потому что logout() продлевает сессию в обход
 * запрета: ему новый access нужен ровно затем, чтобы дожать DELETE.
 */
async function renew(): Promise<boolean> {
  // body-mode без токена в памяти (после reload) — продлить нечем, и повторять нечего.
  if (tokenStorage.mode === 'body' && !tokenStorage.getRefreshForBody()) return false;

  const outcome = await attempt();
  if (outcome === 'renewed') {
    // Признак считаем ДО cancelRetry(): он обнуляет счётчик. Во время выхода не оповещаем —
    // сессию как раз закрывают, и слушателям через мгновение придёт разлогин.
    const recovered = retryAttempt > 0 && !loggingOut;
    cancelRetry();
    if (recovered) emitSessionRecovered();
    return true;
  }
  // Во время выхода чистит и оповещает сам logout() — иначе слушатели сработали бы дважды, — и
  // повторять продление тем более незачем: сессию как раз закрывают.
  if (loggingOut) return false;
  if (outcome === 'rejected') {
    // Истёкший refresh / reuse вне grace-окна → сессия закрыта → разлогин этой вкладки.
    forceLogout();
    return false;
  }
  // Сессия на сервере жива — вкладку не роняем, пробуем ещё раз позже. Цикл защищает УЖЕ открытую
  // сессию, поэтому на стартовой пробе (access ещё нет) его нет: восстанавливать нечего, а поздний
  // успех залогинил бы гостя, стоящего на /signin.
  if (authStore.getAccess() && !retryTimer) scheduleRetry();
  return false;
}

/**
 * Продление по 401 или по таймеру. Пока идёт выход — не продлеваем: refresh ещё живёт в grace-окне
 * (60с), так что PATCH вернул бы 201, а applyAccess() снова сделал бы вкладку authenticated уже
 * после forceLogout(). Ловится это на любом параллельном запросе: например, ProfilePage
 * перезапрашивает /v1/user, тот получает 401 от уже закрытой сессии — и воскрешает её.
 *
 * Пока взведена пауза повтора — запроса не делаем вовсе: single-flight сливает вызовы только в
 * полёте, а между попытками каждый из висящих 401 (react-query держит их пачками) стартовал бы
 * свой запрос, и пауза перестала бы существовать.
 */
export function refresh(): Promise<boolean> {
  if (loggingOut || retryTimer) return Promise.resolve(false);
  return renew();
}

export function scheduleProactiveRefresh(): void {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const expiresAt = authStore.getExpiresAt();
  if (!expiresAt) return;
  const delay = expiresAt - Date.now() - PROACTIVE_REFRESH_SKEW_SEC * 1000;
  // Не рефрешим раньше, чем через секунду; при отрицательном — сразу.
  proactiveTimer = setTimeout(() => void refresh(), Math.max(delay, 1000));
}

/**
 * DELETE /v1/session — через rawClient (интерсептор authClient исключает /v1/session из refresh),
 * поэтому Authorization ставим руками: DELETE, в отличие от PATCH, требует bearer.
 */
async function deleteSession(): Promise<void> {
  const bodyToken = tokenStorage.getRefreshForBody();
  const access = authStore.getAccess();
  await rawClient.delete('/v1/session', {
    data: bodyToken ? { refresh_token: bodyToken } : undefined,
    headers: {
      ...commonHeaders(),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
  });
}

/**
 * Осознанный выход: инвалидирует серверную сессию (DELETE /v1/session сбрасывает cookie RTID),
 * затем чистит клиент. Без серверной части silent-refresh после reload молча вернул бы
 * пользователя обратно — поэтому 401 (протухший access) не проглатывается: продлеваем сессию и
 * повторяем DELETE ровно один раз. Остальные ошибки (сеть, 5xx) неисправимы — чистим клиент как есть.
 * На всё время выхода продление закрыто для остальных (loggingOut) — см. refresh().
 */
export async function logout(): Promise<void> {
  loggingOut = true;
  try {
    await deleteSession();
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401 && (await renew())) {
      // renew() положил новый access (и refresh — в body-mode), deleteSession перечитает оба.
      await deleteSession().catch(() => undefined);
    }
  } finally {
    loggingOut = false;
  }
  forceLogout();
}

/** Принудительный разлогин этой вкладки (протухший refresh, reuse вне grace) — только клиент. */
export function forceLogout(): void {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  // Продлевать больше нечего: сессии нет, а висящий цикл повторов дёргал бы сервер вхолостую.
  cancelRetry();
  authStore.clear();
  tokenStorage.clear();
  // Язык профиля — такая же принадлежность ушедшего пользователя, как токен: иначе гостевые
  // запросы следующего уйдут с его `?lang`. Выбор в шелле при этом остаётся, он про устройство.
  clearProfileLanguage();
  // Оверрайд — тоже принадлежность ушедшей сессии. Гостю он не уходит и сам (localeParam отдаёт
  // его только при токене), но чиститься окно должно там же, где и остальное состояние сессии,
  // а не полагаться на правило из соседнего модуля.
  clearSettingsOverride();
  emitForcedLogout();
}
