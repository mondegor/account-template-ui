import type { ReactNode } from 'react';
import { formatRelativeTime } from '@core/i18n';
import { Row } from './Row';

/** Строка с относительным временем («26 минут назад») и точным в title. rel === null ровно при
 *  пустом/битом значении: пустое — прочерк (его ставит Row), битое — как есть (конвенция
 *  format.ts). Общая для карточек профиля (последний вход) и сессий (активность). */
export function TimeRow({
  label,
  value,
  locale,
  now,
  justNow,
  icon,
}: {
  label: string;
  value: string | undefined;
  locale: string;
  now: number;
  justNow: string;
  icon?: ReactNode;
}) {
  const rel = formatRelativeTime(value, { locale, now, justNow });
  return rel ? (
    <Row label={label} value={rel.label} title={rel.title} icon={icon} />
  ) : (
    <Row label={label} value={value} icon={icon} />
  );
}
