import { describe, expect, it } from 'vitest';
import { ApiFieldError } from '@core/api';
import { isOperationGone } from './operationGone';

/** Detail придумывает тест: он здесь ни на что не влияет, разбирается один код. */
const gone = (code: string) => new ApiFieldError([{ code, detail: 'Refused' }], 400);

describe('isOperationGone', () => {
  it('a reason about the operation itself counts with the link suffix and without it', () => {
    expect(isOperationGone(gone('OperationInvalid'))).toBe(true);
    expect(isOperationGone(gone('OperationInvalid/token'))).toBe(true);
    expect(isOperationGone(gone('OperationAlreadyExpired'))).toBe(true);
    expect(isOperationGone(gone('OperationIsNotConfirmed'))).toBe(true);
  });

  /** Занятый адрес — тупик только там, где операцию применяют: у инициатора он идёт под поле. */
  it('a taken address is a dead end without the field and a form refusal with it', () => {
    expect(isOperationGone(gone('EmailAlreadyExists'))).toBe(true);
    expect(isOperationGone(gone('EmailAlreadyExists/new_email'))).toBe(false);
  });

  it('a refusal the operation survives is not a dead end', () => {
    expect(isOperationGone(gone('ConfirmCodeIsIncorrect'))).toBe(false);
    expect(isOperationGone(gone('ConfirmCodeIsRequired/secret'))).toBe(false);
    expect(isOperationGone(gone('ResendCodeIsNotSupported/token'))).toBe(false);
  });

  it('takes any of the listed fields, not only the first', () => {
    const e = new ApiFieldError(
      [
        { code: 'ValidateError/new_email', detail: 'Malformed' },
        { code: 'OperationInvalid', detail: 'Gone' },
      ],
      400,
    );
    expect(isOperationGone(e)).toBe(true);
  });
});
