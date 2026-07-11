import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { loadSchema, resetComponents, resetHandlers, resetSchemas } from '@core/schema';
import { initI18n } from '@core/i18n';
import {
  buildNav,
  buildRoutes,
  moduleQueryKey,
  registerModule,
  resetRegistry,
} from './index';
import type { ModuleDefinition, ModuleInitContext } from './types';

const ctx: ModuleInitContext = {
  queryClient: new QueryClient(),
  contracts: contractRegistry,
  realmProvider,
};

function mod(over: Partial<ModuleDefinition> & { id: string }): ModuleDefinition {
  return { routes: [{ path: `/${over.id}`, element: createElement('div') }], ...over };
}

beforeEach(() => {
  initI18n();
  resetRegistry();
  resetSchemas();
  resetComponents();
  resetHandlers();
});

describe('module-registry', () => {
  it('дубль id модуля → fail-fast', () => {
    registerModule(mod({ id: 'a' }), ctx);
    expect(() => registerModule(mod({ id: 'a' }), ctx)).toThrow(/уже зарегистрирован/);
  });

  it('buildRoutes: роуты модулей + app-level fallback "*"', () => {
    registerModule(mod({ id: 'a' }), ctx);
    registerModule(mod({ id: 'b' }), ctx);
    const routes = buildRoutes();
    expect(routes.some((r) => r.path === '/a')).toBe(true);
    expect(routes.some((r) => r.path === '/b')).toBe(true);
    expect(routes[routes.length - 1]?.path).toBe('*');
  });

  it('применяет декларативные схемы и onInit', () => {
    let inited = false;
    registerModule(
      mod({
        id: 'a',
        schemas: { 'a.home': { id: 'a.home', type: 'text', text: 'x' } },
        onInit: () => {
          inited = true;
        },
      }),
      ctx,
    );
    expect(() => loadSchema('a.home')).not.toThrow();
    expect(inited).toBe(true);
  });

  it('buildNav: пока роли не применяются (rolesEnforced=false), requiredRoles никого не отсекает', () => {
    registerModule(mod({ id: 'a', nav: [{ id: 'n', label: 'l', route: '/a' }] }), ctx);
    registerModule(
      mod({ id: 'b', requiredRoles: ['admin'], nav: [{ id: 'n2', label: 'l2', route: '/b' }] }),
      ctx,
    );
    const nav = buildNav();
    // Источника ролей ещё нет (rolesEnforced=false) → requiredRoles не блокирует: видны оба пункта.
    expect(nav.map((i) => i.id)).toEqual(['n', 'n2']);
    // Роут b тоже присутствует (обёрнут RoleGuard) — доступ решится на роуте, когда роли включат.
    expect(buildRoutes().some((r) => r.path === '/b')).toBe(true);
  });

  it('moduleQueryKey — конвенция [moduleId, entity, ...params]', () => {
    expect(moduleQueryKey('auth', 'user', 42)).toEqual(['auth', 'user', 42]);
  });
});
