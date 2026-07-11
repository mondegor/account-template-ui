import type { NavigateFunction } from 'react-router-dom';
import type { OperationAction } from '@core/operation';

/**
 * Связь «схема → обработчик» вне JSON: `schemaId → { handler, asyncValidators? }` задаётся кодом
 * модуля при бутстрапе. Обработчик инкапсулирует маппинг значений формы в DTO, вызов API/operation
 * engine и навигацию; ошибки (ApiFieldError/ApiProblemError) он пробрасывает — их маппит FormRenderer.
 */

export interface HandlerContext {
  navigate: NavigateFunction;
  /** realm-константа деплоя (из realmProvider); обработчик подставляет её в DTO. */
  realm: string;
  /** Диспатч в generic-движок операций (START активной операции и т.п.). */
  dispatchOperation: (action: OperationAction) => void;
}

export type SchemaHandler = (
  values: Record<string, unknown>,
  ctx: HandlerContext,
) => Promise<void>;

/** Возвращает текст ошибки (готовый к показу) или null, если значение валидно. */
export type AsyncValidator = (
  value: unknown,
  values: Record<string, unknown>,
) => Promise<string | null>;

export interface HandlerEntry {
  handler: SchemaHandler;
  /** Асинхронные проверки по имени поля (напр. доступность email) — прогоняются на submit. */
  asyncValidators?: Record<string, AsyncValidator>;
}

const handlers = new Map<string, HandlerEntry>();

export function registerHandler(schemaId: string, entry: HandlerEntry): void {
  if (handlers.has(schemaId)) {
    throw new Error(`schemaHandlers: обработчик "${schemaId}" уже зарегистрирован`);
  }
  handlers.set(schemaId, entry);
}

export function getHandler(schemaId: string): HandlerEntry | undefined {
  return handlers.get(schemaId);
}

/** Только для тестов: очистить реестр. */
export function resetHandlers(): void {
  handlers.clear();
}
