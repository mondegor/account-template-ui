import { useMemo } from 'react';
import { useRoutes } from 'react-router-dom';
import { buildRoutes } from '@core/module-registry';

/**
 * Роуты собираются из реестра модулей (buildRoutes) — прямого списка больше нет. Модули должны
 * быть зарегистрированы при бутстрапе (main.tsx) до первого рендера.
 */
export function AppRoutes() {
  const routes = useMemo(() => buildRoutes(), []);
  return useRoutes(routes);
}
