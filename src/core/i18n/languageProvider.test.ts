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

  it('без выбора источник auto — язык берётся из браузера', async () => {
    const { getLanguageSource } = await import('./languageProvider');
    expect(getLanguageSource()).toBe('auto');
  });

  it('выбор в шелле даёт источник local, язык профиля — profile', async () => {
    const { setLanguage, setProfileLanguage, getLanguageSource } =
      await import('./languageProvider');
    setLanguage('en');
    expect(getLanguageSource()).toBe('local');
    setProfileLanguage('ru');
    expect(getLanguageSource()).toBe('profile');
  });

  it('источник переживает reload вместе со значением', async () => {
    const first = await import('./languageProvider');
    first.setProfileLanguage('en');
    vi.resetModules();

    const second = await import('./languageProvider');
    expect(second.getLanguage()).toBe('en');
    expect(second.getLanguageSource()).toBe('profile');
  });

  it('значение без источника (запись старой версии) считается выбором пользователя', async () => {
    localStorage.setItem('ui.lang', 'en');
    const { getLanguageSource } = await import('./languageProvider');
    expect(getLanguageSource()).toBe('local');
  });
});
