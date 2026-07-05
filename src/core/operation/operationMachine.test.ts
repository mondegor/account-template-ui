import { describe, expect, it } from 'vitest';
import {
  canResendNow,
  expiresSecondsLeft,
  isResendApplicable,
  operationReducer,
  resendSecondsLeft,
  type OperationSnapshot,
  type WaitingParts,
} from './operationMachine';

const T0 = 1_000_000_000_000;

const waiting: WaitingParts = {
  token: 'a'.repeat(64),
  confirm_method: 'EMAIL',
  remaining_attempts: 3,
  remaining_resends: 2,
  resends_in: 30,
  expires_in: 600,
  message: 'code sent',
};

function start(): OperationSnapshot {
  return operationReducer(null, { type: 'START', parts: waiting, now: T0 })!;
}

describe('operationReducer', () => {
  it('START строит активный снимок с абсолютными таймерами', () => {
    const s = start();
    expect(s.phase).toBe('active');
    expect(s.expiresAt).toBe(T0 + 600_000);
    expect(s.resendAllowedAt).toBe(T0 + 30_000);
    expect(expiresSecondsLeft(s, T0)).toBe(600);
    expect(resendSecondsLeft(s, T0)).toBe(30);
  });

  it('CONFIRM_FAILED уменьшает попытки и обновляет таймеры из operation_state', () => {
    const s = operationReducer(start(), {
      type: 'CONFIRM_FAILED',
      state: { remaining_attempts: 1, remaining_resends: 2, resends_in: 0, expires_in: 500 },
      now: T0 + 10_000,
    })!;
    expect(s.remainingAttempts).toBe(1);
    expect(s.phase).toBe('active');
    expect(s.expiresAt).toBe(T0 + 10_000 + 500_000);
  });

  it('исчерпание попыток → phase exhausted', () => {
    const s = operationReducer(start(), {
      type: 'CONFIRM_FAILED',
      state: { remaining_attempts: 0, expires_in: 500 },
      now: T0,
    })!;
    expect(s.phase).toBe('exhausted');
  });

  it('TICK после expiresAt → phase expired', () => {
    const s = operationReducer(start(), { type: 'TICK', now: T0 + 600_001 })!;
    expect(s.phase).toBe('expired');
  });

  it('RESENT сбрасывает счётчики/таймеры', () => {
    const failed = operationReducer(start(), {
      type: 'CONFIRM_FAILED',
      state: { remaining_attempts: 1, expires_in: 100 },
      now: T0,
    });
    const s = operationReducer(failed, {
      type: 'RESENT',
      parts: { ...waiting, remaining_resends: 1 },
      now: T0 + 40_000,
    })!;
    expect(s.remainingAttempts).toBe(3);
    expect(s.remainingResends).toBe(1);
    expect(s.expiresAt).toBe(T0 + 40_000 + 600_000);
  });

  it('REVOKED очищает состояние', () => {
    expect(operationReducer(start(), { type: 'REVOKED' })).toBeNull();
  });
});

describe('селекторы резенда', () => {
  it('remaining_resends === undefined ≠ 0: резенд неприменим (шаг PASSWORD/TOTP)', () => {
    const s = operationReducer(null, {
      type: 'START',
      parts: { ...waiting, remaining_resends: undefined, resends_in: undefined },
      now: T0,
    })!;
    expect(isResendApplicable(s)).toBe(false);
    expect(canResendNow(s, T0)).toBe(false);
  });

  it('резенд доступен только после кулдауна и при остатке > 0', () => {
    const s = start();
    expect(canResendNow(s, T0)).toBe(false); // кулдаун ещё идёт
    expect(canResendNow(s, T0 + 30_000)).toBe(true); // кулдаун истёк
  });
});
