import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDateTimeLong, toLocale } from '@core/i18n';

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

/** Только дата; пустое → '' (прочерк ставит Row), битое — как есть. */
export function fmtDate(dt: string | undefined, locale: string, timeZone?: string): string {
  if (!dt) return '';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : formatDate(d, locale, timeZone);
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
