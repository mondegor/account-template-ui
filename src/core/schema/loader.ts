import { validateSchema } from './validate';
import type { SchemaNode, SchemaSource } from './types';

/**
 * Загрузчик локальных схем: по `id` отдаёт валидированное дерево из бандла модуля. Схема проходит
 * validate.ts при регистрации (fail-fast на бутстрапе), а не при каждом рендере. Server-Driven UI
 * в каркас не закладывается — источник только локальный.
 */

const schemas = new Map<string, SchemaNode>();

/** Регистрация локальной схемы модуля (напр. import signup.json). Валидирует немедленно. */
export function registerSchema(id: string, source: SchemaSource): void {
  if (schemas.has(id)) {
    throw new Error(`loader: схема "${id}" уже зарегистрирована`);
  }
  schemas.set(id, validateSchema(source));
}

/** Возвращает валидированное дерево схемы по id (бросает, если не зарегистрирована). */
export function loadSchema(id: string): SchemaNode {
  const node = schemas.get(id);
  if (!node) throw new Error(`loader: схема "${id}" не найдена`);
  return node;
}

/** Только для тестов: очистить реестр схем. */
export function resetSchemas(): void {
  schemas.clear();
}
