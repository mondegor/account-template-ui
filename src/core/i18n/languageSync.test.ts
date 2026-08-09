import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * adoptProfileLanguage — единственное место, где серверная локаль превращается в язык интерфейса.
 * Модуль перезагружаем на каждый кейс: и провайдер, и i18next держат состояние в модульных
 * переменных.
 */
async function load() {
  const { initI18n, i18next } = await import('./i18n');
  initI18n();
  const { adoptProfileLanguage } = await import('./languageSync');
  const provider = await import('./languageProvider');
  return { adoptProfileLanguage, i18next, ...provider };
}

describe('adoptProfileLanguage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('stores the language code (ru) in ui.lang, not the server locale (ru-RU)', async () => {
    const { adoptProfileLanguage, getLanguage, i18next } = await load();
    adoptProfileLanguage('ru-RU');

    // 'ru-RU' в хранилище выпал бы по проверке справочника на следующей загрузке, а в i18next
    // разъехался бы с Accept-Language.
    expect(localStorage.getItem('ui.lang')).toBe('ru');
    expect(getLanguage()).toBe('ru');
    expect(i18next.language).toBe('ru');
  });

  it('the value survives a module reload (persisted, not just in memory)', async () => {
    const { adoptProfileLanguage } = await load();
    adoptProfileLanguage('en-US');
    vi.resetModules();

    const { getLanguage, getLanguageSource } = await import('./languageProvider');
    expect(getLanguage()).toBe('en');
    expect(getLanguageSource()).toBe('profile');
  });

  it('a no-op when the shell holds a local choice: the local choice wins', async () => {
    const { adoptProfileLanguage, setLanguage, getLanguage, getLanguageSource, i18next } =
      await load();
    setLanguage('en');
    await i18next.changeLanguage('en');

    adoptProfileLanguage('ru-RU');

    expect(getLanguage()).toBe('en');
    expect(getLanguageSource()).toBe('local');
    expect(i18next.language).toBe('en');
  });

  it('an unknown server locale is a no-op: the interface is left alone', async () => {
    const { adoptProfileLanguage, getLanguageSource, i18next } = await load();
    const before = i18next.language;

    adoptProfileLanguage('de-DE');
    adoptProfileLanguage(undefined);

    expect(getLanguageSource()).toBe('auto');
    expect(i18next.language).toBe(before);
  });
});
