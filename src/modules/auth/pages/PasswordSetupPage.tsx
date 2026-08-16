import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link as RouterLink } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';
import { UiBusyIcon, UiFieldMessage, UiTextField, uiFieldBlockSx } from '@ui';
import { ApiFieldError, ApiProblemError, apiErrorText } from '@core/api';
import { limits } from '@config';
import { generatePassword, startPasswordSetup } from '../api/authApi';
import { isPassingStrength } from '../lib/passwordStrength';
import { usePasswordStrength } from '../hooks/usePasswordStrength';
import { useStartSecurityFlow } from '../hooks/useStartSecurityFlow';
import { SecurityPage } from '../ui/SecurityPage';
import { StrengthMeter } from '../ui/StrengthMeter';
import { CheckIcon, CopyIcon, ShieldDotsIcon } from '../ui/icons';
import type { PasswordStrength } from '../api/types';

/**
 * Первый шаг включения 2FA по паролю: сам пароль. Дальше поток подхватывает общий экран
 * подтверждения — своих шагомеров форма не рисует.
 *
 * Ворота стоят на оценке сервера, а не на длине: длина от слабого пароля не спасает, а правила
 * надёжности принадлежат развёртыванию. Ниже проходного порога форма не пропускает.
 */

/** Поля этой формы: под них садится 400, чей суффикс `code` совпал с именем поля запроса. */
const PASSWORD_FIELDS: ReadonlySet<string> = new Set(['new_password']);

/** id поля пароля и id его строк: подпись, подсказку и сообщение рисует форма, связывать их ей же. */
const FIELD_ID = 'new-password';
const HINT_ID = `${FIELD_ID}-hint`;
const MESSAGE_ID = `${FIELD_ID}-error`;

/** Сколько держится галочка: она отвечает на нажатие, а не описывает состояние буфера. */
const COPIED_HOLD_MS = 3000;

/**
 * Оценка сгенерированного пароля: по спеке генератор всегда выдаёт значение высшего уровня, поэтому
 * шкала ставит его сама, не спрашивая оценку у сервера.
 */
const GENERATED_STRENGTH: PasswordStrength = 'THE_BEST';

