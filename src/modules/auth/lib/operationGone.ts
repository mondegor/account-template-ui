import { ApiFieldError, parseErrorCode } from '@core/api';

/**
 * Причины отказа 400, после которых операции больше нет: токен неизвестен, истёк или уже использован
 * (`OperationInvalid`), вышел её срок жизни (`OperationAlreadyExpired`) либо она не подтверждена, а
 * позвали то, что бывает только после подтверждения (`OperationIsNotConfirmed`). Последнюю спека
 * называет и у `POST /v1/security/apply-*`, и у обеих ручек заготовки генератора — но к любой из
 * них экран приходит с токеном уже подтверждённой операции, так что ответ этот значит одно:
 * операция не та, за которую её держат. Остальные спека называет и у подтверждения кода, и у
 * открытия сессии, и у повторной отправки. Завершить такую операцию нельзя ничем, поэтому исход тот
 * же, что у 409/403, — тупик и новая операция.
 *
 * `ConfirmCodeIsRequired/secret` (открытие сессии по не до конца подтверждённой операции) сюда
 * намеренно НЕ входит: операция цела, попытка по спеке не расходуется, а тело несёт
 * `operation_state` — снимок возвращается из `confirmed` в `active`, то есть к вводу секрета
 * текущего звена. То же и с `ResendCodeIsNotSupported/token`: по звену, которое подтверждается
 * доказательством без сообщения (второй фактор либо аварийный код), отправлять нечего — у цепочек
 * резервных методов это верно с самого первого звена, — но сама операция жива.
 */
const GONE_REASONS: ReadonlySet<string> = new Set([
  'OperationInvalid',
  'OperationAlreadyExpired',
  'OperationIsNotConfirmed',
]);

export function isOperationGone(e: ApiFieldError): boolean {
  return e.fields.some((f) => GONE_REASONS.has(parseErrorCode(f.code).reason));
}
