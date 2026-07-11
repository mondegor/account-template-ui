import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { SchemaNode } from '@core/schema';
import { buildFormSchema } from './validationToZod';

/**
 * Генерация zod из `validation`. Фокус — enum/select: пустое значение required-селекта (его дефолт —
 * '') должно давать «обязательное поле», а не «неверный формат»; значение вне enum — «неверный формат».
 * t подменяем на identity — сообщение равно i18n-ключу, что удобно ассертить без инициализации i18n.
 */
const t = ((key: string) => key) as unknown as TFunction;

function selectField(required: boolean): SchemaNode {
  return {
    type: 'field.select',
    name: 'role',
    options: [
      { value: 'admin', label: 'x' },
      { value: 'user', label: 'y' },
    ],
    validation: { required, enum: ['admin', 'user'] },
  };
}

describe('buildFormSchema — enum/select', () => {
  it('required, пусто → «обязательное поле» (а не «неверный формат»)', () => {
    const res = buildFormSchema([selectField(true)], t).safeParse({ role: '' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toBe('common.validation.required');
  });

  it('required, значение вне enum → «неверный формат»', () => {
    const res = buildFormSchema([selectField(true)], t).safeParse({ role: 'ghost' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toBe('common.validation.pattern');
  });

  it('required, валидное значение → ок', () => {
    expect(buildFormSchema([selectField(true)], t).safeParse({ role: 'admin' }).success).toBe(true);
  });

  it('optional, пусто → ок', () => {
    expect(buildFormSchema([selectField(false)], t).safeParse({ role: '' }).success).toBe(true);
  });
});
