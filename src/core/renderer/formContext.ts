import { createContext } from 'react';

/**
 * Признак «форма в submit-only режиме» (см. FormRenderer / SchemaNode.submitOnly). Пробрасывается
 * узлам-полям, чтобы гасить показанную ошибку при вводе только в этом режиме (при обычной валидации
 * с ре-валидацией onChange это не нужно — RHF пересчитывает ошибку сам).
 */
export const SubmitOnlyContext = createContext(false);

/**
 * В форме ровно одно поле. Сообщения такой формы — и ошибка поля, и форменная — идут одной строкой
 * под полем, и места под неё заранее не занимают: пустой зазор над кнопкой там нечем оправдать.
 * Считает форма, а не поле: сколько в ней полей, знает только она.
 */
export const LoneFieldContext = createContext(false);

/**
 * Форменная (глобальная) ошибка — алерт FormRenderer. Пробрасывается узлам-полям, чтобы:
 *  - `hasError` гасил позитивную подсветку (напр. зелёное «Email свободен» в EmailFieldNode) —
 *    иначе противоречие «ошибка сверху + всё хорошо у поля»;
 *  - `clear` вызывался из onChange поля (пользовательская правка) и убирал алерт прошлой попытки.
 *    Идёт мимо resetField, поэтому сброс пароля в finally сабмита не гасит только что показанную
 *    ошибку.
 */
export interface FormErrorState {
  hasError: boolean;
  clear: () => void;
}

export const FormErrorContext = createContext<FormErrorState>({
  hasError: false,
  clear: () => {},
});
