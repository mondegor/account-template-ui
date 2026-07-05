/** Ядровые DTO ошибок из openapi (общие для всех модулей). */

/** Один атрибут ошибки валидации 400: `code` = имя поля формы. */
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
 * Приходит вложенным в 400 на confirm / open-session / resend (backend_answers §6).
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

/** RFC 9457 problem+json (`Api.Response.Model.ErrorDetails`) — 401/403/404/5xx. */
export interface ErrorDetailsBody {
  type?: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  time: string;
  error_trace_id?: string;
}
