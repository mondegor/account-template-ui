/**
 * Движок операций подтверждения (generic, core). Чистый reducer поверх снимка состояния
 * операции. Домен-специфику (confirm_method, терминальное действие) держат вызыватели —
 * поэтому confirmMethod типизирован как string.
 *
 * Таймеры хранятся АБСОЛЮТНО (epoch ms), чтобы переживать reload и не зависеть от поллинга.
 * Счётчики/таймеры сбрасываются из значений каждого ответа сервера.
 */

/**
 * Две фазы требуют пояснения, потому что различают близкие на вид ситуации:
 *
 * `confirmed` — все звенья подтверждения пройдены, осталось терминальное действие вызывателя
 * (у auth это открытие сессии). Отдельная фаза нужна потому, что терминальное действие может
 * отказать по причине, которая операцию не расходует: подтверждать больше нечего, повторять надо
 * само действие, а `active` увёл бы пользователя на повторный ввод кода — и тот получил бы отказ
 * «операция уже подтверждена».
 *
 * `dead` — операцию нельзя завершить ничем: ни вводом кода, ни новым кодом, ни ожиданием.
 * Единственный выход — начать процедуру заново. Сюда ведут два пути: сервер снял условие, при
 * котором операция создавалась (409), и истечение УЖЕ подтверждённой операции — подтверждать в
 * ней нечего, а повторная отправка кода по подтверждённой операции сервером отклоняется. Отдельно
 * от `expired`, где новый код запросить как раз можно. `TICK` фазу `dead` уже не трогает.
 */
export type OperationPhase =
  'idle' | 'active' | 'confirmed' | 'exhausted' | 'expired' | 'dead' | 'done';

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
  | { type: 'CONFIRMED' }
  | { type: 'INVALIDATED' }
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
      // Мёртвую операцию не воскрешает ничто, в том числе счётчики из тела очередного отказа:
      // фазу выставил сервер, и он же сказал, что завершить операцию нельзя.
      if (!state || state.phase === 'dead') return state;
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

    case 'CONFIRMED':
      return state ? { ...state, phase: 'confirmed' } : state;

    case 'INVALIDATED':
      return state ? { ...state, phase: 'dead' } : state;

    case 'TICK': {
      // Подтверждённая операция тоже живёт до expiresAt: терминальное действие можно повторять
      // только пока она не истекла. Но истекает она в `dead`, а не в `expired`: новый код здесь
      // не выход — по подтверждённой операции сервер повторную отправку отклоняет.
      if (!state || (state.phase !== 'active' && state.phase !== 'confirmed')) return state;
      if (action.now < state.expiresAt) return state;
      return { ...state, phase: state.phase === 'confirmed' ? 'dead' : 'expired' };
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
