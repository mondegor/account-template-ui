import { memoByKey } from './intlCache';

/**
 * Полная дата-время «словами» — для строк и подсказок (title): «July 15, 2026 at 11:53 AM» /
 * «15 июля 2026 в 11:53». В русском Intl добавляет «г.» после года — убираем: короче и чище.
 * Регэксп с `\s`, а не литерал с пробелом: ICU мигрирует обычные пробелы на NBSP/NNBSP (в en-US
 * перед AM/PM уже U+202F), и литерал ' г.' однажды молча перестал бы совпадать; `\s` в JS
 * покрывает и U+00A0, и U+202F.
 *
 * `timeZone` — пояс ОТОБРАЖЕНИЯ (пояс профиля пользователя). Сервер присылает момент времени
 * со смещением, `new Date()` съедает его при разборе, поэтому в каком поясе показать этот момент,
 * решает исключительно клиент. Без опции Intl рисует его в поясе браузера — то есть игнорирует
 * настройку профиля. Пусто/undefined → пояс браузера (осознанный фолбэк: зона профиля неизвестна
 * или ICU её не знает).
 *
 * Форматтер кэшируется составным ключом `локаль|пояс` (memoByKey): toLocaleString с опциями
 * строит Intl.DateTimeFormat на каждый вызов, а зовут его все даты списка на каждый минутный тик.
 * Ключ собирается здесь же и здесь же разбирается: memoByKey отдаёт его в фабрику как есть.
 */
function cacheKey(locale: string, timeZone?: string): string {
  return `${locale}|${timeZone ?? ''}`;
}

const formatter = memoByKey((key) => {
  const [locale, timeZone] = key.split('|');
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timeZone || undefined,
  });
});

export function formatDateTimeLong(d: Date, locale: string, timeZone?: string): string {
  return formatter(cacheKey(locale, timeZone)).format(d).replace(/\sг\./g, '');
}

/** Только дата в коротком виде («15.07.2026» / «7/15/2026») — то же, что toLocaleDateString,
 *  но с кэшем форматтера: даты регистрации рендерятся на каждый минутный тик useNow. */
const dateFormatter = memoByKey((key) => {
  const [locale, timeZone] = key.split('|');
  return new Intl.DateTimeFormat(locale, { timeZone: timeZone || undefined });
});

export function formatDate(d: Date, locale: string, timeZone?: string): string {
  return dateFormatter(cacheKey(locale, timeZone)).format(d);
}