export function PasswordSetupPage() {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.password.${key}`, opts ?? {});

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  /** Копирование обязано ответить: молча сработавшая кнопка неотличима от несработавшей. */
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const strength = usePasswordStrength(password);
  const start = useStartSecurityFlow();

  /**
   * Начатую генерацию отменила правка поля. Отказ от мутации ответ не отменяет — он лишь отцепляет
   * наблюдателя, а `onSuccess` отрабатывает всё равно и подставил бы сгенерированное значение
   * поверх только что набранного.
   */
  const generateStale = useRef(false);

  /** Отложенное снятие галочки. */
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Снимает галочку вместе с её таймером: иначе отложенное снятие догнало бы следующее копирование. */
  function dropCopied() {
    clearTimeout(copiedTimer.current);
    setCopied(false);
  }

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const generate = useMutation({
    mutationFn: generatePassword,
    onMutate: () => {
      generateStale.current = false;
    },
    onSuccess: (generated) => {
      if (generateStale.current) return;
      // Оценка объявляется до того, как значение попадёт в поле: иначе шкала успела бы уйти
      // спрашивать сервер про то, что и так известно.
      strength.assume(generated, GENERATED_STRENGTH);
      setPassword(generated);
      // Повтор заполняет человек — сгенерированное значение тут не отличается от придуманного.
      // Вынести пароль наружу и вернуть обратно — единственное, чем повтор здесь полезен;
      // заполненный за человека, он не проверяет ничего.
      setRepeat('');
      dropCopied();
      setCopyFailed(false);
      // Значение в поле сменилось так же, как от набора руками, — отказ сервера был про прежнее.
      start.reset();
    },
  });

  function change(next: string) {
    setPassword(next);
    dropCopied();
    setCopyFailed(false);
    // Обе прошлые неудачи были про прошлое значение: правка снимает и отказ сервера, и сорвавшуюся
    // генерацию — они про то, чего в поле уже нет. Не пришедшую генерацию правка отменяет: в поле
    // теперь набранное руками, и подставлять поверх него нечего.
    generateStale.current = true;
    generate.reset();
    start.reset();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setCopyFailed(false);
      // Галочка гаснет сама: что лежит в буфере дальше, странице не видно, и держаться ей не на чем.
      // Отсчёт начинается заново с каждого копирования.
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
    } catch {
      // Запись в буфер доступна не всегда — нужен защищённый контекст и разрешение браузера.
      // Галочка при этом снимается: удачным было прошлое копирование, а не это.
      dropCopied();
      setCopyFailed(true);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    start.mutate({ kind: 'password', start: () => startPasswordSetup({ new_password: password }) });
  }

  // Повтор молчит, пока в него не начали набирать: пустое поле это ещё не расхождение.
  const mismatch = repeat.length > 0 && repeat !== password;
  const rated = strength.state.kind === 'rated' ? strength.state.strength : null;
  const passing = rated !== null && isPassingStrength(rated);

  // 400 приходит по полю (`ValidateError/new_password`) — садится под поле пароля. 409 — не отказ
  // по значению, а состояние аккаунта: второй фактор уже стоит, и заменить его без отключения
  // нельзя, поэтому у него своя плашка с дорогой туда, где отключают.
  const parts = start.error instanceof ApiFieldError ? start.error.split(PASSWORD_FIELDS, t) : null;
  const fieldError = parts?.byField.find((f) => f.name === 'new_password')?.detail;
  const conflict = start.error instanceof ApiProblemError && start.error.status === 409;
  const formError = parts
    ? parts.global
    : start.error && !conflict
      ? apiErrorText(start.error, t)
      : undefined;
  // Сорвавшаяся помощь — копирование или генерация — говорится там же, под полем: она про это поле,
  // и обе неудачи ничего не портят, а лишь не случаются. Молчать о них нельзя: кнопка, ответившая
  // ничем, неотличима от неработающей.
  const helpFailure = copyFailed
    ? p('copyFailed')
    : generate.isError
      ? p('generateFailed')
      : undefined;

  return (
    <SecurityPage icon={<ShieldDotsIcon size={22} />} title={p('title')}>
      {conflict ? (
        <Alert severity="warning">
          {p('conflict')}{' '}
          <Link component={RouterLink} to="/settings">
            {p('conflictLink')}
          </Link>
        </Alert>
      ) : (
        <Box component="form" onSubmit={submit} noValidate>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {p('lead')}
          </Typography>

          <Box sx={uiFieldBlockSx('message')}>
            <UiTextField
              id={FIELD_ID}
              name="new_password"
              label={p('new')}
              type="password"
              // Менеджеру паролей здесь нужен именно новый пароль: подставь он действующий, и
              // человек задал бы вторым фактором то, что у него уже есть.
              autoComplete="new-password"
              placeholder={p('newPlaceholder')}
              value={password}
              onChange={change}
              maxLength={limits.password.max}
              // Своей строки у поля нет: под ним шкала, а подсказка и сообщения идут уже за ней —
              // поэтому строку MUI не резервируем, блок кончаем вплотную и связь с полем держим
              // сами. Порядок id — тот же, что на экране.
              collapseHelper
              messageBelow
              describedBy={fieldError ? `${HINT_ID} ${MESSAGE_ID}` : HINT_ID}
              error={Boolean(fieldError)}
              reveal={{
                show: t('common.field.showPassword'),
                hide: t('common.field.hidePassword'),
              }}
              // Сгенерированное значение не читают глазами, его копируют — поэтому знак копирования
              // стоит у поля постоянно, а не появляется после генерации.
              action={{
                label: p(copied ? 'copied' : 'copy'),
                // Копировать пустое поле нечего: знак гаснет вместе с призывом и нажатия не ждёт.
                disabled: !password,
                // Знак копирования зовёт нажать и берёт брендовый тон — как остальные призывы в
                // приложении; глаз рядом остаётся нейтральным, он лишь показывает набранное.
                // Галочка на его месте зелёная: она уже не зовёт, а отвечает «получилось».
                icon: copied ? (
                  <Box sx={{ color: 'success.main', display: 'flex' }}>
                    <CheckIcon size={18} />
                  </Box>
                ) : (
                  // Погашенный знак берёт цвет от кнопки: свой тон перебил бы её серый.
                  <Box sx={{ color: password ? 'primary.main' : 'inherit', display: 'flex' }}>
                    <CopyIcon size={18} />
                  </Box>
                ),
                onClick: () => void copy(),
              }}
            />
            <StrengthMeter state={strength.state} onRetry={strength.retry} />
            {/* Границы поля повторяются словами и стоят под ним постоянно: поле их применяет молча,
                обрезая лишнее, а появившаяся шкала встаёт над подсказкой, а не вместо неё.

                Справа на той же строке — генерация: она предлагает полю значение, которое разом
                удовлетворяет и границам, и оценке надёжности, поэтому и стоит рядом с ними, а не
                над полем, где ещё не с чем сравнивать. */}
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
            >
              <UiFieldMessage
                id={HINT_ID}
                text={p('lengthHint', { min: limits.password.min, max: limits.password.max })}
                align="start"
              />
              <Link
                component="button"
                type="button"
                disabled={generate.isPending}
                onClick={() => generate.mutate()}
                sx={{ flexShrink: 0, fontSize: 12, verticalAlign: 'baseline', p: 0 }}
              >
                {p('generate')}
              </Link>
            </Stack>
            <UiFieldMessage id={MESSAGE_ID} text={fieldError} tone="error" align="start" live />
            <UiFieldMessage text={helpFailure} tone="error" align="start" />
          </Box>

          {/* У повтора нет ни глаза, ни копирования: он и существует затем, чтобы поймать опечатку
              вслепую. */}
          <Box sx={uiFieldBlockSx(mismatch ? 'message' : 'quiet')}>
            <UiTextField
              name="repeat_password"
              label={p('repeat')}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={setRepeat}
              maxLength={limits.password.max}
              collapseHelper
              error={mismatch}
              helperText={mismatch ? p('mismatch') : undefined}
            />
          </Box>

          {formError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={!passing || mismatch || repeat.length === 0 || start.isPending}
            startIcon={start.isPending ? <UiBusyIcon size="large" /> : undefined}
          >
            {p('submit')}
          </Button>
          <Stack sx={{ alignItems: 'center', mt: 2 }}>
            <Link
              component={RouterLink}
              to="/settings"
              sx={{ color: 'text.secondary', fontSize: 14 }}
            >
              {p('cancel')}
            </Link>
          </Stack>
        </Box>
      )}
    </SecurityPage>
  );
}
