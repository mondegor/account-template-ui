import type { RouteObject } from 'react-router-dom';
import type { QueryClient } from '@tanstack/react-query';
import type { NodeComponent } from '@core/schema';
import type { ContractRegistry } from '@core/contracts';
import type { realmProvider } from '@core/auth';

/**
 * Контракт модуля приложения. Модуль ДЕКЛАРАТИВНО описывает свои роуты/навигацию/схемы/типы
 * узлов/переводы; императивные extras (регистрация schemaHandlers и т.п.) — в onInit. Реестр
 * собирает из этого роуты и навигацию — добавление модуля не требует правок ядра (plan.txt §7).
 */
export interface ModuleDefinition {
  /** namespace модуля (уникален; префикс schemaId/componentType/query-key). */
  id: string;
  routes: RouteObject[];
  nav?: NavItem[];
  /** роли для доступа: фильтруют роуты (обёртка RoleGuard) и nav. Источник ролей пока []. */
  requiredRoles?: string[];
  apiBaseUrl?: string;
  /** локальные JSON-схемы: id → источник (проходят validate при registerSchema). */
  schemas?: Record<string, unknown>;
  /** доп. типы узлов рендерера: componentType → компонент. */
  componentTypes?: Record<string, NodeComponent>;
  /** переводы модуля: { ru, en } (ветка своего namespace) → addTranslations. */
  i18n?: Record<string, Record<string, unknown>>;
  onInit?: (ctx: ModuleInitContext) => void;
}

/** Пункт двухуровневого меню (третий уровень — тип заложен, в UI пока 2 уровня). */
export interface NavChild {
  id: string;
  label: string;
  route: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon?: string;
  route?: string;
  children?: NavChild[];
}

/** Узко типизированный контекст инициализации модуля (не any). */
export interface ModuleInitContext {
  queryClient: QueryClient;
  contracts: ContractRegistry;
  realmProvider: typeof realmProvider;
}
