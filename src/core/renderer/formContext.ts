import { createContext } from 'react';

/**
 * Признак «форма в submit-only режиме» (см. FormRenderer / SchemaNode.submitOnly). Пробрасывается
 * узлам-полям, чтобы гасить показанную ошибку при вводе только в этом режиме (при обычной валидации
 * с ре-валидацией onChange это не нужно — RHF пересчитывает ошибку сам).
 */
export const SubmitOnlyContext = createContext(false);

/**
 * Форменная (глобальная) ошибка — верхний алерт FormRenderer. Пробрасывается узлам-полям, чтобы:
 *  - `hasError` гасил позитивную подсветку (напр. зелёное «Email свободен» в EmailFieldNode) —
 *    иначе противоречие «ошибка сверху + всё хорошо у поля»;
 *  - `clear` вызывался из onChange поля (пользовательская правка) и убирал алерт прошлой попытки,
 *    как это делал старый SignupPage. Идёт мимо resetField, поэтому сброс пароля в finally сабмита
 *    не гасит только что показанную ошибку.
 */
export interface FormErrorState {
  hasError: boolean;
  clear: () => void;
}

export const FormErrorContext = createContext<FormErrorState>({
  hasError: false,
  clear: () => {},
});
