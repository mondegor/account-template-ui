import { useCallback, useEffect, useState } from 'react';
import {
  useOperationStore,
  canResendNow,
  expiresSecondsLeft,
  isResendApplicable,
  resendSecondsLeft,
} from '@core/operation';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { confirmOperation, openSession, resendOperation, revokeOperation } from '../api/authApi';
import type { WaitingConfirmOperation } from '../api/types';

interface UseConfirmFlowArgs {
  onAccess: () => void;
  onRevoked: () => void;
}

/**
 * Флоу подтверждения (auth-обвязка над generic-движком). После 204 выполняет терминальное
 * действие openSession({token, secret}); 200 из confirm = следующее звено цепочки (задел под 2FA).
 * Счётчики/таймеры обновляются из ответов; неверный код читает operation_state (backend_answers §6).
 */
export function useConfirmFlow({ onAccess, onRevoked }: UseConfirmFlowArgs) {
  const snapshot = useOperationStore((s) => s.snapshot);
  const dispatch = useOperationStore((s) => s.dispatch);
  const reset = useOperationStore((s) => s.reset);

  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  // Локальный тик раз в секунду: пересчёт таймеров + перевод в expired.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: 'TICK', now: t });
    }, 1000);
    return () => clearInterval(id);
  }, [dispatch]);

  const startNextLink = useCallback(
    (op: WaitingConfirmOperation) => dispatch({ type: 'START', parts: op, now: Date.now() }),
    [dispatch],
  );

  const confirm = useCallback(
    async (secret: string) => {
      if (!snapshot) return;
      setSubmitting(true);
      setError(null);
      try {
        const next = await confirmOperation({ token: snapshot.token, secret });
        if (next) {
          // 200 — ещё одно подтверждение (цепочка), напр. 2FA-шаг.
          startNextLink(next);
          return;
        }
        // 204 — терминальное действие: открыть сессию.
        const result = await openSession({ token: snapshot.token, secret });
        if (result.kind === 'access') {
          dispatch({ type: 'DONE' });
          reset();
          onAccess();
        } else {
          startNextLink(result.operation);
        }
      } catch (e) {
        if (e instanceof ApiFieldError) {
          if (e.operationState) {
            dispatch({ type: 'CONFIRM_FAILED', state: e.operationState, now: Date.now() });
          }
          setError(e.fields[0]?.detail ?? 'Неверный код');
        } else if (e instanceof ApiProblemError) {
          setError(e.details.detail || e.details.title);
        } else {
          setError('Не удалось подтвердить код. Попробуйте ещё раз.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [snapshot, startNextLink, dispatch, reset, onAccess],
  );

  const resend = useCallback(async () => {
    if (!snapshot || resending) return; // защита от повторной отправки (двойной клик жжёт лимит)
    setResending(true);
    setError(null);
    try {
      const op = await resendOperation({ token: snapshot.token });
      dispatch({ type: 'RESENT', parts: op, now: Date.now() });
    } catch (e) {
      if (e instanceof ApiFieldError && e.operationState) {
        dispatch({ type: 'CONFIRM_FAILED', state: e.operationState, now: Date.now() });
        setError(e.fields[0]?.detail ?? 'Повтор пока недоступен');
      } else {
        setError('Не удалось отправить код повторно.');
      }
    } finally {
      setResending(false);
    }
  }, [snapshot, dispatch, resending]);

  const revoke = useCallback(async () => {
    if (snapshot) {
      try {
        await revokeOperation({ token: snapshot.token });
      } catch {
        /* отмена лучшего усилия */
      }
    }
    reset();
    onRevoked();
  }, [snapshot, reset, onRevoked]);

  return {
    snapshot,
    error,
    submitting,
    resending,
    expiresLeft: snapshot ? expiresSecondsLeft(snapshot, now) : 0,
    resendLeft: snapshot ? resendSecondsLeft(snapshot, now) : 0,
    canResend: snapshot ? canResendNow(snapshot, now) : false,
    isResendApplicable: snapshot ? isResendApplicable(snapshot) : false,
    confirm,
    resend,
    revoke,
  };
}
