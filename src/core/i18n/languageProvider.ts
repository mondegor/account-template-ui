/**
 * Источник текущего языка для заголовка Accept-Language (и позже — i18next).
 * Сейчас: явный выбор юзера (если появится) → язык браузера → 'ru'.
 * Полноценный i18next — отдельный шаг плана (Этап 2, шаг 9).
 */

let explicitLang: string | null = null;

export function setLanguage(lang: string): void {
  explicitLang = lang;
}

export function getLanguage(): string {
  return explicitLang ?? navigator.language ?? 'ru';
}
