import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { config } from '@config';
import { authStore, refresh } from '@core/auth';
import { buildTimeZoneHeader, getLanguage, getLanguageSource, toLocale } from '@core/i18n';
import { commonHeaders, getSettingsOverride } from '@core/request-meta';
import { normalizeError } from './errors';

/**
 * Auth-клиент. withCredentials — только тут (не глобально), чтобы кука RTID уходила по назначению.
 * Интерсепторы: Bearer + общие заголовки (X-Correlation-Id) + query-параметры языка и пояса
 * во все запросы + X-Accept-Time-Zone, пока пользователь не авторизован; на 401 — single-flight
 * refresh + повтор запроса (максимум 1 раз). Login/session-эндпоинты из refresh исключены.
 */

/**
 * Флаги запроса, которые читают интерсепторы. Объявлены расширением типа axios: без этого
 * вызывающий не может их передать — AxiosRequestConfig закрыт для чужих полей.
 */
declare module 'axios' {
  interface AxiosRequestConfig {
    /** Не продлевать сессию на 401 (там, где 401 — штатный ответ, а не протухший access). */
    skipAuthRefresh?: boolean;
    /** Не досылать оверрайд настроек — см. языковую логику интерсептора ниже. */
    skipSettingsOverride?: boolean;
  }
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

// Эндпоинты, где 401 НЕ должен инициировать refresh: по спеке они гостевые и 401 не отдают вовсе.
// Из /v1/session сюда доходит только POST — PATCH и DELETE идут через rawClient, мимо этого
// интерсептора. Сравнение точное: '/v1/sessions' — другой ресурс, чем '/v1/session', и его 401
// продлевать НАДО. По той же причине тут нет '/v1/operation/revoke': отзыв операции — метод
// класса any-users, 401 у него штатный (протухший access), и продлевать его НАДО.
const NO_REFRESH_PATHS = [
  '/v1/signin',
  '/v1/signup',
  '/v1/session',
  '/v1/operation/confirm',
  '/v1/operation/resend',
];
// Группа /v1/check/* гостевая целиком, поэтому матчится префиксом.
const NO_REFRESH_PREFIXES = ['/v1/check/'];

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
  if (access) {
    cfg.headers.set('Authorization', `Bearer ${access}`);
  } else {
    // Пояс окружения — пока нет токена. Заголовок наш, браузер его не поставит (в отличие
    // от Accept-Language), поэтому собираем сами на каждом гостевом запросе: письмо с кодом,
    // даты в ответе и настройки создаваемого профиля берутся из него. С токеном он бессмыслен —
    // по приоритету спеки токен старше заголовка.
    cfg.headers.set('X-Accept-Time-Zone', buildTimeZoneHeader());
  }
  applyLocaleParams(cfg, access);
  return cfg;
});

/**
 * Что послать query-параметром — значение, которого сервер сам не узнает. Правило ОДНО и на язык,
 * и на пояс (query по спеке старше и токена, и заголовка):
 *
 *  1. явный выбор в навигации — устройство-локальный, побеждает всё: гостю на этом языке уйдёт
 *     письмо с кодом, авторизованному это предпросмотр несохранённого значения;
 *  2. окно после сохранения — применённое значение, пока оно не попало в токен;
 *  3. гость с известным значением профиля — токена нет, взять серверу неоткуда.
 *
 * Ничего не подошло → не шлём: у авторизованного всё несёт токен, у гостя — заголовки окружения
 * (`Accept-Language` от браузера, `X-Accept-Time-Zone` от нас — см. интерсептор выше).
 *
 * Пояс сегодня проходит только через (2) — переключателя пояса в навигации ещё НЕТ. Когда
 * появится, он подставит своё значение в `chosen`/`profile`, и правило не изменится: разница
 * между языком и поясом временная и живёт в данных, а не в ветках.
 */
function localeParam(o: {
  chosen?: string;
  profile?: string;
  applied: string | null;
  hasToken: boolean;
}): string | undefined {
  if (o.chosen) return o.chosen;
  if (o.hasToken) return o.applied ?? undefined;
  return o.profile;
}

function applyLocaleParams(cfg: InternalAxiosRequestConfig, access: string | null): void {
  const source = getLanguageSource();
  const override = cfg.skipSettingsOverride ? null : getSettingsOverride();
  const hasToken = Boolean(access);

  const lang = localeParam({
    chosen: source === 'local' ? toLocale(getLanguage()) : undefined,
    profile: source === 'profile' ? toLocale(getLanguage()) : undefined,
    applied: override?.lang ?? null,
    hasToken,
  });
  const tz = localeParam({ applied: override?.tz ?? null, hasToken });

  if (!lang && !tz) return;

  // Явные params вызывающего выигрывают: интерсептор дополняет, но не затирает (getUserSessions
  // уже шлёт realm).
  cfg.params = { ...(lang ? { lang } : {}), ...(tz ? { tz } : {}), ...cfg.params };
}

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
