import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  FormProvider,
  useForm,
  useWatch,
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
import { FormErrorContext, SubmitOnlyContext } from './formContext';

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
  // Правка любого поля убирает форменный алерт прошлой попытки (как в старом SignupPage). setState
  // с тем же null React пропускает, так что вызов на каждый keystroke безвреден.
  const clearFormError = useCallback(() => setFormError(null), []);
  const formErrorCtx = useMemo(
    () => ({ hasError: formError !== null, clear: clearFormError }),
    [formError, clearFormError],
  );

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

  // submitOnly (узел form) — UX обособленных auth-форм: валидация только по сабмиту (пустое/невалидное
  // поле не краснеет при фокусе/blur/вводе; формат-ошибки — по кнопке), reValidateMode='onSubmit' —
  // показанная ошибка держится и снимается фактом редактирования (clearErrors в onChange поля, см.
  // baseNodes/EmailFieldNode), shouldFocusError:false. Без флага — стандартная валидация onTouched +
  // ре-валидация onChange (все типы полей ведут себя ровно), гейта пустой кнопки нет.
  const submitOnly = node.submitOnly === true;
  const form = useForm<FormValues>({
    resolver,
    defaultValues: defaults,
    mode: submitOnly ? 'onSubmit' : 'onTouched',
    reValidateMode: submitOnly ? 'onSubmit' : 'onChange',
    shouldFocusError: !submitOnly,
  });

  // submitOnly: кнопка неактивна, пока пусто хоть одно обязательное поле; пустой сабмит блокируется —
  // поэтому ошибка «обязательное поле» не показывается вовсе (формат-ошибки работают по сабмиту).
  const requiredNames = useMemo(
    () => fields.filter((f) => f.validation?.required && f.name).map((f) => f.name as string),
    [fields],
  );
  const watched = useWatch({ control: form.control }) as FormValues;
  const requiredEmpty =
    submitOnly &&
    requiredNames.some((name) => {
      const v = watched?.[name];
      return v === '' || v == null || v === false;
    });

  const submitValid = form.handleSubmit(async (values) => {
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
      // Чувствительные поля (password) чистим после сабмита, но keepError сохраняет только что
      // выставленную серверную ошибку поля (иначе resetField затёр бы её вместе со значением).
      fields
        .filter((f) => f.type === 'field.password' && f.name)
        .forEach((f) => form.resetField(f.name as string, { keepError: true }));
    }
  });

  // Пустую форму не отправляем (в т.ч. по Enter) — валидация required не запускается.
  const onSubmit = (e: FormEvent) => {
    if (requiredEmpty) {
      e.preventDefault();
      return;
    }
    void submitValid(e);
  };

  return (
    <FormProvider {...form}>
      <SubmitOnlyContext.Provider value={submitOnly}>
        <FormErrorContext.Provider value={formErrorCtx}>
          {formError && <UiAlert severity="error">{formError}</UiAlert>}
          <Box component="form" onSubmit={onSubmit} noValidate>
            {children}
            {node.submit && (
              <UiButton
                type="submit"
                label={t(node.submit.label)}
                disabled={form.formState.isSubmitting || requiredEmpty}
              />
            )}
          </Box>
        </FormErrorContext.Provider>
      </SubmitOnlyContext.Provider>
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
    if (globals.length) setFormError(globals.join(' '));
    return;
  }
  if (e instanceof ApiProblemError) {
    setFormError(e.details.detail || e.details.title);
    return;
  }
  setFormError(t('common.error.generic'));
}
