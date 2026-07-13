import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isEnglish } from '@core/i18n';

/** Форматирование дат профиля/сессий. Локаль — активного языка (en → en-US, иначе ru-RU). */

/** Локаль дат активного языка (en-US/ru-RU); «англ. ли это» решает общий isEnglish. */
export function useLocale(): string {
  const { i18n } = useTranslation();
  return isEnglish(i18n.language) ? 'en-US' : 'ru-RU';
}

/** Дата и время; пустое/битое значение — как есть. */
export function fmt(dt: string | undefined, locale: string): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : d.toLocaleString(locale);
}

/** Только дата; пустое/битое значение — как есть. */
export function fmtDate(dt: string | undefined, locale: string): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : d.toLocaleDateString(locale);
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
