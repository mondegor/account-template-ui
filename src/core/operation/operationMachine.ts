/**
 * Движок операций подтверждения (generic, core). Чистый reducer поверх снимка состояния
 * операции. Домен-специфику (confirm_method, терминальное действие) держат вызыватели —
 * поэтому confirmMethod типизирован как string.
 *
 * Таймеры хранятся АБСОЛЮТНО (epoch ms), чтобы переживать reload и не зависеть от поллинга.
 * Счётчики/таймеры сбрасываются из значений каждого ответа сервера (backend_answers §6).
 */

export type OperationPhase = 'idle' | 'active' | 'exhausted' | 'expired' | 'done';

export interface OperationSnapshot {
  token: string;
  confirmMethod: string;
  remainingAttempts: number;
  /** undefined = резенд неприменим (шаг PASSWORD/TOTP); 0 = резенды исчерпаны. */
  remainingResends?: number;
  expiresAt: number;
  resendAllowedAt: number;
  message?: string;
  phase: OperationPhase;
}

/** Части из WaitingConfirmOperation (инициатор / resend / следующее звено). */
export interface WaitingParts {
  token: string;
  confirm_method: string;
  remaining_attempts: number;
  remaining_resends?: number;
  resends_in?: number;
  expires_in: number;
  message?: string;
}

/** Части из operation_state в теле 400 (неверный код / резенд ограничен). */
export interface OperationStateParts {
  remaining_attempts: number;
  remaining_resends?: number;
  resends_in?: number;
  expires_in: number;
}

export type OperationAction =
  | { type: 'START'; parts: WaitingParts; now: number }
  | { type: 'RESENT'; parts: WaitingParts; now: number }
  | { type: 'CONFIRM_FAILED'; state: OperationStateParts; now: number }
  | { type: 'DONE' }
  | { type: 'REVOKED' }
  | { type: 'TICK'; now: number };

function fromWaiting(parts: WaitingParts, now: number): OperationSnapshot {
  return {
    token: parts.token,
    confirmMethod: parts.confirm_method,
    remainingAttempts: parts.remaining_attempts,
    remainingResends: parts.remaining_resends,
    expiresAt: now + parts.expires_in * 1000,
    resendAllowedAt: now + (parts.resends_in ?? 0) * 1000,
    message: parts.message,
    phase: parts.remaining_attempts <= 0 ? 'exhausted' : 'active',
  };
}

export function operationReducer(
  state: OperationSnapshot | null,
  action: OperationAction,
): OperationSnapshot | null {
  switch (action.type) {
    case 'START':
    case 'RESENT':
      return fromWaiting(action.parts, action.now);

    case 'CONFIRM_FAILED': {
      if (!state) return state;
      const s = action.state;
      return {
        ...state,
        remainingAttempts: s.remaining_attempts,
        remainingResends: s.remaining_resends ?? state.remainingResends,
        expiresAt: action.now + s.expires_in * 1000,
        resendAllowedAt:
          s.resends_in !== undefined ? action.now + s.resends_in * 1000 : state.resendAllowedAt,
        phase: s.remaining_attempts <= 0 ? 'exhausted' : 'active',
      };
    }

    case 'TICK': {
      if (!state || state.phase !== 'active') return state;
      return action.now >= state.expiresAt ? { ...state, phase: 'expired' } : state;
    }

    case 'DONE':
      return state ? { ...state, phase: 'done' } : state;

    case 'REVOKED':
      return null;

    default:
      return state;
  }
}

// ---- селекторы (чистые) ----

export function expiresSecondsLeft(s: OperationSnapshot, now: number): number {
  return Math.max(0, Math.ceil((s.expiresAt - now) / 1000));
}

export function resendSecondsLeft(s: OperationSnapshot, now: number): number {
  return Math.max(0, Math.ceil((s.resendAllowedAt - now) / 1000));
}

/** Резенд применим только если счётчик присутствует (EMAIL/PHONE) и > 0. */
export function isResendApplicable(s: OperationSnapshot): boolean {
  return s.remainingResends !== undefined;
}

export function canResendNow(s: OperationSnapshot, now: number): boolean {
  return (
    s.phase === 'active' &&
    isResendApplicable(s) &&
    (s.remainingResends ?? 0) > 0 &&
    now >= s.resendAllowedAt
  );
}
