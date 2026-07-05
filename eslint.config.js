import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat config (ESLint 10). Границы слоёв:
 *  - boundaries/dependencies — направление зависимостей между элементами. Импорты ВНУТРИ одного
 *    элемента (относительные `./x`) boundaries игнорирует, поэтому «модуль → свой же модуль»
 *    разрешать не нужно: достаточно не давать modules импортировать элемент modules вообще —
 *    кросс-модульный `@modules/other` станет ошибкой, а внутримодульные relative-импорты пройдут.
 *  - import/no-internal-modules — barrels: кросс-пакетный alias-импорт только через index
 *    (`@core/api`), глубокий `@core/api/errors` запрещён. Относительные импорты не трогаются.
 * prettier-config идёт последним — гасит стилевые правила (форматирование за Prettier).
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'public/mockServiceWorker.js'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
      boundaries,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
      'boundaries/elements': [
        { type: 'config', pattern: 'src/config' },
        { type: 'mocks', pattern: 'src/mocks' },
        { type: 'shared', pattern: 'src/shared' },
        { type: 'ui', pattern: 'src/ui' },
        { type: 'core', pattern: 'src/core/*', capture: ['pkg'] },
        { type: 'modules', pattern: 'src/modules/*', capture: ['module'] },
        { type: 'app', pattern: 'src/app' },
      ],
      'boundaries/ignore': ['src/main.tsx', '**/*.test.{ts,tsx}', 'src/test/**'],
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      'no-console': 'warn',

      // Ленивый цикл core/api ↔ core/auth безопасен (ссылки в колбэках) → warn, не error.
      'import/no-cycle': 'warn',

      // Barrels: запрет глубоких кросс-пакетных alias-импортов (относительные разрешены).
      'import/no-internal-modules': [
        'error',
        { forbid: ['@core/*/*', '@modules/*/*', '@app/*/*'] },
      ],

      // Направление зависимостей: modules/app → core/ui/shared/config; core не тянет modules/app;
      // modules не импортируют другие modules; mocks (dev-инфра) видит modules/core/config.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { types: 'app' } },
              allow: {
                to: {
                  element: { types: { anyOf: ['core', 'modules', 'config', 'ui', 'shared'] } },
                },
              },
            },
            {
              from: { element: { types: 'modules' } },
              allow: { to: { element: { types: { anyOf: ['core', 'config', 'ui', 'shared'] } } } },
            },
            {
              from: { element: { types: 'core' } },
              allow: { to: { element: { types: { anyOf: ['core', 'config', 'ui', 'shared'] } } } },
            },
            {
              from: { element: { types: 'ui' } },
              allow: { to: { element: { types: { anyOf: ['ui', 'shared', 'config'] } } } },
            },
            {
              from: { element: { types: 'shared' } },
              allow: { to: { element: { types: { anyOf: ['shared', 'config'] } } } },
            },
            {
              from: { element: { types: 'config' } },
              allow: { to: { element: { types: 'config' } } },
            },
            {
              from: { element: { types: 'mocks' } },
              allow: {
                to: { element: { types: { anyOf: ['mocks', 'modules', 'core', 'config'] } } },
              },
            },
          ],
        },
      ],
    },
  },

  // Тесты + setup — vitest globals в node-среде.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Конфиги в корне — node-среда.
  {
    files: ['*.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
);
