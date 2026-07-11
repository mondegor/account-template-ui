import { useContext, useEffect, useRef, useState } from 'react';
import { TextField } from '@mui/material';
import { useController, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { NodeComponentProps } from '@core/schema';
import { FormErrorContext, SubmitOnlyContext } from '@core/renderer';
import { validateEmail } from '../lib/userLogin';
import {
  checkEmailAvailability,
  getCachedEmailAvailability,
  type SettledAvailability,
} from '../lib/emailAvailability';

/**
 * Кастомный узел-поле `auth.emailField` (регистрируется модулем auth). Обычный email-инпут формы
 * (useController → zod-валидация по схеме) + живая проверка доступности: после паузы в наборе
 * дёргает check-login, показывает «Проверяем…/Email свободен» (зелёным) или текст «занят». Занятость
 * на submit гейтит async-валидатор (register.ts) — здесь только UX-подсветка.
 */

/** Через сколько мс после остановки печати проверяем доступность email (не долбим ручку). */
const CHECK_DEBOUNCE_MS = 700;

type CheckState = 'idle' | 'checking' | 'free' | 'taken';

export function EmailFieldNode({ node }: NodeComponentProps) {
  const { t } = useTranslation();
  const { clearErrors } = useFormContext();
  const submitOnly = useContext(SubmitOnlyContext);
  const { hasError: hasFormError, clear: clearFormError } = useContext(FormErrorContext);
  const { field, fieldState } = useController({ name: node.name ?? '' });

  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [takenMsg, setTakenMsg] = useState<string | null>(null);

  const valueRef = useRef(''); // актуальное значение — для отсева устаревших ответов
  const aliveRef = useRef(true); // смонтирован ли — чтобы не звать setState после unmount
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Дедуп запросов и восстановление статуса — через общий кэш исходов (lib/emailAvailability),
  // который делят живой чек и async-валидатор сабмита. Транзиентные ошибки там не кэшируются.

  const applyResult = (result: SettledAvailability) => {
    if (result.state === 'free') {
      setCheckState('free');
      setTakenMsg(null);
    } else {
      setCheckState('taken');
      setTakenMsg(result.message ?? t('auth.field.emailTaken'));
    }
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => {
    // re-arm на (ре)монтировании: под StrictMode dev-цикл mount→unmount→remount иначе оставил бы
    // aliveRef=false навсегда (тот же ref-объект) и глушил бы результат каждой свежей проверки.
    aliveRef.current = true;
    // чистим таймер + помечаем размонтирование (запрос в полёте не должен звать setState)
    return () => {
      aliveRef.current = false;
      clearTimer();
    };
  }, []);

  /** Проверка доступности одного значения. Результат применяем, только если поле не изменилось. */
  async function runCheck(value: string) {
    setCheckState('checking');
    const result = await checkEmailAvailability(value);
    if (result.state === 'unknown') {
      // сеть/прочее — тихо, не кэшируем (сервер проверит на сабмите)
      if (aliveRef.current && valueRef.current === value) setCheckState('idle');
      return;
    }
    if (!aliveRef.current || valueRef.current !== value) return; // размонтированы / ответ устарел
    applyResult(result);
  }

  const onChange = (raw: string) => {
    field.onChange(raw);
    valueRef.current = raw;
    if (submitOnly && fieldState.error) clearErrors(field.name);
    clearFormError(); // правка поля убирает верхний алерт прошлой попытки — тогда снова можно зелёное
    clearTimer();
    // Уже проверяли с детерминированным исходом (общий кэш) → восстановить статус, ничего не шлём.
    const cached = getCachedEmailAvailability(raw);
    if (cached) {
      applyResult(cached);
      return;
    }
    setCheckState('idle');
    setTakenMsg(null);
    // Ручку дёргаем только для валидного формата и лишь после паузы в наборе.
    timerRef.current = setTimeout(() => {
      if (validateEmail(raw) === null) void runCheck(raw);
    }, CHECK_DEBOUNCE_MS);
  };

  // Зелёное — только при свободном email и отсутствии ошибки поля ИЛИ форменной ошибки (верхний
  // алерт, напр. «заявка уже обрабатывается»): иначе противоречие «ошибка сверху + всё хорошо у поля».
  const showFree = checkState === 'free' && !fieldState.error && !hasFormError;
  const isError = !!fieldState.error || checkState === 'taken';
  const helperText =
    fieldState.error?.message ??
    takenMsg ??
    (checkState === 'checking'
      ? t('auth.field.emailChecking')
      : showFree
        ? t('auth.field.emailFree')
        : ' ');

  return (
    <TextField
      label={node.label ? t(node.label) : undefined}
      type="email"
      name={field.name}
      value={(field.value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={field.onBlur}
      inputRef={field.ref}
      fullWidth
      size="small"
      autoFocus={node.props?.autoFocus}
      placeholder={node.props?.placeholder}
      error={isError}
      helperText={helperText}
      // Свободный email — зелёная рамка/подпись как явный сигнал «можно регистрироваться».
      color={showFree ? 'success' : undefined}
      focused={showFree || undefined}
      sx={showFree ? { '& .MuiFormHelperText-root': { color: 'success.main' } } : undefined}
      slotProps={{
        htmlInput: {
          autoComplete: node.props?.autoComplete,
          maxLength: node.validation?.max,
          'data-testid': field.name ? `field-${field.name}` : 'ui-textfield',
        },
      }}
    />
  );
}
