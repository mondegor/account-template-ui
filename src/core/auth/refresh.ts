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

export function refresh(): Promise<boolean> {
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
      forceLogout();
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
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
 * TODO: настоящий выход пользователя должен ещё вызывать `DELETE /v1/session` — инвалидировать
 * серверную сессию и сбросить cookie RTID (иначе после reload silent-refresh молча вернёт
 * пользователя). Сейчас это только клиентская очистка; кнопка «Выйти» в ProfilePage временно
 * переиспользует forceLogout (который также вызывается при принудительном разлогине по reuse).
 */
export function forceLogout(): void {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  authStore.clear();
  tokenStorage.clear();
  emitForcedLogout();
}
