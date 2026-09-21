import { describe, expect, it } from 'vitest';
import type { PendingOperation, UserInfo } from '../api/types';
import { pendingEmailChange, pendingToWaiting } from './pendingOperation';

const NOW = Date.parse('2026-09-19T12:00:00Z');

const OPENED: PendingOperation = {
  token: 'a'.repeat(64),
  type: 'CHANGE_EMAIL_CONFIRM',
  extra_value: 'new@example.com',
  expires_at: '2026-09-19T13:00:00Z',
  status: 'OPENED',
  confirm_method: 'EMAIL',
  remaining_attempts: 2,
  remaining_resends: 1,
  resends_in: 15,
};

function user(pending?: PendingOperation[]): UserInfo {
  return {
    email: 'user@example.com',
    lang: 'en-US',
    tz: 'UTC',
    auth_2fa_type: 'NONE',
    realms: [],
    pending_operations: pending,
    status: 'ENABLED',
  };
}

describe('pendingEmailChange', () => {
  it('finds the confirmation of the new address among other operations', () => {
    const other: PendingOperation = { ...OPENED, token: 'b'.repeat(64), type: 'CHANGE_PHONE' };

    expect(pendingEmailChange(user([other, OPENED]))).toBe(OPENED);
  });

  /** Шаг 1 адресу ещё ничего не отправил: ждать там нечего, его закроет новая смена. */
  it('the first step of the change does not count', () => {
    expect(pendingEmailChange(user([{ ...OPENED, type: 'CHANGE_EMAIL' }]))).toBeUndefined();
  });

  it('a profile without the list has nothing pending', () => {
    expect(pendingEmailChange(user())).toBeUndefined();
  });
});

describe('pendingToWaiting', () => {
  it('an open operation becomes a snapshot: counters as is, the deadline as seconds left', () => {
    expect(pendingToWaiting(OPENED, NOW)).toEqual({
      token: OPENED.token,
      confirm_method: 'EMAIL',
      remaining_attempts: 2,
      remaining_resends: 1,
      resends_in: 15,
      expires_in: 3600,
    });
  });

  it('a deadline already behind is zero, not negative', () => {
    expect(
      pendingToWaiting({ ...OPENED, expires_at: '2026-09-19T11:00:00Z' }, NOW)?.expires_in,
    ).toBe(0);
  });

  it('a confirmed operation has nothing to confirm', () => {
    const confirmed: PendingOperation = {
      token: OPENED.token,
      type: 'CHANGE_EMAIL_CONFIRM',
      expires_at: OPENED.expires_at,
      status: 'CONFIRMED',
    };

    expect(pendingToWaiting(confirmed, NOW)).toBeNull();
  });
});
