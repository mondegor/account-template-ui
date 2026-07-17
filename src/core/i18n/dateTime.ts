import { memoByLocale } from './intlCache';

/**
 * Полная дата-время «словами» — для строк и подсказок (title): «July 15, 2026 at 11:53 AM» /
 * «15 июля 2026 в 11:53». В русском Intl добавляет «г.» после года — убираем: короче и чище.
 * Регэксп с `\s`, а не литерал с пробелом: ICU мигрирует обычные пробелы на NBSP/NNBSP (в en-US
 * перед AM/PM уже U+202F), и литерал ' г.' однажды молча перестал бы совпадать; `\s` в JS
 * покрывает и U+00A0, и U+202F.
 *
 * Форматтер кэшируется по локали (memoByLocale): toLocaleString с опциями строит
 * Intl.DateTimeFormat на каждый вызов.
 */
const formatter = memoByLocale(
  (locale) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }),
);

export function formatDateTimeLong(d: Date, locale: string): string {
  return formatter(locale).format(d).replace(/\sг\./g, '');
}

/** Только дата в коротком виде («15.07.2026» / «7/15/2026») — то же, что toLocaleDateString,
 *  но с кэшем форматтера: даты регистрации рендерятся на каждый минутный тик useNow. */
const dateFormatter = memoByLocale((locale) => new Intl.DateTimeFormat(locale));

export function formatDate(d: Date, locale: string): string {
  return dateFormatter(locale).format(d);
}
