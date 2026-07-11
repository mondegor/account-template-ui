import type { ModuleDefinition } from '@core/module-registry';
import { DemoPage } from './pages/DemoPage';
import { demoTranslations } from './i18n';
import homeSchema from './schemas/home.json';

/**
 * Демо-модуль — доказательство расширяемости: один публичный роут + JSON-страница + пункт nav +
 * переводы. Подключается добавлением в список модулей app/modules.ts; ядро не трогается.
 */
export const demoModule: ModuleDefinition = {
  id: 'demo',
  routes: [{ path: '/demo', element: <DemoPage /> }],
  nav: [{ id: 'demo.home', label: 'demo.nav.home', route: '/demo' }],
  schemas: { 'demo.home': homeSchema },
  i18n: demoTranslations,
};
