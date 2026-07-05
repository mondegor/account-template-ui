/* eslint-disable react-refresh/only-export-components --
   Приватные адаптеры узлов + функция регистрации в одном модуле (не fast-refresh-граница). */
import { useController } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  UiAlert,
  UiButton,
  UiCheckbox,
  UiGrid,
  UiPage,
  UiSection,
  UiSelect,
  UiText,
  UiTextField,
} from '@ui';
import { hasComponent, registerComponent, type NodeComponentProps } from '@core/schema';

/**
 * Базовые schema-aware адаптеры: мапят узел (SchemaNode) на презентационный ui-атом и, для полей,
 * подключают контекст react-hook-form (useController). Подписи — i18n-ключи, резолвятся через t.
 * Компоненты приватны; наружу — только registerBaseComponents (регистрация базовых типов ядром).
 */

const INPUT_TYPE: Record<string, 'text' | 'email' | 'password' | 'tel'> = {
  'field.text': 'text',
  'field.email': 'email',
  'field.password': 'password',
  'field.phone': 'tel',
};

function TextFieldNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  const { field, fieldState } = useController({ name: node.name ?? '' });
  return (
    <UiTextField
      label={node.label ? t(node.label) : undefined}
      type={INPUT_TYPE[node.type] ?? 'text'}
      name={field.name}
      value={(field.value as string) ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      inputRef={field.ref}
      error={!!fieldState.error}
      helperText={fieldState.error?.message}
      placeholder={node.props?.placeholder}
      autoComplete={node.props?.autoComplete}
      inputMode={node.props?.inputMode}
      autoFocus={node.props?.autoFocus}
      maxLength={node.validation?.max}
    />
  );
}

function SelectNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  const { field, fieldState } = useController({ name: node.name ?? '' });
  const options = (node.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }));
  return (
    <UiSelect
      label={node.label ? t(node.label) : undefined}
      name={field.name}
      value={(field.value as string) ?? ''}
      options={options}
      onChange={field.onChange}
      onBlur={field.onBlur}
      error={!!fieldState.error}
      helperText={fieldState.error?.message}
    />
  );
}

function CheckboxNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  const { field, fieldState } = useController({ name: node.name ?? '' });
  return (
    <UiCheckbox
      label={node.label ? t(node.label) : undefined}
      name={field.name}
      checked={!!field.value}
      onChange={field.onChange}
      onBlur={field.onBlur}
      error={!!fieldState.error}
      helperText={fieldState.error?.message}
    />
  );
}

function PageNode({ node, children }: NodeComponentProps) {
  const { t } = useTranslation();
  return (
    <UiPage
      title={node.title ? t(node.title) : undefined}
      subtitle={node.subtitle ? t(node.subtitle) : undefined}
    >
      {children}
    </UiPage>
  );
}

function SectionNode({ node, children }: NodeComponentProps) {
  return <UiSection spacing={node.spacing}>{children}</UiSection>;
}

function GridNode({ node, children }: NodeComponentProps) {
  return (
    <UiGrid cols={node.cols} spacing={node.spacing}>
      {children}
    </UiGrid>
  );
}

function TextNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  return <UiText>{node.text ? t(node.text) : ''}</UiText>;
}

function AlertNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  return <UiAlert severity={node.severity}>{node.text ? t(node.text) : ''}</UiAlert>;
}

function ButtonNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  const variant = node.props?.variant;
  return (
    <UiButton
      type="submit"
      label={node.label ? t(node.label) : ''}
      variant={variant === 'outlined' || variant === 'text' ? variant : 'contained'}
      color={node.props?.color}
    />
  );
}

/** Регистрирует базовые типы узлов в componentRegistry (идемпотентно). `form` — спец-узел
 * SchemaRenderer; `confirmOperation` регистрирует модуль auth. */
export function registerBaseComponents(): void {
  if (hasComponent('page')) return;
  registerComponent('page', PageNode);
  registerComponent('section', SectionNode);
  registerComponent('grid', GridNode);
  registerComponent('text', TextNode);
  registerComponent('alert', AlertNode);
  registerComponent('button', ButtonNode);
  registerComponent('field.text', TextFieldNode);
  registerComponent('field.email', TextFieldNode);
  registerComponent('field.phone', TextFieldNode);
  registerComponent('field.password', TextFieldNode);
  registerComponent('field.select', SelectNode);
  registerComponent('field.checkbox', CheckboxNode);
}
