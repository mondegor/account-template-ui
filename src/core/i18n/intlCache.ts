/**
 * Кэш «по ключу» для Intl-объектов: конструкторы Intl дорогие (грузят данные локали), а зовутся
 * форматтеры каждой строкой с датой на каждый минутный тик useNow. Ключ выбирает вызывающий —
 * локаль, пара `локаль|пояс` или имя зоны, — и все они берутся из конечных справочников
 * (два языка, 139 зон), поэтому кэш ограничен и вытеснение ему не нужно.
 * Хелпер внутренний для core/i18n, наружу не экспортируется.
 */
export function memoByKey<T>(create: (key: string) => T): (key: string) => T {
  const cache = new Map<string, T>();
  return (key) => {
    let value = cache.get(key);
    if (value === undefined) {
      value = create(key);
      cache.set(key, value);
    }
    return value;
  };
}
