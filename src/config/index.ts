/**
 * Единая точка чтения env-конфига. Значения ограничений (email/secret/token) — из openapi,
 * держим здесь для тест-сверки и валидации форм.
 */

export type TokenMode = 'cookie' | 'body';

export const config = {
  authApiBaseUrl: import.meta.env.VITE_AUTH_API_BASE_URL ?? '/api/auth',
  /** realm-константа деплоя; обязателен на signin/signup/check-login (backend_answers §7). */
  realm: import.meta.env.VITE_AUTH_REALM ?? 'print-shop/standard',
  tokenMode: (import.meta.env.VITE_TOKEN_MODE ?? 'cookie') as TokenMode,
  enableMocks: import.meta.env.VITE_ENABLE_MOCKS === '1',
} as const;

/** Ограничения полей из openapi.yaml — сверяются тестом constants.test.ts. */
export const limits = {
  userLogin: { min: 7, max: 64 },
  secret: { min: 4, max: 32 },
  token: { min: 64, max: 128 },
  realm: { max: 32 },
} as const;

/** За сколько секунд до истечения access делаем проактивный refresh (backend_answers §3). */
export const PROACTIVE_REFRESH_SKEW_SEC = 30;
