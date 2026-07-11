import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * languageProvider кэширует выбор в модульной переменной, поэтому для проверки чтения из
 * localStorage «как после reload» перезагружаем модуль (vi.resetModules) с чистым кэшем.
 */
describe('languageProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('setLanguage персистит выбор, getLanguage его возвращает', async () => {
    const { setLanguage, getLanguage } = await import('./languageProvider');
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(localStorage.getItem('ui.lang')).toBe('en');
  });

  it('getLanguage читает сохранённый язык из localStorage (после reload)', async () => {
    localStorage.setItem('ui.lang', 'en');
    const { getLanguage } = await import('./languageProvider');
    expect(getLanguage()).toBe('en');
  });

  it('битый/неподдерживаемый ui.lang игнорируется → язык браузера', async () => {
    localStorage.setItem('ui.lang', 'de');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    const { getLanguage } = await import('./languageProvider');
    expect(getLanguage()).toBe('ru-RU');
  });
});
