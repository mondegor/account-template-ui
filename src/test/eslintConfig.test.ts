// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Спека security-правила eslint.config.js: запрет dangerouslySetInnerHTML (на нём держится
 * interpolation.escapeValue: false в i18n). Конфиг загружается настоящий, фрагменты гоняются
 * через ESLint API — спека падает и на сломанном селекторе (fatal при разборе конфига), и на
 * дырке в охвате, и на ложном срабатывании. Правка правила без правки спеки невозможна.
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

describe('eslint.config.js — запрет dangerouslySetInnerHTML', () => {
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
});
