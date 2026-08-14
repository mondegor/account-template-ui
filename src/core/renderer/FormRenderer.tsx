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
import { ApiFieldError, apiErrorText } from '@core/api';
import { getHandler, type SchemaNode } from '@core/schema';
import { UiAlert, UiButton, UiFieldMessage, uiFieldBlockSx } from '@ui';
import { useHandlerContext } from './bindings';
import { buildDefaults, buildFormSchema, collectFields } from './validationToZod';
import { FormErrorContext, LoneFieldContext, SubmitOnlyContext } from './formContext';

type FormValues = Record<string, unknown>;

/**
 * Рендер узла `form`: react-hook-form + zod-схема, СГЕНЕРИРОВАННАЯ из `validation` полей. На submit
 * берёт обработчик по schemaId (schemaHandlers) — маппинг в DTO и вызов API живут там. Ошибки:
 * 400 по полю этой формы → setError на поле; прочие 400, 429 и ApiProblemError (401/403/5xx) →
 * форменный алерт с текстом от apiErrorText. Чувствительные поля (password) чистятся после submit.
 * children — предрендеренные дочерние узлы (поля резолвят контекст формы позиционно внутри
 * FormProvider).
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
  // Правка любого поля убирает форменный алерт прошлой попытки. setState с тем же null React
  // пропускает, так что вызов на каждый keystroke безвреден.
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
  const loneField = fields.length === 1;

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

  // submitOnly: пока форма не набрана, кнопка неактивна, и сабмит с таким значением не проходит.
  // «Не набрано» — это не отказ, а незаконченный ввод, поэтому под полем про него не пишут ничего:
  // ни «обязательное поле», ни «минимум N» на экране не бывает вовсе. Ошибка формата — другое дело,
  // там ввели не то, и она показывается по кнопке.
  //
  // Правила min при этом остаются в zod (validationToZod): схема зеркалит ограничения контракта,
  // и без submitOnly гейта нет — сообщение там достижимо.
  //
  // Гейт держит только обязательные поля: необязательное запирало бы кнопку молча и без выхода —
  // человеку не сказано ни что не так, ни что поле можно было вовсе не трогать.
  const gatedFields = useMemo(
    () => fields.filter((f) => f.name && f.validation?.required),
    [fields],
  );
  const watched = useWatch({ control: form.control }) as FormValues;
  const notReady =
    submitOnly &&
    gatedFields.some((f) => {
      const v = watched?.[f.name as string];
      if (typeof v === 'string') {
        if (v === '') return true;
        // Сырая длина, как у z.string().min(): гейт не имеет права быть мягче схемы, иначе сабмит
        // дойдёт до неё и покажет то самое «минимум N».
        return v.length < (f.validation?.min ?? 0);
      }
      // Чекбоксу длину не меряют: набран он или нет — это и есть его значение.
      return !v;
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

  // Ненабранную форму не отправляем (в т.ч. по Enter) — валидация до неё не доходит.
  const onSubmit = (e: FormEvent) => {
    if (notReady) {
      e.preventDefault();
      return;
    }
    void submitValid(e);
  };

  return (
    <FormProvider {...form}>
      <SubmitOnlyContext.Provider value={submitOnly}>
        <LoneFieldContext.Provider value={loneField}>
          <FormErrorContext.Provider value={formErrorCtx}>
            {formError && !loneField && <UiAlert severity="error">{formError}</UiAlert>}
            <Box component="form" onSubmit={onSubmit} noValidate>
              {children}
              {/* У формы с одним полем сообщению место одно — под этим полем: разбирать, к полю
                  относится отказ или ко всей форме, там не по чему. Строка стоит ниже блока поля,
                  поэтому зазор за ней держит эта обёртка — блок его ей и отдал (messageBelow).
                  Обёртка постоянная: UiFieldMessage уходит из разметки сам, по концу схлопывания,
                  и снять его снаружи значило бы оборвать анимацию.
                  Роль живёт на обёртке ровно поэтому: она на месте с первого кадра, и отказ
                  вставляется внутрь готового региона — это его и объявляет. Повесь роль на саму
                  строку, и объявлять было бы нечего: строка появляется вместе с текстом. Без неё
                  многополевая форма говорит отказ через UiAlert, а однополевая молчала бы. */}
              {loneField && (
                <Box role="alert" sx={uiFieldBlockSx(formError ? 'message' : 'flush')}>
                  <UiFieldMessage text={formError ?? undefined} tone="error" />
                </Box>
              )}
              {node.submit && (
                // У формы с одним полем зазор над кнопкой держат блок поля и строка под ним:
                // сколько его нужно, знают только они. Многополевой форме отступ нужен свой —
                // там поля его не держат.
                <Box sx={{ mt: loneField ? 0 : 2 }}>
                  <UiButton
                    type="submit"
                    label={t(node.submit.label)}
                    disabled={form.formState.isSubmitting || notReady}
                  />
                </Box>
              )}
            </Box>
          </FormErrorContext.Provider>
        </LoneFieldContext.Provider>
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
    const { byField, global } = e.split(fieldNames, t);
    for (const { name, detail } of byField) setError(name, { message: detail });
    if (global) setFormError(global);
    return;
  }
  // Всё остальное (429, problem+json, транспорт, неизвестное) — общим сообщением по единому
  // правилу: серверная деталь, иначе перевод.
  setFormError(apiErrorText(e, t));
}
