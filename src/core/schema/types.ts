/**
 * Контракт JSON-описания представлений (декларативное «дерево компонентов»). Схема — только
 * «рисунок» + правила валидации полей + i18n-ключи подписей. Никакой логики, API-вызовов,
 * навигации и ссылок на обработчики в JSON нет (см. plan.txt §«Контракт JSON-схемы»).
 */

export const NODE_TYPES = [
  'page',
  'section',
  'grid',
  'form',
  'field.text',
  'field.email',
  'field.phone',
  'field.password',
  'field.select',
  'field.checkbox',
  'button',
  'text',
  'alert',
  'confirmOperation',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const FIELD_TYPES = [
  'field.text',
  'field.email',
  'field.phone',
  'field.password',
  'field.select',
  'field.checkbox',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(type: string): type is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(type);
}

/** Синхронные правила валидации поля (из openapi-ограничений). Собираются в zod в FormRenderer. */
export interface FieldValidation {
  required?: boolean;
  min?: number;
  max?: number;
  /** email — RFC-подобный; phone — ≥10 значимых цифр; login — email ИЛИ phone (user_login). */
  format?: 'email' | 'phone' | 'login';
  pattern?: string;
  enum?: string[];
}

/** Адаптивная раскладка сетки: число колонок или брейкпоинт-мапа (→ MUI Grid responsive). */
export type ResponsiveCols = number | Partial<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>>;

/** Белый список семантических пропсов (валидируется zod-ом; сырого оформления нет). */
export interface NodeProps {
  variant?: 'contained' | 'outlined' | 'text' | 'filled' | 'standard';
  color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  autoComplete?:
    | 'email'
    | 'username'
    | 'current-password'
    | 'new-password'
    | 'one-time-code'
    | 'tel'
    | 'off';
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
  fullWidth?: boolean;
  autoFocus?: boolean;
}

/**
 * Узел дерева. Единый интерфейс с необязательными полями по ролям (page/form/field/…). Валидность
 * набора полей под конкретный `type` обеспечивает validate.ts (zod), рендерер работает по `type`.
 */
export interface SchemaNode {
  type: NodeType;
  children?: SchemaNode[];
  // page
  id?: string;
  title?: string;
  subtitle?: string;
  layout?: string;
  // form
  submit?: { label: string };
  // field
  name?: string;
  label?: string;
  validation?: FieldValidation;
  options?: Array<{ value: string; label: string }>;
  // grid
  cols?: ResponsiveCols;
  spacing?: number;
  // text / alert
  text?: string;
  severity?: 'error' | 'warning' | 'info' | 'success';
  props?: NodeProps;
}

/** Источник локальной схемы (импортированный из бандла модуля JSON). */
export type SchemaSource = unknown;
