import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat config (ESLint 10). Границы слоёв:
 *  - boundaries/dependencies — направление зависимостей между элементами. Импорты ВНУТРИ одного
 *    элемента (относительные `./x`) boundaries игнорирует, поэтому «модуль → свой же модуль»
 *    разрешать не нужно: достаточно не давать modules импортировать элемент modules вообще —
 *    кросс-модульный `@modules/other` станет ошибкой, а внутримодульные relative-импорты пройдут.
 *  - import-x/no-internal-modules — barrels: кросс-пакетный alias-импорт только через index
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
      'import-x': importPlugin,
      boundaries,
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
      // Обход графа зависимостей (no-cycle) фильтрует файлы по этому списку, а дефолт — только
      // js/jsx. Без .ts/.tsx правило доходит до первого импорта и молча ничего не находит.
      'import-x/extensions': ['.ts', '.tsx', '.js', '.jsx'],
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

      // Циклов быть не должно. Обычный их источник тут — не сам код, а баррель: пакет склеивает
      // в один узел слой, который нужен его же потребителям, со слоем, который от них зависит,
      // и граф файлов остаётся ацикличным, а граф пакетов — уже нет. Лечится разделением пакета
      // (так появился @core/request-meta), а не ослаблением правила.
      'import-x/no-cycle': 'error',

      // Barrels: запрет глубоких кросс-пакетных alias-импортов (относительные разрешены).
      'import-x/no-internal-modules': [
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

  // Единственное security-правило линта: запрет dangerouslySetInnerHTML во всём src.
  //
  // Модель угроз. i18n работает с interpolation.escapeValue: false (штатно для react-i18next),
  // то есть безопасность переводов и данных держится ровно на одном: в DOM они попадают только
  // через React-экранирование (JSX-текст и атрибуты). Значит, линт должен закрывать пути
  // «данные → HTML-рендер мимо React». В React-приложении таких путей два:
  //  1. dangerouslySetInnerHTML — единственная штатная дверь самого React и единственный
  //     реалистичный способ случайно отрендерить перевод/данные как HTML. Закрыта этим правилом
  //     (плюс второй эшелон: validateSchema отклоняет проп на входе схемы — validate.test.ts).
  //  2. Императивные DOM-синки (innerHTML=, insertAdjacentHTML, document.write, DOMParser, ...)
  //     — требуют ref на элемент и сознательного императивного кода. В src такого кода нет
  //     вовсе (ни одного ref на DOM-элемент, весь UI — MUI/JSX), а список синков — открытое
  //     множество: самописный блок-лист здесь только распухал и полноты всё равно не давал.
  //     Сознательно НЕ линтуется. Появится императивный DOM-код — подключить стандартный
  //     eslint-plugin-no-unsanitized (Mozilla), а не дописывать селекторы.
  // Почему не react/no-danger: по умолчанию warn, видит только DOM-элементы (кастомные
  // компоненты — через customComponentNames) и тянет весь eslint-plugin-react ради одного
  // правила.
  //
  // Три селектора — все формы записи одного пропа: JSX-атрибут; ключ-идентификатор в
  // объекте-литерале (createElement-пропсы, спреды, shorthand); строковый ключ. Якорь
  // «ObjectExpression >» оставляет в покое ObjectPattern — деструктуризация-чтение
  // (const { dangerouslySetInnerHTML, ...rest } = props) не источник HTML и не флагается.
  // Контракт закреплён спекой src/test/eslintConfig.test.ts (гоняет этот конфиг через
  // ESLint API) — правило меняется только вместе с ней.
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='dangerouslySetInnerHTML']," +
            "ObjectExpression > Property[key.name='dangerouslySetInnerHTML']," +
            "ObjectExpression > Property[key.value='dangerouslySetInnerHTML']",
          message:
            'dangerouslySetInnerHTML запрещён: переводы и данные попадают в JSX как текст, ' +
            'экранирует React (на этом держится i18n escapeValue: false).',
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
