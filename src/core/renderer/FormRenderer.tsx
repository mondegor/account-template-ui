import { useMemo, useState, type ReactNode } from 'react';
import {
  FormProvider,
  useForm,
  type Resolver,
  type UseFormSetError,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Box } from '@mui/material';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { getHandler, type SchemaNode } from '@core/schema';
import { UiAlert, UiButton } from '@ui';
import { useHandlerContext } from './bindings';
import { buildDefaults, buildFormSchema, collectFields } from './validationToZod';

type FormValues = Record<string, unknown>;

/**
 * Рендер узла `form`: react-hook-form + zod-схема, СГЕНЕРИРОВАННАЯ из `validation` полей. На submit
 * берёт обработчик по schemaId (schemaHandlers) — маппинг в DTO и вызов API живут там. Ошибки:
 * поля с известным именем → setError на поле; прочие + ApiProblemError (401/403/5xx) → форменный
 * алерт. Чувствительные поля (password) сбрасываются после submit. children — предрендеренные
 * дочерние узлы (поля резолвят контекст формы позиционно внутри FormProvider).
 */
export function FormRenderer({
  node,
  schemaId,
  children,
}: {
  node: SchemaNode;
  schemaId?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const ctx = useHandlerContext();
  const [formError, setFormError] = useState<string | null>(null);

  const fields = useMemo(() => collectFields(node), [node]);
  const fieldNames = useMemo(
    () => new Set(fields.map((f) => f.name).filter((n): n is string => !!n)),
    [fields],
  );
  const resolver = useMemo(
    () => zodResolver(buildFormSchema(fields, t)) as Resolver<FormValues>,
    [fields, t],
  );
  const defaults = useMemo(() => buildDefaults(fields) as FormValues, [fields]);

  const form = useForm<FormValues>({ resolver, defaultValues: defaults, mode: 'onTouched' });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const entry = schemaId ? getHandler(schemaId) : undefined;
    if (!entry) {
      setFormError(t('common.error.generic'));
      return;
    }
    // Асинхронные проверки (напр. доступность email) — на submit, до вызова обработчика.
    if (entry.asyncValidators) {
      const messages = await Promise.all(
        Object.entries(entry.asyncValidators).map(async ([name, validate]) => {
          const msg = await validate(values[name], values);
          if (msg) form.setError(name, { message: msg });
          return msg;
        }),
      );
      if (messages.some(Boolean)) return;
    }
    try {
      await entry.handler(values, ctx);
    } catch (e) {
      mapSubmitError(e, form.setError, fieldNames, setFormError, t);
    } finally {
      fields
        .filter((f) => f.type === 'field.password' && f.name)
        .forEach((f) => form.resetField(f.name as string));
    }
  });

  return (
    <FormProvider {...form}>
      {formError && <UiAlert severity="error">{formError}</UiAlert>}
      <Box component="form" onSubmit={onSubmit} noValidate>
        {children}
        {node.submit && (
          <UiButton
            type="submit"
            label={t(node.submit.label)}
            disabled={form.formState.isSubmitting}
          />
        )}
      </Box>
    </FormProvider>
  );
}

function mapSubmitError(
  e: unknown,
  setError: UseFormSetError<FormValues>,
  fieldNames: Set<string>,
  setFormError: (msg: string) => void,
  t: TFunction,
): void {
  if (e instanceof ApiFieldError) {
    const globals: string[] = [];
    for (const f of e.fields) {
      if (fieldNames.has(f.code)) setError(f.code, { message: f.detail });
      else globals.push(f.detail);
    }
    if (globals.length) setFormError(globals[0]);
    return;
  }
  if (e instanceof ApiProblemError) {
    setFormError(e.details.detail || e.details.title);
    return;
  }
  setFormError(t('common.error.generic'));
}
