/**
 * Относительное «X назад» с апроксимацией до одной единицы (минута/час/день).
 * Склонения ru/en делает `Intl.RelativeTimeFormat`. Гибрид: свежее — относительно,
 * старше `absoluteAfterMs` — абсолютная дата-время (`toLocaleString`, как было раньше).
 * Локаль и подпись «только что» передаются аргументами — модуль не зависит от i18next.
 */
export interface RelativeTimeResult {
  /** Готовая подпись: «5 минут назад» / «только что» / абсолютная дата. */
  label: string;
  /** Полная дата-время в локали — для подсказки (title) при наведении. */
  title: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DEFAULT_ABSOLUTE_AFTER_MS = 30 * DAY;

export interface RelativeTimeOptions {
  locale: string;
  now: number;
  justNow: string;
  /** Порог перехода к абсолютной дате; по умолчанию 30 дней. */
  absoluteAfterMs?: number;
}

/** Пустое/битое значение → `null` (вызывающий делает свой fallback). */
export function formatRelativeTime(
  iso: string | undefined,
  opts: RelativeTimeOptions,
): RelativeTimeResult | null {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;

  const { locale, now, justNow, absoluteAfterMs = DEFAULT_ABSOLUTE_AFTER_MS } = opts;
  const title = d.toLocaleString(locale);
  const diff = now - ms;

  if (diff < MINUTE) return { label: justNow, title };
  if (diff >= absoluteAfterMs) return { label: title, title };

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (diff < HOUR) {
    value = Math.floor(diff / MINUTE);
    unit = 'minute';
  } else if (diff < DAY) {
    value = Math.floor(diff / HOUR);
    unit = 'hour';
  } else {
    value = Math.floor(diff / DAY);
    unit = 'day';
  }
  return { label: rtf.format(-value, unit), title };
}
