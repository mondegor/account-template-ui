import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiProblemError } from '@core/api';
import { moduleQueryKey } from '@core/module-registry';
import { useOperationStore } from '@core/operation';
import { saveSecurityFlow, type SecurityFlowKind } from '../lib/securityFlow';
import type { WaitingConfirmOperation } from '../api/types';

/**
 * Запуск security-потока: инициатор создаёт операцию, её снимок ложится в стор, рядом пишется, чей
 * это поток, и экран сменяется на подтверждение. Жест один на все потоки, а различает их только
 * метод-инициатор — поэтому он и приходит параметром.
 *
 * Запись потока обязана лечь ДО навигации: экран подтверждения читает её на первом же рендере и без
 * неё увёл бы обратно, приняв операцию за чужую.
 *
 * Отказ инициатора остаётся у вызывающего (`start.error`): показать его умеет только тот экран, с
 * которого поток начали, — под полем формы или плашкой в карточке. Кроме того, 409 значит, что
 * состояние защиты сменилось где-то ещё (например, в соседней вкладке) и экран рисует уже неверный
 * набор действий: профиль перечитываем здесь, для всех экранов разом, — иначе кнопка, которой
 * отказали, так и осталась бы на месте и отказывала бы снова.
 */
export function useStartSecurityFlow() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dispatch = useOperationStore((s) => s.dispatch);

  return useMutation({
    mutationFn: ({
      start,
    }: {
      kind: SecurityFlowKind;
      start: () => Promise<WaitingConfirmOperation>;
      /** Новое значение, которое поток устанавливает (емаил, номер), — для подсказок подтверждения. */
      value?: string;
    }) => start(),
    onSuccess: (operation, { kind, value }) => {
      dispatch({ type: 'START', parts: operation, now: Date.now() });
      saveSecurityFlow({ kind, value });
      navigate('/security/confirm');
    },
    onError: (e) => {
      if (e instanceof ApiProblemError && e.status === 409) {
        void queryClient.invalidateQueries({ queryKey: moduleQueryKey('auth', 'user') });
      }
    },
  });
}
