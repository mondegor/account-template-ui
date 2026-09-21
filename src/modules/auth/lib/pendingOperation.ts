import type { WaitingParts } from '@core/operation';
import type { PendingOperation, UserInfo } from '../api/types';

/**
 * Незакрытая вторая операция смены емаила — подтверждение владения новым адресом. Живёт порядка
 * 72 часов и видна в профиле всё это время: к ней возвращаются позже, из другой вкладки или с
 * другого устройства. Такая операция у аккаунта одна — новая смена закрывает прежнюю.
 */
export function pendingEmailChange(user: UserInfo): PendingOperation | undefined {
  return user.pending_operations?.find((op) => op.type === 'CHANGE_EMAIL_CONFIRM');
}

/**
 * Снимок для стора операций из записи профиля. Записи в `OPENED` несут метод звена и счётчики — те
 * же, что `WaitingConfirmOperation`, — поэтому подтверждение открывается без запроса. Срок в записи
 * абсолютный, а снимок ждёт остаток: пересчитываем от `now`, расхождение часов клиента с сервером
 * сдвинет таймер ровно на себя.
 *
 * `null` — подтверждать нечего: операция уже подтверждена и ждёт только применения.
 */
export function pendingToWaiting(op: PendingOperation, now: number): WaitingParts | null {
  // Поля звена приходят только у OPENED — проверка их наличия и есть проверка статуса.
  if (op.status !== 'OPENED' || !op.confirm_method || op.remaining_attempts === undefined) {
    return null;
  }
  return {
    token: op.token,
    confirm_method: op.confirm_method,
    remaining_attempts: op.remaining_attempts,
    remaining_resends: op.remaining_resends,
    resends_in: op.resends_in,
    expires_in: Math.max(0, Math.floor((Date.parse(op.expires_at) - now) / 1000)),
  };
}
