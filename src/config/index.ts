/**
 * Единая точка чтения env-конфига. Значения ограничений (email/secret/token) — из openapi,
 * держим здесь для тест-сверки и валидации форм.
 */

export type TokenMode = 'cookie' | 'body';

export const config = {
  authApiBaseUrl: import.meta.env.VITE_AUTH_API_BASE_URL ?? '/api/auth',
  /** realm-константа деплоя; обязателен на signin/signup/check-login — дефолта бэкенд не
   *  подставляет, без realm запрос падает с 400. */
  realm: import.meta.env.VITE_AUTH_REALM ?? 'print-shop/standard',
  tokenMode: (import.meta.env.VITE_TOKEN_MODE ?? 'cookie') as TokenMode,
  enableMocks: import.meta.env.VITE_ENABLE_MOCKS === '1',
} as const;

/**
 * Границы полей, которые пользователь вводит руками, — из openapi.yaml, сверяются тестом
 * constants.test.ts. Форма отсекает по ним заведомо невалидное до запроса.
 *
 * Всё остальное сюда не попадает: значения из справочников и селектов набрать нельзя, константы
 * деплоя приходят из env, а данные из ответов бэка проверять незачем.
 */
export const limits = {
  userLogin: { min: 7, max: 64 },
  secret: { min: 4, max: 32 },
} as const;

/**
 * За сколько секунд до истечения access делаем проактивный refresh. Сам срок жизни не хардкодим:
 * он приходит в expires_in каждого ответа и заметно разный по режимам деплоя (минуты у jwt,
 * десятки минут у непрозрачного access) — здесь только запас на дорогу до сервера.
 */
export const PROACTIVE_REFRESH_SKEW_SEC = 30;
