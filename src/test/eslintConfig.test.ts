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
describe('eslint.config.js — запрет dangerouslySetInnerHTML', { timeout: 60000 }, () => {
  it('ловит JSX-атрибут', async () => {
    const msgs = await restricted(
      'export const C = ({ html }: { html: string }) => (\n' +
        '  <div dangerouslySetInnerHTML={{ __html: html }} />\n' +
        ');\n',
    );
    expect(msgs).toHaveLength(1);
  });

  it('ловит ключ объекта-литерала (createElement-пропсы) — и не только в renderer', async () => {
    const msgs = await restricted(
      'const make = (p: object) => p;\n' +
        "export const x = make({ dangerouslySetInnerHTML: { __html: 'x' } });\n",
      'src/modules/auth/fixture.ts',
    );
    expect(msgs).toHaveLength(1);
  });

  it('ловит строковый ключ — кавычки не обходят запрет', async () => {
    const msgs = await restricted(
      "export const p = { 'dangerouslySetInnerHTML': { __html: 'x' } };\n",
    );
    expect(msgs).toHaveLength(1);
  });

  it('ловит shorthand-ключ', async () => {
    const msgs = await restricted(
      'export function wrap(dangerouslySetInnerHTML: object) {\n' +
        '  return { dangerouslySetInnerHTML };\n' +
        '}\n',
    );
    expect(msgs).toHaveLength(1);
  });

  it('ловит спред объекта-литерала в JSX', async () => {
    const msgs = await restricted(
      'export const C = ({ v }: { v: object }) => <div {...{ dangerouslySetInnerHTML: v }} />;\n',
    );
    expect(msgs).toHaveLength(1);
  });

  it('не трогает деструктуризацию-чтение (снятие пропа)', async () => {
    const msgs = await restricted(
      'export function strip(props: { dangerouslySetInnerHTML?: object; id?: string }) {\n' +
        '  const { dangerouslySetInnerHTML: drop, ...rest } = props;\n' +
        '  void drop;\n' +
        '  return rest;\n' +
        '}\n',
    );
    expect(msgs).toEqual([]);
  });

  it('не трогает объект с ключом innerHTML — это данные, а не синк', async () => {
    const msgs = await restricted("export const fixture = { innerHTML: '<b>x</b>' };\n");
    expect(msgs).toEqual([]);
  });

  it('не трогает чтение el.innerHTML', async () => {
    const msgs = await restricted('export const read = (el: HTMLElement) => el.innerHTML;\n');
    expect(msgs).toEqual([]);
  });

  // Блок правил для тестов задаёт no-restricted-syntax заново, а опции этого правила не
  // складываются — без повторённого селектора запрет молча перестал бы действовать в *.test.tsx.
  it('действует и в тестах, где правило задано вторым блоком', async () => {
    const msgs = await restricted(
      "export const p = { dangerouslySetInnerHTML: { __html: 'x' } };\n",
      'src/modules/auth/fixture.test.tsx',
    );
    expect(msgs).toHaveLength(1);
  });
});

/** Фрагмент проверяется как тест: правило про фразы включено только для *.test.{ts,tsx}. */
const TEST_FILE = 'src/modules/auth/fixture.test.tsx';

describe('eslint.config.js — русские фразы в поиске по тексту', { timeout: 60000 }, () => {
  it('ловит подпись в screen.getByText', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByText('Личные данные');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(1);
  });

  it('ловит все формы запроса: find/query, All, within(...)', async () => {
    const msgs = await restricted(
      "export const a = () => screen.findAllByText('Телефон');\n" +
        "export const b = () => within(card).queryByText('Язык');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  it('ловит хелперы карточек и строк', async () => {
    const msgs = await restricted(
      "export const a = cardWith('Личные данные');\nexport const b = rowValue('Часовой пояс');\n",
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  it('ловит подпись, собранную шаблонной строкой — и в запросе, и в хелпере', async () => {
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
  it('ловит подпись, записанную регуляркой', async () => {
    const msgs = await restricted(
      'export const a = () => screen.getByText(/Личные данные/);\n' +
        'export const b = () => rowValue(/Часовой пояс/);\n',
      TEST_FILE,
    );
    expect(msgs).toHaveLength(2);
  });

  it('не трогает ключ через tr() — ради него всё и затевалось', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByText(tr('auth.profile.personalInfo'));\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  it('не трогает фикстуры и названия тестов — там русский по конвенции', async () => {
    const msgs = await restricted(
      "export const device = { device_name: 'Рабочий ноутбук' };\n" +
        "it('карточка кабинета подписана', () => {});\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  // Фикстуру ищут по её же значению, и поднятая в константу фраза правилу не видна — это не
  // дырка, а способ отличить данные от подписи интерфейса. Обратная сторона: спрятать так можно
  // и настоящую подпись, поэтому правило — подсказка, а не гарантия.
  it('не трогает фразу, поднятую в константу', async () => {
    const msgs = await restricted(
      "const DEVICE = 'Рабочий ноутбук';\nexport const found = () => screen.getByText(DEVICE);\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  it('не трогает ожидаемое значение — там литерал и есть эталон', async () => {
    const msgs = await restricted(
      "export const check = (el: HTMLElement) => expect(el.textContent).toBe('Русский');\n",
      TEST_FILE,
    );
    expect(msgs).toEqual([]);
  });

  it('не трогает обычный код вне тестов', async () => {
    const msgs = await restricted(
      "export const found = () => screen.getByText('Личные данные');\n",
      'src/modules/auth/fixture.tsx',
    );
    expect(msgs).toEqual([]);
  });
});
