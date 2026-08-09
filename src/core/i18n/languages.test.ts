import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, LANGUAGES, findLanguage, fromApiLocale, toLocale } from './languages';

/**
 * Справочники — данные, а не код: компилятор их не проверяет (json приходит как string),
 * поэтому инварианты файлов закреплены здесь.
 */

describe('language registry', () => {
  it('the default is in the list: DEFAULT_LANGUAGE leans on it', () => {
    expect(LANGUAGES.some((l) => l.code === DEFAULT_LANGUAGE.code)).toBe(true);
  });

  it('codes are unique, locales are filled in', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const lang of LANGUAGES) {
      // maxLength 5 у lang в openapi — локаль обязана в него влезать.
      expect(lang.locale.length).toBeLessThanOrEqual(5);
      expect(lang.name).not.toBe('');
    }
  });

  it('findLanguage understands a code, a locale and a dialect; an unknown language it does not', () => {
    expect(findLanguage('ru')?.code).toBe('ru');
    expect(findLanguage('ru-RU')?.code).toBe('ru');
    expect(findLanguage('ru-BY')?.code).toBe('ru');
    expect(findLanguage('EN_us')?.code).toBe('en');
    expect(findLanguage('de-DE')).toBeUndefined();
    expect(findLanguage(undefined)).toBeUndefined();
  });

  it('toLocale returns a locale; an unknown language falls back to the default one', () => {
    expect(toLocale('en')).toBe('en-US');
    expect(toLocale('ru')).toBe('ru-RU');
    expect(toLocale('de-DE')).toBe(DEFAULT_LANGUAGE.locale);
    expect(toLocale(undefined)).toBe(DEFAULT_LANGUAGE.locale);
  });

  it('fromApiLocale maps a server locale to a code, an unknown one to undefined', () => {
    expect(fromApiLocale('ru-RU')).toBe('ru');
    expect(fromApiLocale('en-US')).toBe('en');
    expect(fromApiLocale('de-DE')).toBeUndefined();
  });
});
