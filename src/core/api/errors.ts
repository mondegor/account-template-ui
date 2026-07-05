import { AxiosError } from 'axios';
import type {
  ConfirmOperationState,
  ErrorAttribute,
  ErrorDetailsBody,
  OperationError400Body,
} from './types';

/**
 * Классы ошибок по форме тела (backend_answers §5, §6):
 *  - ApiFieldError  — 400 application/json: ошибки полей (+ опц. operation_state) → на форму/движок.
 *  - ApiProblemError — RFC 9457 problem+json: 401/403/404/5xx → глобальные уведомления.
 *  - ApiTransportError — сеть/таймаут/неизвестное.
 */

export class ApiFieldError extends Error {
  readonly fields: ErrorAttribute[];
  readonly operationState?: ConfirmOperationState;
  readonly status: number;
  constructor(fields: ErrorAttribute[], status: number, operationState?: ConfirmOperationState) {
    super(fields[0]?.detail ?? 'Некорректные данные');
    this.name = 'ApiFieldError';
    this.fields = fields;
    this.status = status;
    this.operationState = operationState;
  }
}

export class ApiProblemError extends Error {
  readonly status: number;
  readonly details: ErrorDetailsBody;
  constructor(details: ErrorDetailsBody) {
    super(details.title || details.detail || 'Ошибка сервиса');
    this.name = 'ApiProblemError';
    this.status = details.status;
    this.details = details;
  }
}

export class ApiTransportError extends Error {
  constructor(message = 'Сеть недоступна') {
    super(message);
    this.name = 'ApiTransportError';
  }
}

export type ApiError = ApiFieldError | ApiProblemError | ApiTransportError;

function isProblemJson(contentType: string | undefined): boolean {
  return !!contentType && contentType.includes('application/problem+json');
}

/** Приводит любую ошибку axios к типизированному ApiError. 404 → ApiProblemError (общее увед.). */
export function normalizeError(err: unknown): ApiError {
  if (!(err instanceof AxiosError)) {
    return new ApiTransportError(err instanceof Error ? err.message : undefined);
  }
  const res = err.response;
  if (!res) return new ApiTransportError(err.message);

  const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
  const data = res.data as unknown;

  // Плоская/операционная 400: application/json с errors[]
  if (
    res.status === 400 &&
    !isProblemJson(contentType) &&
    data &&
    typeof data === 'object' &&
    Array.isArray((data as OperationError400Body).errors)
  ) {
    const body = data as OperationError400Body;
    return new ApiFieldError(body.errors, 400, body.operation_state);
  }

  // RFC 9457 problem+json: 401/403/404/5xx
  if (data && typeof data === 'object' && typeof (data as ErrorDetailsBody).status === 'number') {
    return new ApiProblemError(data as ErrorDetailsBody);
  }

  return new ApiProblemError({
    title: 'Ошибка сервиса',
    status: res.status,
    detail: err.message,
    instance: `${err.config?.method?.toUpperCase() ?? ''} ${err.config?.url ?? ''}`,
    time: new Date().toISOString(),
  });
}
