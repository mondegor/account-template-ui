import axios from 'axios';
import { config, PROACTIVE_REFRESH_SKEW_SEC } from '@config';
import { commonHeaders } from '@core/api';
import { authStore } from './authStore';
import { tokenStorage } from './tokenStorage';

/**
 * Единая точка продления сессии. Single-flight: параллельные вызовы (реактивный на 401 +
 * проактивный по таймеру) сливаются в один PATCH /v1/session. Успех продления = 200
 * (backend_answers §2). Серверное grace-окно (60с) делает повторы идемпотентными, поэтому
 * navigator.locks не нужен.
 */

// Отдельный axios без auth-response-интерсептора → нет рекурсии refresh→401→refresh.
const rawClient = axios.create({
  baseURL: config.authApiBaseUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json;charset=UTF-8' },
});

interface SuccessAccessBody {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
}

let inflight: Promise<boolean> | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
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

export function applyAccess(body: SuccessAccessBody): void {
  authStore.setAccess(body.access_token, body.expires_in);
  tokenStorage.setRefreshFromBody(body.refresh_token);
  scheduleProactiveRefresh();
}

/**
 * Продление как таковое (single-flight). Отдельно от refresh(), потому что logout() продлевает
 * сессию в обход запрета: ему новый access нужен ровно затем, чтобы дожать DELETE.
 */
function renew(): Promise<boolean> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const bodyToken = tokenStorage.getRefreshForBody();
      // body-mode без токена в памяти (после reload) — продлить нечем.
      if (tokenStorage.mode === 'body' && !bodyToken) return false;

      const res = await rawClient.patch<SuccessAccessBody>(
        '/v1/session',
        bodyToken ? { refresh_token: bodyToken } : undefined,
        { headers: commonHeaders() },
      );
      applyAccess(res.data);
      return true;
    } catch {
      // reuse вне grace-окна / истёкший refresh → закрыта текущая сессия → разлогин этой вкладки.
      // Во время выхода чистит и оповещает сам logout() — иначе слушатели сработали бы дважды.
      if (!loggingOut) forceLogout();
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Продление по 401 или по таймеру. Пока идёт выход — не продлеваем: refresh ещё живёт в grace-окне
 * (60с), так что PATCH вернул бы 200, а applyAccess() снова сделал бы вкладку authenticated уже
 * после forceLogout(). Ловится это на любом параллельном запросе: например, ProfilePage
 * перезапрашивает /v1/user, тот получает 401 от уже закрытой сессии — и воскрешает её.
 */
export function refresh(): Promise<boolean> {
  if (loggingOut) return Promise.resolve(false);
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
  authStore.clear();
  tokenStorage.clear();
  emitForcedLogout();
}
