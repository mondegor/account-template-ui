import { beforeAll, describe, expect, it } from 'vitest';
import { LANGUAGES, addTranslations, i18next, initI18n } from '@core/i18n';
import { tr } from '../../../test/i18n';
import { authTranslations } from '../i18n';
import {
  securityEventDetail,
  securityEventMeta,
  securityEventTitle,
  securityEventTone,
} from './securityEvent';
import type { SecurityEventType, SecurityLogItem } from '../api/types';

const ALL_TYPES: SecurityEventType[] = [
  'SIGNED_IN',
  'AUTH_2FA_ENABLED',
  'AUTH_2FA_DISABLED',
  'RECOVERY_CODE_USED',
  'RECOVERY_CODES_REGENERATED',
  'EMAIL_CHANGE_REQUESTED',
  'EMAIL_CHANGED',
  'EMAIL_CHANGE_REVOKED',
  'PHONE_CHANGED',
  'SESSIONS_CLOSED',
  'TOKEN_REUSE_DETECTED',
];

function event(fields: Partial<SecurityLogItem> & Pick<SecurityLogItem, 'event_type'>) {
  return {
    id: '1',
    ip: '95.165.1.1',
    app_name: 'Web, Firefox',
    device_name: 'Work laptop',
    created_at: '2026-10-10T14:32:00+03:00',
    ...fields,
  } satisfies SecurityLogItem;
}

beforeAll(async () => {
  initI18n();
  addTranslations(authTranslations);
  await i18next.changeLanguage('en');
});

describe('security event', () => {
  it.each(ALL_TYPES)('%s has a title in every language', (type) => {
    const key = `auth.securityLog.event.${type}`;
    for (const { code } of LANGUAGES) {
      expect(i18next.getFixedT(code)(key), code).not.toBe(key);
    }
    expect(securityEventTitle(i18next.t, type)).toBe(tr(key));
  });

  /** Цветом выделено только то, что меняет защиту аккаунта; тревожный — один тип. */
  it.each([
    ['AUTH_2FA_ENABLED', 'success'],
    ['AUTH_2FA_DISABLED', 'warning'],
    ['RECOVERY_CODE_USED', 'warning'],
    ['TOKEN_REUSE_DETECTED', 'error'],
    ['SIGNED_IN', 'neutral'],
    ['EMAIL_CHANGED', 'neutral'],
  ] as const)('%s is toned %s', (type, tone) => {
    expect(securityEventTone(type)).toBe(tone);
  });

  describe('detail', () => {
    const detail = (fields: Parameters<typeof event>[0]) =>
      securityEventDetail(i18next.t, event(fields));

    it('2FA enabled names the factor', () => {
      expect(detail({ event_type: 'AUTH_2FA_ENABLED', factor: 'TOTP' })).toBe(
        tr('auth.securityLog.detail.factor', {
          factor: tr('auth.securityLog.detail.factorTOTP'),
        }),
      );
      expect(detail({ event_type: 'AUTH_2FA_ENABLED', factor: 'PASSWORD' })).toBe(
        tr('auth.securityLog.detail.factor', {
          factor: tr('auth.securityLog.detail.factorPASSWORD'),
        }),
      );
    });

    it('a spent recovery code tells how many are left, zero included', () => {
      expect(detail({ event_type: 'RECOVERY_CODE_USED', remaining: 7 })).toBe(
        tr('auth.securityLog.detail.remaining', { n: 7 }),
      );
      expect(detail({ event_type: 'RECOVERY_CODE_USED', remaining: 0 })).toBe(
        tr('auth.securityLog.detail.remaining', { n: 0 }),
      );
    });

    it.each(['EMAIL_CHANGE_REQUESTED', 'EMAIL_CHANGED'] as const)(
      '%s shows the old and the new address',
      (type) => {
        expect(
          detail({ event_type: type, old_value: 'old@example.com', new_value: 'new@example.com' }),
        ).toBe('old@example.com → new@example.com');
      },
    );

    it('a revoked email change shows the cancelled address only', () => {
      expect(detail({ event_type: 'EMAIL_CHANGE_REVOKED', new_value: 'new@example.com' })).toBe(
        tr('auth.securityLog.detail.revoked', { value: 'new@example.com' }),
      );
    });

    it('a phone change with a previous number shows both', () => {
      expect(
        detail({
          event_type: 'PHONE_CHANGED',
          old_value: '+7 912 345 67 89',
          new_value: '+7 999 888 77 66',
        }),
      ).toBe('+7 912 345 67 89 → +7 999 888 77 66');
    });

    it('a phone change without a previous number says the number was set', () => {
      expect(detail({ event_type: 'PHONE_CHANGED', new_value: '+7 999 888 77 66' })).toBe(
        tr('auth.securityLog.detail.phoneSet', { value: '+7 999 888 77 66' }),
      );
    });

    it.each([
      ['RECOVERY_CODES_REGENERATED', 'codesReplaced'],
      ['SESSIONS_CLOSED', 'sessionsClosed'],
      ['TOKEN_REUSE_DETECTED', 'tokenReuse'],
    ] as const)('%s has a fixed detail', (type, key) => {
      expect(detail({ event_type: type })).toBe(tr(`auth.securityLog.detail.${key}`));
    });

    it.each(['SIGNED_IN', 'AUTH_2FA_DISABLED'] as const)('%s has no detail line', (type) => {
      expect(detail({ event_type: type })).toBeUndefined();
    });
  });

  describe('meta', () => {
    it('joins app, device, IP and location', () => {
      expect(
        securityEventMeta(event({ event_type: 'SIGNED_IN', location: 'Moscow, Russia' })),
      ).toBe('Web, Firefox · Work laptop · 95.165.1.1 · Moscow, Russia');
    });

    it('skips what the server could not determine instead of showing a dash', () => {
      expect(
        securityEventMeta(event({ event_type: 'SIGNED_IN', app_name: '', device_name: '' })),
      ).toBe('95.165.1.1');
    });
  });
});
