import dictionary from './data/languages.json';

/**
 * Справочник языков фронта: копия серверного списка. Совпадение обязательно: явно указанный `lang`
 * бэк проверяет строго по своему списку — чужой код вернулся бы 400 на сохранении настроек.
 * В query-параметре неизвестный код не ошибка: он пропускается, и язык берётся из следующего
 * по приоритету источника.
 * Данные лежат в data/languages.json, наружу (через барредь @core/i18n) уходят только эти
 * функции — сырой json не экспортируется, чтобы формат файла можно было менять в одном месте.
 *
 * Типы из json приходят как string (resolveJsonModule не даёт литеральных union-ов), поэтому
 * сужение делает findLanguage в рантайме, а не компилятор.
 */

export interface Language {
  /** Язык i18next и ключ бандлов переводов: `ru`, `en`. */
  code: string;
  /** Локаль для API (`?lang`, тело настроек) и для Intl: `ru-RU`, `en-US`. */
  locale: string;
  /** Подпись на самом языке — для переключателя и селекта. */
  name: string;
}

export const LANGUAGES: readonly Language[] = dictionary.languages;

/** Язык по умолчанию. Что `default` есть в списке — закреплено тестом languages.test.ts. */
export const DEFAULT_LANGUAGE: Language =
  LANGUAGES.find((l) => l.code === dictionary.default) ?? LANGUAGES[0]!;

/** Языковая часть тега: `ru-RU` / `ru_RU` / `RU-ru` → `ru`. */
function primaryTag(value: string): string {
  return value.split(/[-_]/)[0]!.toLowerCase();
}

/**
 * Язык справочника по любому тегу: коду (`ru`), локали (`ru-RU`) или диалекту (`ru-BY`).
 * Незнакомый язык (`de-DE`) → undefined: врать про него нельзя — вызывающий сам решает,
 * показать значение как есть или промолчать.
 */
export function findLanguage(value: string | undefined): Language | undefined {
  if (!value) return undefined;
  const tag = primaryTag(value);
  return LANGUAGES.find((l) => l.code === tag);
}

/**
 * Локаль для API и для Intl (`ru` → `ru-RU`). Незнакомый язык → локаль по умолчанию: и в query,
 * и в форматтере дат нужно конкретное значение, а не пустота.
 */
export function toLocale(value: string | undefined): string {
  return (findLanguage(value) ?? DEFAULT_LANGUAGE).locale;
}

/** Локаль бэка → код языка приложения; незнакомая (`de-DE`) → undefined. */
export function fromApiLocale(locale: string | undefined): string | undefined {
  return findLanguage(locale)?.code;
}
