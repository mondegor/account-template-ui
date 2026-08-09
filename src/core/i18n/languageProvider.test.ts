import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * languageProvider кэширует выбор в модульных переменных, поэтому для проверки чтения из
 * localStorage «как после reload» перезагружаем модуль (vi.resetModules) с чистым кэшем.
 */
describe('languageProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('setLanguage persists the choice, getLanguage returns it', async () => {
    const { setLanguage, getLanguage } = await import('./languageProvider');
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(localStorage.getItem('ui.lang')).toBe('en');
  });

  it('getLanguage reads the stored language from localStorage (after a reload)', async () => {
    localStorage.setItem('ui.lang', 'en');
    const { getLanguage } = await import('./languageProvider');
    expect(getLanguage()).toBe('en');
  });

  it('a broken or unsupported ui.lang is ignored: the browser language wins', async () => {
    localStorage.setItem('ui.lang', 'de');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    const { getLanguage } = await import('./languageProvider');
    expect(getLanguage()).toBe('ru-RU');
  });

  it('with no choice the source is auto: the language comes from the browser', async () => {
    const { getLanguageSource } = await import('./languageProvider');
    expect(getLanguageSource()).toBe('auto');
  });

  it('a choice in the shell gives the local source, the profile language gives profile', async () => {
    const { setLanguage, setProfileLanguage, getLanguageSource } =
      await import('./languageProvider');
    setLanguage('en');
    expect(getLanguageSource()).toBe('local');
    setProfileLanguage('ru');
    expect(getLanguageSource()).toBe('profile');
  });

  it('the source survives a reload together with the value', async () => {
    const first = await import('./languageProvider');
    first.setProfileLanguage('en');
    vi.resetModules();

    const second = await import('./languageProvider');
    expect(second.getLanguage()).toBe('en');
    expect(second.getLanguageSource()).toBe('profile');
  });

  it("a value without a source (a record from an older version) counts as the user's choice", async () => {
    localStorage.setItem('ui.lang', 'en');
    const { getLanguageSource } = await import('./languageProvider');
    expect(getLanguageSource()).toBe('local');
  });
});
