import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
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
 * которого поток начали, — под полем формы или плашкой в карточке.
 */
export function useStartSecurityFlow() {
  const navigate = useNavigate();
  const dispatch = useOperationStore((s) => s.dispatch);

  return useMutation({
    mutationFn: ({
      start,
    }: {
      kind: SecurityFlowKind;
      start: () => Promise<WaitingConfirmOperation>;
    }) => start(),
    onSuccess: (operation, { kind }) => {
      dispatch({ type: 'START', parts: operation, now: Date.now() });
      saveSecurityFlow({ kind });
      navigate('/security/confirm');
    },
  });
}
