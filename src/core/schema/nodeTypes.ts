import { NODE_TYPES, FIELD_TYPES } from './types';

/**
 * Рантайм-реестр типов узлов. Засеян встроенными `NODE_TYPES`/`FIELD_TYPES`; модули добавляют свои
 * типы-поля через `registerFieldType` (напр. auth регистрирует `auth.emailField`) — ядро при этом не
 * знает конкретных имён модулей. `isKnownNodeType` использует validate.ts (fail-closed на чужой тип),
 * `isFieldType` — сборка zod/дефолтов в renderer (поле участвует в форме).
 */

const knownNodeTypes = new Set<string>(NODE_TYPES);
const fieldNodeTypes = new Set<string>(FIELD_TYPES);

/** Регистрирует кастомный тип узла как поле формы (участвует в валидации/дефолтах и допускается схемой). */
export function registerFieldType(type: string): void {
  knownNodeTypes.add(type);
  fieldNodeTypes.add(type);
}

/** Тип-поле (встроенный или зарегистрированный) — участвует в сборке zod/дефолтов формы. */
export function isFieldType(type: string): boolean {
  return fieldNodeTypes.has(type);
}

/** Известный тип узла (встроенный или зарегистрированный) — иначе схема отклоняется (fail-closed). */
export function isKnownNodeType(type: string): boolean {
  return knownNodeTypes.has(type);
}

/** Только для тестов: вернуть реестр к встроенным типам. */
export function resetNodeTypes(): void {
  knownNodeTypes.clear();
  NODE_TYPES.forEach((t) => knownNodeTypes.add(t));
  fieldNodeTypes.clear();
  FIELD_TYPES.forEach((t) => fieldNodeTypes.add(t));
}
