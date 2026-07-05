import { config } from '@config';

/**
 * Стратегия хранения refresh-токена:
 *  - cookie-mode (веб-прод): refresh живёт в HttpOnly-cookie RTID, JS его НЕ видит.
 *    Открытие сессии идёт с заголовком X-Use-Cookie: true; продление берёт refresh из куки.
 *  - body-mode (dev/кросс-домен): refresh — ТОЛЬКО в памяти (никакого localStorage),
 *    шлётся в теле ContinueSession.refresh_token; после reload silent-refresh невозможен.
 *
 * Никогда не кладём токены в localStorage/sessionStorage. См. память [[token-storage]].
 */

let memoryRefresh: string | null = null;

export interface TokenStorage {
  readonly mode: 'cookie' | 'body';
  /** Слать ли X-Use-Cookie: true при открытии сессии. */
  readonly useCookieHeader: boolean;
  /** refresh для тела запроса продления (body-mode); в cookie-mode — null (берётся из куки). */
  getRefreshForBody(): string | null;
  /** Сохранить refresh из ответа (body-mode). В cookie-mode — no-op (кука ставится сервером). */
  setRefreshFromBody(token: string | undefined): void;
  clear(): void;
}

export const tokenStorage: TokenStorage = {
  mode: config.tokenMode,
  useCookieHeader: config.tokenMode === 'cookie',
  getRefreshForBody() {
    return config.tokenMode === 'body' ? memoryRefresh : null;
  },
  setRefreshFromBody(token) {
    if (config.tokenMode === 'body' && token) memoryRefresh = token;
  },
  clear() {
    memoryRefresh = null;
  },
};
