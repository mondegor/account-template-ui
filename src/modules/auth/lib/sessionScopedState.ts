import { useOperationStore } from '@core/operation';
import { clearSecurityFlow } from './securityFlow';
import { clearRecoveryCodes } from './recoveryCodes';

/**
 * Состояние, принадлежащее сессии: незавершённая операция, запись её потока защиты и показанные
 * аварийные коды. Всё это переживает саму сессию — операция и запись лежат в sessionStorage, коды в
 * памяти вкладки, — а вкладка при смене пользователя не перезагружается. Оставленное, оно досталось
 * бы следующему: гость попал бы на /confirm с чужим подтверждением, а оборванная посреди 2FA
 * операция — со своим securityFlow, закрыть который без сессии нечем.
 *
 * Из core этого не сделать: всё перечисленное живёт в модуле, а импорт core → modules закрыт
 * границами слоёв.
 */
export function dropSessionScopedState(): void {
  useOperationStore.getState().reset();
  clearSecurityFlow();
  clearRecoveryCodes();
}
