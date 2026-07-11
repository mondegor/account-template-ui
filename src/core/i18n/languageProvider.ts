/**
 * Источник текущего языка для заголовка Accept-Language и стартовой инициализации i18next.
 * Приоритет: явный выбор юзера (persist в localStorage) → язык браузера → 'ru'.
 * Смену языка в UI делает LanguageButton (setLanguage + i18next.changeLanguage); здесь —
 * хранилище выбора, i18next не импортируем (нет цикла), Accept-Language берёт getLanguage().
 */

const STORAGE_KEY = 'ui.lang';
export const SUPPORTED_LANGS = ['ru', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

let explicitLang: string | null = null;

/** Поддерживаемый ли язык (точное совпадение с SUPPORTED_LANGS). */
function isSupported(lang: string): lang is Lang {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
}

export function setLanguage(lang: string): void {
  explicitLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // приватный режим / недоступный storage — язык останется в памяти на текущую сессию.
  }
}

export function getLanguage(): string {
  if (explicitLang) return explicitLang;
  try {
    // Битый/чужой ui.lang (не из SUPPORTED_LANGS) игнорируем — иначе он уедет в Accept-Language
    // и в i18next.init({lng}). Падаем на язык браузера.
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isSupported(stored)) {
      explicitLang = stored;
      return stored;
    }
  } catch {
    // недоступный storage — падаем на язык браузера.
  }
  return navigator.language ?? 'ru';
}
