import { describe, expect, it } from 'vitest';
import { validateSchema, SchemaValidationError } from './validate';

/**
 * Инварианты безопасности схемы (plan.txt): strictObject → любое сырое оформление/посторонние
 * ключи отклоняются; неизвестный type — fail-closed; enum-пропсы строгие.
 */
describe('validateSchema', () => {
  it('принимает корректную схему page → form → field', () => {
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

  it('fail-closed на неизвестный тип узла', () => {
    expect(() => validateSchema({ type: 'iframe' })).toThrow(SchemaValidationError);
  });

  it('отклоняет сырое оформление (sx/style/className)', () => {
    expect(() => validateSchema({ type: 'text', sx: { color: 'red' } })).toThrow(
      SchemaValidationError,
    );
    expect(() => validateSchema({ type: 'text', style: {} })).toThrow(SchemaValidationError);
    expect(() => validateSchema({ type: 'text', className: 'danger' })).toThrow(
      SchemaValidationError,
    );
  });

  it('отклоняет dangerouslySetInnerHTML и прочие посторонние ключи', () => {
    expect(() =>
      validateSchema({ type: 'text', props: { dangerouslySetInnerHTML: { __html: 'x' } } }),
    ).toThrow(SchemaValidationError);
    expect(() => validateSchema({ type: 'text', onClick: 'alert(1)' })).toThrow(
      SchemaValidationError,
    );
  });

  it('отклоняет не-enum значение props.variant', () => {
    expect(() =>
      validateSchema({ type: 'button', label: 'x', props: { variant: 'ghost' } }),
    ).toThrow(SchemaValidationError);
  });

  it('отклоняет неизвестный format в validation', () => {
    expect(() =>
      validateSchema({ type: 'field.text', name: 'x', validation: { format: 'ipv4' } }),
    ).toThrow(SchemaValidationError);
  });
});
