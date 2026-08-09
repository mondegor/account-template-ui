import { describe, expect, it } from 'vitest';
import { validateSchema, SchemaValidationError } from './validate';

/**
 * Инварианты безопасности схемы: strictObject → любое сырое оформление/посторонние
 * ключи отклоняются; неизвестный type — fail-closed; enum-пропсы строгие.
 */
describe('validateSchema', () => {
  it('accepts a valid page → form → field schema', () => {
    const node = validateSchema({
      id: 'auth.signup',
      type: 'page',
      title: 'auth.signup.title',
      children: [
        {
          type: 'form',
          submit: { label: 'auth.signup.submit' },
          children: [
            {
              type: 'field.email',
              name: 'user_email',
              label: 'auth.field.email',
              validation: { required: true, min: 7, max: 64, format: 'email' },
            },
          ],
        },
      ],
    });
    expect(node.type).toBe('page');
    expect(node.children?.[0].children?.[0].name).toBe('user_email');
  });

  it('fail-closed on an unknown node type', () => {
    expect(() => validateSchema({ type: 'iframe' })).toThrow(SchemaValidationError);
  });

  it('rejects raw styling (sx/style/className)', () => {
    expect(() => validateSchema({ type: 'text', sx: { color: 'red' } })).toThrow(
      SchemaValidationError,
    );
    expect(() => validateSchema({ type: 'text', style: {} })).toThrow(SchemaValidationError);
    expect(() => validateSchema({ type: 'text', className: 'danger' })).toThrow(
      SchemaValidationError,
    );
  });

  it('rejects dangerouslySetInnerHTML and any other foreign keys', () => {
    expect(() =>
      // Единственное легальное упоминание пропа: это данные для валидатора, а не рендер. Тест и
      // проверяет, что схема с ним не проходит, — то есть охраняет тот же инвариант, что и линт.
      // eslint-disable-next-line no-restricted-syntax
      validateSchema({ type: 'text', props: { dangerouslySetInnerHTML: { __html: 'x' } } }),
    ).toThrow(SchemaValidationError);
    expect(() => validateSchema({ type: 'text', onClick: 'alert(1)' })).toThrow(
      SchemaValidationError,
    );
  });

  it('rejects a props.variant value outside the enum', () => {
    expect(() =>
      validateSchema({ type: 'button', label: 'x', props: { variant: 'ghost' } }),
    ).toThrow(SchemaValidationError);
  });

  it('rejects an unknown format in validation', () => {
    expect(() =>
      validateSchema({ type: 'field.text', name: 'x', validation: { format: 'ipv4' } }),
    ).toThrow(SchemaValidationError);
  });

  it('buttonType: accepts submit/button and rejects the rest', () => {
    expect(validateSchema({ type: 'button', label: 'x', buttonType: 'submit' }).buttonType).toBe(
      'submit',
    );
    expect(validateSchema({ type: 'button', label: 'x', buttonType: 'button' }).buttonType).toBe(
      'button',
    );
    expect(() => validateSchema({ type: 'button', label: 'x', buttonType: 'reset' })).toThrow(
      SchemaValidationError,
    );
  });
});
