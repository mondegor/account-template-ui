/** Ядровые DTO ошибок из openapi (общие для всех модулей). */

/**
 * Один элемент списка `errors` в ответе 400 (`Api.Response.Model.ErrorAttribute`).
 *
 * `code` принимает одну из двух форм:
 *  - `КодОшибки` — запрос отклонён по существу, а не по значению поля (состояние аккаунта, лимит
 *    сервера); поля формы у такой ошибки нет, её показывают общим уведомлением;
 *  - `КодОшибки/имя_поля` — суффикс после ПЕРВОГО `/` совпадает с именем поля в JSON запроса,
 *    поэтому ошибка ложится под соответствующее поле формы, а префикс объясняет причину отказа.
 *
 * Разбирать это правило руками не нужно — есть ApiFieldError.split() (@core/api/errors).
 */
export interface ErrorAttribute {
  code: string;
  detail: string;
}

/** Плоская 400 (`Api.Response.Model.Error400`). */
export interface Error400Body {
  status?: number;
  instance?: string;
  errors: ErrorAttribute[];
  time?: string;
}

/**
 * Состояние операции подтверждения (`Auth.Response.Model.ConfirmOperationState`).
 * Приходит вложенным в 400 на confirm / open-session / resend — и только на них; читать его
 * нужно «если присутствует» (на входной валидации токена приходит плоская 400 без счётчиков).
 */
export interface ConfirmOperationState {
  remaining_attempts: number;
  expires_in: number;
  remaining_resends?: number;
  resends_in?: number;
}

/** 400 с состоянием операции (`Auth.ResponseJson.Error400`). */
export interface OperationError400Body extends Error400Body {
  operation_state?: ConfirmOperationState;
}

/**
 * RFC 9457 problem+json (`Api.Response.Model.ErrorDetails`) — всё, кроме 400:
 * 401/403/404/422/429/5xx.
 * Машиночитаемого `code` в теле нет: причина отказа задана самим методом и статусом.
 */
export interface ErrorDetailsBody {
  type?: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  time: string;
  error_trace_id?: string;
}
