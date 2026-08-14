/* eslint-disable react-refresh/only-export-components --
   Приватные адаптеры узлов + функция регистрации в одном модуле (не fast-refresh-граница). */
import { useContext } from 'react';
import { useController, useFormContext } from 'react-hook-form';
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
import { FormErrorContext, LoneFieldContext, SubmitOnlyContext } from './formContext';

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
  const { clearErrors } = useFormContext();
  const submitOnly = useContext(SubmitOnlyContext);
  const { hasError: formError, clear: clearFormError } = useContext(FormErrorContext);
  const loneField = useContext(LoneFieldContext);
  const { field, fieldState } = useController({ name: node.name ?? '' });
  const type = INPUT_TYPE[node.type] ?? 'text';
  return (
    <UiTextField
      label={node.label ? t(node.label) : undefined}
      hideLabel={node.props?.hideLabel}
      collapseHelper={loneField}
      // Форменное сообщение формы с одним полем рисуется строкой под этим блоком — зазор под ним
      // считает блок, и эта строка ему такая же своя.
      messageBelow={loneField && formError}
      type={type}
      // Пароль набирают вслепую — и придуманный, и вспоминаемый: показать набранное можно на любом
      // схемном экране, где такое поле объявлено.
      reveal={
        type === 'password'
          ? { show: t('common.field.showPassword'), hide: t('common.field.hidePassword') }
          : undefined
      }
      name={field.name}
      value={(field.value as string) ?? ''}
      // submitOnly: редактирование гасит показанную ошибку (снова покажется на след. сабмите). Без
      // флага ре-валидация onChange пересчитывает ошибку сама — гасить вручную не нужно. Форменный
      // алерт прошлой попытки убираем всегда.
      onChange={(value) => {
        field.onChange(value);
        if (submitOnly && fieldState.error) clearErrors(field.name);
        clearFormError();
      }}
      onBlur={field.onBlur}
      inputRef={field.ref}
      error={!!fieldState.error}
      helperText={fieldState.error?.message}
      // Подсказка в поле — такой же текст интерфейса, как подпись, и живёт там же, в переводах.
      placeholder={node.props?.placeholder ? t(node.props.placeholder) : undefined}
      autoComplete={node.props?.autoComplete}
      inputMode={node.props?.inputMode}
      autoFocus={node.props?.autoFocus}
      maxLength={node.validation?.max}
    />
  );
}

function SelectNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  const { clear: clearFormError } = useContext(FormErrorContext);
  const { field, fieldState } = useController({ name: node.name ?? '' });
  const options = (node.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }));
  return (
    <UiSelect
      label={node.label ? t(node.label) : undefined}
      hideLabel={node.props?.hideLabel}
      name={field.name}
      value={(field.value as string) ?? ''}
      options={options}
      onChange={(value) => {
        field.onChange(value);
        clearFormError();
      }}
      onBlur={field.onBlur}
      error={!!fieldState.error}
      helperText={fieldState.error?.message}
    />
  );
}

function CheckboxNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  const { clear: clearFormError } = useContext(FormErrorContext);
  const { field, fieldState } = useController({ name: node.name ?? '' });
  return (
    <UiCheckbox
      label={node.label ? t(node.label) : undefined}
      name={field.name}
      checked={!!field.value}
      onChange={(checked) => {
        field.onChange(checked);
        clearFormError();
      }}
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
      // submit-кнопку формы рисует FormRenderer из form.submit; декларативный узел `button` по
      // умолчанию инертен (type='button'), submit — только при явном buttonType: 'submit'.
      type={node.buttonType ?? 'button'}
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
