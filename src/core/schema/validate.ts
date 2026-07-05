import { z } from 'zod';
import { NODE_TYPES, type SchemaNode } from './types';

/**
 * Валидация самой JSON-схемы (fail-fast при загрузке). Инварианты plan.txt:
 *  - strictObject на каждом узле → любой посторонний ключ (в т.ч. `sx`/`style`/`className`/
 *    инлайновый CSS/`onClick`/`dangerouslySetInnerHTML`) — ошибка валидации;
 *  - `variant`/`color`/`autoComplete`/`inputMode` — строго enum;
 *  - неизвестный `type` — ошибка (fail-closed);
 *  - `props` — только из белого списка на узел.
 * Некорректная схема даёт понятную ошибку до рендера, а не падение рендерера.
 */

const responsiveCols = z.union([
  z.number().int().positive(),
  z.strictObject({
    xs: z.number().int().positive().optional(),
    sm: z.number().int().positive().optional(),
    md: z.number().int().positive().optional(),
    lg: z.number().int().positive().optional(),
    xl: z.number().int().positive().optional(),
  }),
]);

const nodeProps = z.strictObject({
  variant: z.enum(['contained', 'outlined', 'text', 'filled', 'standard']).optional(),
  color: z.enum(['primary', 'secondary', 'error', 'info', 'success', 'warning']).optional(),
  autoComplete: z
    .enum(['email', 'username', 'current-password', 'new-password', 'one-time-code', 'tel', 'off'])
    .optional(),
  placeholder: z.string().optional(),
  inputMode: z.enum(['text', 'numeric', 'tel', 'email']).optional(),
  fullWidth: z.boolean().optional(),
  autoFocus: z.boolean().optional(),
});

const fieldValidation = z.strictObject({
  required: z.boolean().optional(),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  format: z.enum(['email', 'phone', 'login']).optional(),
  pattern: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

const nodeSchema: z.ZodType<SchemaNode> = z.lazy(() =>
  z.strictObject({
    type: z.enum(NODE_TYPES),
    children: z.array(nodeSchema).optional(),
    id: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    layout: z.string().optional(),
    submit: z.strictObject({ label: z.string() }).optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    validation: fieldValidation.optional(),
    options: z.array(z.strictObject({ value: z.string(), label: z.string() })).optional(),
    cols: responsiveCols.optional(),
    spacing: z.number().nonnegative().optional(),
    text: z.string().optional(),
    severity: z.enum(['error', 'warning', 'info', 'success']).optional(),
    props: nodeProps.optional(),
  }),
) as z.ZodType<SchemaNode>;

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/** Парсит и валидирует произвольный JSON как схему представления. Бросает SchemaValidationError. */
export function validateSchema(input: unknown): SchemaNode {
  const result = nodeSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new SchemaValidationError(`Некорректная схема представления: ${issues}`);
  }
  return result.data;
}
