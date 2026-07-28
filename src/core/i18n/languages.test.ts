import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, LANGUAGES, findLanguage, fromApiLocale, toLocale } from './languages';

/**
 * Справочники — данные, а не код: компилятор их не проверяет (json приходит как string),
 * поэтому инварианты файлов закреплены здесь.
 */

describe('справочник языков', () => {
  it('default есть в списке — на него опирается DEFAULT_LANGUAGE', () => {
    expect(LANGUAGES.some((l) => l.code === DEFAULT_LANGUAGE.code)).toBe(true);
  });

  it('коды уникальны, локали заполнены', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const lang of LANGUAGES) {
      // maxLength 5 у lang в openapi — локаль обязана в него влезать.
      expect(lang.locale.length).toBeLessThanOrEqual(5);
      expect(lang.name).not.toBe('');
    }
  });

  it('findLanguage понимает код, локаль и диалект; чужой язык — не знает', () => {
    expect(findLanguage('ru')?.code).toBe('ru');
    expect(findLanguage('ru-RU')?.code).toBe('ru');
    expect(findLanguage('ru-BY')?.code).toBe('ru');
    expect(findLanguage('EN_us')?.code).toBe('en');
    expect(findLanguage('de-DE')).toBeUndefined();
    expect(findLanguage(undefined)).toBeUndefined();
  });

  it('toLocale даёт локаль, незнакомый язык — локаль по умолчанию', () => {
    expect(toLocale('en')).toBe('en-US');
    expect(toLocale('ru')).toBe('ru-RU');
    expect(toLocale('de-DE')).toBe(DEFAULT_LANGUAGE.locale);
    expect(toLocale(undefined)).toBe(DEFAULT_LANGUAGE.locale);
  });

  it('fromApiLocale сводит локаль бэка к коду, незнакомую — к undefined', () => {
    expect(fromApiLocale('ru-RU')).toBe('ru');
    expect(fromApiLocale('en-US')).toBe('en');
    expect(fromApiLocale('de-DE')).toBeUndefined();
  });
});
