import type { TFunction } from 'i18next';
import type { SecurityEventType, SecurityLogItem } from '../api/types';

/**
 * Тон события журнала. Несёт смысл для защиты аккаунта, а не тип события: `success` — защита
 * усилена, `warning` — ослаблена или потрачен резерв, `error` — признак чужого доступа;
 * остальное — `neutral`.
 */
export type SecurityEventTone = 'neutral' | 'success' | 'warning' | 'error';

const TONES: Record<SecurityEventType, SecurityEventTone> = {
  SIGNED_IN: 'neutral',
  AUTH_2FA_ENABLED: 'success',
  AUTH_2FA_DISABLED: 'warning',
  RECOVERY_CODE_USED: 'warning',
  RECOVERY_CODES_REGENERATED: 'neutral',
  EMAIL_CHANGE_REQUESTED: 'neutral',
  EMAIL_CHANGED: 'neutral',
  EMAIL_CHANGE_REVOKED: 'neutral',
  PHONE_CHANGED: 'neutral',
  SESSIONS_CLOSED: 'neutral',
  TOKEN_REUSE_DETECTED: 'error',
};

export function securityEventTone(type: SecurityEventType): SecurityEventTone {
  return TONES[type];
}

/** Заголовок события: «Вход в аккаунт», «Емаил изменён». */
export function securityEventTitle(t: TFunction, type: SecurityEventType): string {
  return t(`auth.securityLog.event.${type}`);
}

/**
 * Пара «прежнее → новое» для смены емаила и телефона. Деталь — строка: стрелку рисует сама
 * строка, а не разметка, чтобы деталь читалась одинаково на экране и скринридером.
 */
function change(item: SecurityLogItem): string | undefined {
  if (!item.new_value) return undefined;
  return item.old_value ? `${item.old_value} → ${item.new_value}` : item.new_value;
}

/**
 * Деталь события второй строкой — из дополнительных полей, которые есть только у своих типов.
 * У событий без подробностей — undefined, строка детали тогда не рисуется.
 */
export function securityEventDetail(t: TFunction, item: SecurityLogItem): string | undefined {
  const d = (key: string, opts?: Record<string, unknown>) =>
    t(`auth.securityLog.detail.${key}`, opts ?? {});
  switch (item.event_type) {
    case 'AUTH_2FA_ENABLED':
      return item.factor && d('factor', { factor: d(`factor${item.factor}`) });
    case 'RECOVERY_CODE_USED':
      return item.remaining === undefined ? undefined : d('remaining', { n: item.remaining });
    case 'RECOVERY_CODES_REGENERATED':
      return d('codesReplaced');
    case 'EMAIL_CHANGE_REQUESTED':
    case 'EMAIL_CHANGED':
      return change(item);
    case 'EMAIL_CHANGE_REVOKED':
      return item.new_value && d('revoked', { value: item.new_value });
    case 'PHONE_CHANGED':
      return item.old_value
        ? change(item)
        : item.new_value && d('phoneSet', { value: item.new_value });
    case 'SESSIONS_CLOSED':
      return d('sessionsClosed');
    case 'TOKEN_REUSE_DETECTED':
      return d('tokenReuse');
    case 'SIGNED_IN':
    case 'AUTH_2FA_DISABLED':
      return undefined;
  }
}

/**
 * Мета-строка «приложение · устройство · IP · место». Пустые части пропускаются, а не
 * становятся прочерком: `app_name`/`device_name` бывают пустой строкой, `location` — отсутствует.
 * IP есть всегда, поэтому строка не пустеет.
 */
export function securityEventMeta(item: SecurityLogItem): string {
  return [item.app_name, item.device_name, item.ip, item.location].filter(Boolean).join(' · ');
}
