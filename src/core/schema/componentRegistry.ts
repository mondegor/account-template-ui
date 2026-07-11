import type { ComponentType, ReactNode } from 'react';
import type { SchemaNode } from './types';

/**
 * Реестр `componentType → React-компонент`. Базовые типы регистрирует ядро
 * (registerBaseComponents), модули добавляют свои (напр. confirmOperation) — не трогая ядро.
 * Дубль типа → fail-fast (override базовых запрещён, plan.txt §«Конфликты id»).
 */

export interface NodeComponentProps {
  node: SchemaNode;
  /** Предрендеренные дочерние узлы (для контейнеров page/section/grid). */
  children?: ReactNode;
}

export type NodeComponent = ComponentType<NodeComponentProps>;

const registry = new Map<string, NodeComponent>();

export function registerComponent(type: string, component: NodeComponent): void {
  if (registry.has(type)) {
    throw new Error(`componentRegistry: тип "${type}" уже зарегистрирован (override запрещён)`);
  }
  registry.set(type, component);
}

export function getComponent(type: string): NodeComponent | undefined {
  return registry.get(type);
}

export function hasComponent(type: string): boolean {
  return registry.has(type);
}

/** Только для тестов: очистить реестр. */
export function resetComponents(): void {
  registry.clear();
}
