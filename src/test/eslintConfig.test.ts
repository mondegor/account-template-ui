// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Спека правил no-restricted-syntax из eslint.config.js: запрет dangerouslySetInnerHTML (на нём
 * держится interpolation.escapeValue: false в i18n) и запрет русских фраз в поиске по тексту в
 * тестах. Конфиг загружается настоящий, фрагменты гоняются через ESLint API — спека падает и на
 * сломанном селекторе (fatal при разборе конфига), и на дырке в охвате, и на ложном срабатывании.
 * Правка правила без правки спеки невозможна.
 */

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint();
});

/** Сообщения security-правила для фрагмента; заодно гарантирует, что фрагмент распарсился. */
async function restricted(code: string, filePath = 'src/core/renderer/fixture.tsx') {
  const [result] = await eslint.lintText(code, { filePath });
  expect(result!.messages.filter((m) => m.fatal)).toEqual([]);
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

// Таймаут поднят сверх общего (vite.config.ts): первый lintText прогревает ESLint — загрузку
// конфига со всеми плагинами и typescript-eslint, — и при полном параллельном прогоне это дольше
// всего, что ждут остальные тесты. Запас взят с большим отрывом от наблюдаемого прогрева: тест
// сторожит правило, а не его скорость, и ложное падение на загруженной машине дороже ожидания.
describe('eslint.config.js: the dangerouslySetInnerHTML ban', { timeout: 60000 }, () => {
  it('catches the JSX attribute', async () => {
    const msgs = await restricted(
      'export const C = ({ html }: { html: string }) => (\n' +
        '  <div dangerouslySetInnerHTML={{ __html: html }} />\n' +
        ');\n',
    );
    expect(msgs).toHaveLength(1);
  });

  it('catches an object-literal key (createElement props), and not only in the renderer', async () => {
    const msgs = await restricted(
      'const make = (p: object) => p;\n' +
        "export const x = make({ dangerouslySetInnerHTML: { __html: 'x' } });\n",
      'src/modules/auth/fixture.ts',
    );
    expect(msgs).toHaveLength(1);
  });

  it('catches a string key: quotes do not slip past the ban', async () => {
    const msgs = await restricted(
      "export const p = { 'dangerouslySetInnerHTML': { __html: 'x' } };\n",
    );
    expect(msgs).toHaveLength(1);
  });

  it('catches a shorthand key', async () => {
    const msgs = await restricted(
      'export function wrap(dangerouslySetInnerHTML: object) {\n' +
        '  return { dangerouslySetInnerHTML };\n' +
        '}\n',
    );
    expect(msgs).toHaveLength(1);
  });

  it('catches an object-literal spread in JSX', async () => {
    const msgs = await restricted(
      'export const C = ({ v }: { v: object }) => <div {...{ dangerouslySetInnerHTML: v }} />;\n',
    );
    expect(msgs).toHaveLength(1);
  });

  it('leaves a destructuring read alone (stripping the prop)', async () => {
    const msgs = await restricted(
      'export function strip(props: { dangerouslySetInnerHTML?: object; id?: string }) {\n' +
        '  const { dangerouslySetInnerHTML: drop, ...rest } = props;\n' +
        '  void drop;\n' +
        '  return rest;\n' +
        '}\n',
    );
    expect(msgs).toEqual([]);
  });

  it('leaves an object with an innerHTML key alone: that is data, not a sink', async () => {
    const msgs = await restricted("export const fixture = { innerHTML: '<b>x</b>' };\n");
    expect(msgs).toEqual([]);
  });

  it('leaves a read of el.innerHTML alone', async () => {
    const msgs = await restricted('export const read = (el: HTMLElement) => el.innerHTML;\n');
    expect(msgs).toEqual([]);
  });

  // Блок правил для тестов задаёт no-restricted-syntax заново, а опции этого правила не
  // складываются — без повторённого селектора запрет молча перестал бы действовать в *.test.tsx.
  it('applies in tests too, where the rule is declared by a second block', async () => {
    const msgs = await restricted(
      "export const p = { dangerouslySetInnerHTML: { __html: 'x' } };\n",
      'src/modules/auth/fixture.test.tsx',
    );
    expect(msgs).toHaveLength(1);
  });
});

/** Фрагмент проверяется как тест: правило про фразы включено только для *.test.{ts,tsx}. */
const TEST_FILE = 'src/modules/auth/fixture.test.tsx';

describe('eslint.config.js: Russian phrases in text queries', { timeout: 60000 }, () => {
  it('catches a label in screen.getByText', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByText('Личные данные');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(1);
  });

  it('catches every query form: find/query, All, within(...)', async () => {
    const msgs = await restricted(
      "export const a = () => screen.findAllByText('Телефон');\n" +
        "export const b = () => within(card).queryByText('Язык');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  it('catches the card and row helpers', async () => {
    const msgs = await restricted(
      "export const a = cardWith('Личные данные');\nexport const b = rowValue('Часовой пояс');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  // Подпись поля ищут по её label, и это ровно та же фраза с экрана, что у getByText.
  it('catches a label in a ByLabelText query', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByLabelText('Код подтверждения');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(1);
  });

  // У ByRole фраза лежит не аргументом, а в опции `name`, — на неё нужен свой селектор, иначе
  // самая частая форма поиска кнопок прошла бы мимо запрета.
  it('catches an accessible name in a ByRole query', async () => {
    const msgs = await restricted(
      "export const a = () => screen.getByRole('button', { name: 'Сохранить' });\n" +
        "export const b = () => getAllByRole('link', { name: /Профиль/ });\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  // toHaveTextContent сверяет тот же экранный текст — просто со стороны утверждения, а не поиска.
  it('catches a phrase in toHaveTextContent', async () => {
    const msgs = await restricted(
      "export const check = (el: HTMLElement) => expect(el).toHaveTextContent('Демо-модуль');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(1);
  });

  // Обёртки над селектом живут в самом тесте страницы, но подпись принимают такую же.
  it('catches the local select helpers', async () => {
    const msgs = await restricted(
      "export const a = selectValue('Язык');\nexport const b = () => choose('Часовой пояс', 'x');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  it('leaves a role query alone when its name comes from tr()', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByRole('button', { name: tr('auth.settings.save') });\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  it('catches a label built with a template string, in a query and in a helper alike', async () => {
    const msgs = await restricted(
      'export const a = (n: number) => screen.getByText(`Сессии (${n})`);\n' +
        'export const b = (n: number) => getByText(`Сессии (${n})`);\n' +
        'export const c = (n: number) => cardWith(`Сессии (${n})`);\n',
      TEST_FILE,
    );
    expect(msgs).toHaveLength(3);
  });

  // Регулярка — обычный способ искать подпись по куску текста, и обходить ею запрет нельзя:
  // у regex-литерала фраза лежит не в `value` (там объект RegExp), а в `regex.pattern`.
  it('catches a label written as a regular expression', async () => {
    const msgs = await restricted(
      'export const a = () => screen.getByText(/Личные данные/);\n' +
        'export const b = () => rowValue(/Часовой пояс/);\n',
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  it('leaves a key passed through tr() alone: that is the whole point', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByText(tr('auth.profile.personalInfo'));\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  it('leaves fixtures alone: server-side values are not interface labels', async () => {
    const msgs = await restricted(
      "export const device = { device_name: 'Рабочий ноутбук' };\n" +
        "export const detail = { detail: 'Часовой пояс не поддерживается' };\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  // Фикстуру ищут по её же значению, и поднятая в константу фраза правилу не видна — это не
  // дырка, а способ отличить данные от подписи интерфейса. Обратная сторона: спрятать так можно
  // и настоящую подпись, поэтому правило — подсказка, а не гарантия.
  it('leaves a phrase lifted into a constant alone', async () => {
    const msgs = await restricted(
      "const DEVICE = 'Рабочий ноутбук';\nexport const found = () => screen.getByText(DEVICE);\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  it('leaves an expected value alone: there the literal is the reference itself', async () => {
    const msgs = await restricted(
      "export const check = (el: HTMLElement) => expect(el.textContent).toBe('Русский');\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  it('leaves ordinary code outside tests alone', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByText('Личные данные');\n",
      'src/modules/auth/fixture.tsx',
    );
    expect(msgs).toEqual([]);
  });
});
