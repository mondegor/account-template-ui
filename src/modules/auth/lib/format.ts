import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  calendarDay,
  formatDate,
  formatDateTimeBare,
  formatDateTimeLong,
  formatDayMonth,
  formatTime,
  toLocale,
} from '@core/i18n';

/** Форматирование дат профиля/сессий. Локаль — активного языка (ru → ru-RU, en → en-US). */

/** Локаль дат активного языка; соответствие «язык → локаль» держит справочник (@core/i18n). */
export function useLocale(): string {
  const { i18n } = useTranslation();
  return toLocale(i18n.language);
}

/**
 * Дата словами + время («July 15, 2026 at 11:53 AM»); пустое → '' (прочерк ставит Row),
 * битое — как есть. `timeZone` — пояс профиля; без него дата рисуется в поясе браузера.
 */
export function fmtLong(dt: string | undefined, locale: string, timeZone?: string): string {
  if (!dt) return '';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : formatDateTimeLong(d, locale, timeZone);
}

/**
 * Срок после предлога («до {{date}}»): дата словами и время без связки между ними; пустое → '',
 * битое — как есть.
 */
export function fmtDeadline(dt: string | undefined, locale: string, timeZone?: string): string {
  if (!dt) return '';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : formatDateTimeBare(d, locale, timeZone);
}

/** Только дата; пустое → '' (прочерк ставит Row), битое — как есть. */
export function fmtDate(dt: string | undefined, locale: string, timeZone?: string): string {
  if (!dt) return '';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : formatDate(d, locale, timeZone);
}

/** Только время («11:53»); пустое → '', битое — как есть. */
export function fmtTime(dt: string | undefined, locale: string, timeZone?: string): string {
  if (!dt) return '';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : formatTime(d, locale, timeZone);
}

/** День ленты: ключ группы и подпись над ней. */
export interface DayGroup {
  key: string;
  label: string;
}

/** Календарный день, предшествующий `YYYY-MM-DD`, — арифметика по UTC, без перехода на летнее время. */
function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}

/**
 * День события в поясе профиля: «Сегодня», «Вчера», иначе «8 октября» (с годом — если не
 * текущий). Битое значение — отдельной группой с подписью как есть.
 */
export function dayGroup(
  dt: string,
  opts: { locale: string; timeZone?: string; now: number; today: string; yesterday: string },
): DayGroup {
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return { key: dt, label: dt };
  const key = calendarDay(d, opts.timeZone);
  const today = calendarDay(new Date(opts.now), opts.timeZone);
  if (key === today) return { key, label: opts.today };
  if (key === previousDay(today)) return { key, label: opts.yesterday };
  const withYear = key.slice(0, 4) !== today.slice(0, 4);
  return { key, label: formatDayMonth(d, opts.locale, opts.timeZone, withYear) };
}

/** Тик раз в `intervalMs` — чтобы относительное время («N назад») само пересчитывалось. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
