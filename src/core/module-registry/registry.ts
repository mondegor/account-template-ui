import { createElement } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { registerComponent, registerSchema } from '@core/schema';
import { addTranslations } from '@core/i18n';
import { RoleGuard, getUserRoles } from '@core/auth';
import type { ModuleDefinition, ModuleInitContext, NavItem } from './types';

/**
 * Реестр модулей: детерминированный массив, дубль id → fail-fast. registerModule применяет
 * декларативные поля (i18n/схемы/типы узлов), затем onInit(ctx). buildRoutes/buildNav собирают
 * роуты и навигацию для app-слоя; фильтр по ролям — через getUserRoles (пока []).
 */

const modules: ModuleDefinition[] = [];

export function registerModule(def: ModuleDefinition, ctx: ModuleInitContext): void {
  if (modules.some((m) => m.id === def.id)) {
    throw new Error(`module-registry: модуль "${def.id}" уже зарегистрирован`);
  }
  if (def.i18n) addTranslations(def.i18n);
  if (def.schemas) {
    for (const [id, source] of Object.entries(def.schemas)) registerSchema(id, source);
  }
  if (def.componentTypes) {
    for (const [type, component] of Object.entries(def.componentTypes)) {
      registerComponent(type, component);
    }
  }
  modules.push(def);
  def.onInit?.(ctx);
}

export function getModules(): readonly ModuleDefinition[] {
  return modules;
}

/** Есть ли доступ к модулю по ролям (requiredRoles пуст → да). */
function isAllowed(def: ModuleDefinition): boolean {
  if (!def.requiredRoles || def.requiredRoles.length === 0) return true;
  const roles = getUserRoles();
  return def.requiredRoles.some((r) => roles.includes(r));
}

/** Собирает роуты из модулей + app-level fallback. Роуты модуля с requiredRoles оборачиваются RoleGuard. */
export function buildRoutes(): RouteObject[] {
  const routes: RouteObject[] = [];
  for (const def of modules) {
    for (const route of def.routes) {
      routes.push(
        def.requiredRoles?.length
          ? {
              ...route,
              element: createElement(RoleGuard, {
                requiredRoles: def.requiredRoles,
                children: route.element,
              }),
            }
          : route,
      );
    }
  }
  routes.push({ path: '*', element: createElement(Navigate, { to: '/signin', replace: true }) });
  return routes;
}

/** Плоский список пунктов навигации из доступных по ролям модулей. */
export function buildNav(): NavItem[] {
  return modules.filter(isAllowed).flatMap((def) => def.nav ?? []);
}

/** Только для тестов: очистить реестр модулей (реестры схем/компонентов сбрасывать отдельно). */
export function resetRegistry(): void {
  modules.length = 0;
}
