import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { config } from '@config';
import { authStore, refresh } from '@core/auth';
import { commonHeaders } from './commonHeaders';
import { normalizeError } from './errors';

/**
 * Auth-клиент. withCredentials — только тут (не глобально), чтобы кука RTID уходила по назначению.
 * Интерсепторы: Bearer + Accept-Language + X-Correlation-Id во все запросы; на 401 — single-flight
 * refresh + повтор запроса (максимум 1 раз). Login/session-эндпоинты из refresh исключены.
 */

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
  skipAuthRefresh?: boolean;
}

// Эндпоинты, где 401 НЕ должен инициировать refresh (guests-only + сам refresh).
// Сравнение точное: '/v1/sessions' — другой ресурс, чем '/v1/session', и его 401 продлевать НАДО.
const NO_REFRESH_PATHS = ['/v1/signin', '/v1/signup', '/v1/session'];
// Здесь путь продолжается id-ом операции/логином, поэтому только эти записи матчатся префиксом.
const NO_REFRESH_PREFIXES = ['/v1/operation/', '/v1/check/'];

function isNoRefreshPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/)[0]!;
  return NO_REFRESH_PATHS.includes(path) || NO_REFRESH_PREFIXES.some((p) => path.startsWith(p));
}

export const authClient: AxiosInstance = axios.create({
  baseURL: config.authApiBaseUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json;charset=UTF-8' },
});

authClient.interceptors.request.use((cfg) => {
  Object.entries(commonHeaders()).forEach(([k, v]) => cfg.headers.set(k, v));
  const access = authStore.getAccess();
  if (access) cfg.headers.set('Authorization', `Bearer ${access}`);
  return cfg;
});

authClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const cfg = error.config as RetriableConfig | undefined;

    const shouldRefresh =
      error.response?.status === 401 &&
      cfg &&
      !cfg._retried &&
      !cfg.skipAuthRefresh &&
      !isNoRefreshPath(cfg.url);

    if (shouldRefresh && cfg) {
      cfg._retried = true;
      const ok = await refresh();
      if (ok) {
        cfg.headers.set('Authorization', `Bearer ${authStore.getAccess()}`);
        return authClient(cfg);
      }
    }

    return Promise.reject(normalizeError(error));
  },
);
