/**
 * Кэш «по локали» для Intl-объектов: конструкторы Intl дорогие (грузят данные локали), а зовутся
 * форматтеры каждой строкой с датой на каждый минутный тик useNow. Локалей в приложении две
 * (ru-RU/en-US) — кэш не растёт. Хелпер внутренний для core/i18n, наружу не экспортируется.
 */
export function memoByLocale<T>(create: (locale: string) => T): (locale: string) => T {
  const cache = new Map<string, T>();
  return (locale) => {
    let value = cache.get(locale);
    if (value === undefined) {
      value = create(locale);
      cache.set(locale, value);
    }
    return value;
  };
}
