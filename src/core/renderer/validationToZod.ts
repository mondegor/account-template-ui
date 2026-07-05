import { z } from 'zod';
import type { TFunction } from 'i18next';
import { isFieldType, type FieldValidation, type SchemaNode } from '@core/schema';

/**
 * Генерация zod-схемы формы из JSON `validation` полей (plan.txt §«Валидация»). Сообщения —
 * i18n-ключи из namespace `common.validation`, резолвятся переданным t → в error.message уже
 * готовый к показу текст. Ограничения (min/max) приходят из openapi через сам JSON.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_MIN_DIGITS = 10;

function isPhone(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  return digits.length >= PHONE_MIN_DIGITS && /^\+?[\d\s()-]+$/.test(v.trim());
}

function isEmailOrPhone(v: string): boolean {
  const t = v.trim();
  return t.includes('@') ? EMAIL_RE.test(t) : isPhone(t);
}

function stringField(v: FieldValidation, t: TFunction): z.ZodTypeAny {
  if (v.enum && v.enum.length > 0) {
    return z.enum(v.enum as [string, ...string[]], {
      message: t('common.validation.pattern'),
    });
  }
  let s = z.string();
  // required — первым в цепочке, чтобы для пустого значения показать «обязательное», а не «min N».
  if (v.required) s = s.min(1, t('common.validation.required'));
  if (v.min != null) s = s.min(v.min, t('common.validation.min', { min: v.min }));
  if (v.max != null) s = s.max(v.max, t('common.validation.max', { max: v.max }));
  if (v.pattern) s = s.regex(new RegExp(v.pattern), t('common.validation.pattern'));

  if (v.format === 'email') return s.regex(EMAIL_RE, t('common.validation.email'));
  if (v.format === 'phone') return s.refine(isPhone, t('common.validation.phone'));
  if (v.format === 'login') return s.refine(isEmailOrPhone, t('common.validation.login'));
  return s;
}

function fieldSchema(node: SchemaNode, t: TFunction): z.ZodTypeAny {
  const v = node.validation ?? {};
  if (node.type === 'field.checkbox') {
    return v.required
      ? z.boolean().refine((b) => b === true, t('common.validation.required'))
      : z.boolean();
  }
  const schema = stringField(v, t);
  if (v.required) return schema;
  // Необязательное поле: пустая строка допустима, непустое проходит полную проверку — с её
  // сообщениями. (union со '' терял бы их, отдавая generic invalid_union вместо email/phone/min.)
  return z.preprocess((val) => (val === '' ? undefined : val), schema.optional());
}

/** Собирает объект-схему из полей формы. `fields` — все field-узлы формы (в любой вложенности). */
export function buildFormSchema(fields: SchemaNode[], t: TFunction) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (isFieldType(f.type) && f.name) shape[f.name] = fieldSchema(f, t);
  }
  return z.object(shape);
}

/** Дефолтные значения формы: '' для строк, false для чекбоксов. */
export function buildDefaults(fields: SchemaNode[]): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const f of fields) {
    if (isFieldType(f.type) && f.name) values[f.name] = f.type === 'field.checkbox' ? false : '';
  }
  return values;
}

/** Плоский список field-узлов из поддерева (для сборки схемы/дефолтов). */
export function collectFields(node: SchemaNode): SchemaNode[] {
  const out: SchemaNode[] = [];
  const walk = (n: SchemaNode) => {
    if (isFieldType(n.type)) out.push(n);
    n.children?.forEach(walk);
  };
  walk(node);
  return out;
}
