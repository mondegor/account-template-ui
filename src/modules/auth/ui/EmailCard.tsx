import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Chip, Link, Stack, Typography } from '@mui/material';
import { UiBusyIcon } from '@ui';
import { limits } from '@config';
import { ApiFieldError, apiErrorText } from '@core/api';
import { resolveTimeZone } from '@core/i18n';
import { moduleQueryKey } from '@core/module-registry';
import { useOperationStore } from '@core/operation';
import {
  applyOperation,
  getUserInfo,
  revokeOperation,
  startEmailChange,
  startEmailChangeByRecovery,
} from '../api/authApi';
import type { PendingOperation, UserInfo } from '../api/types';
import { useStartSecurityFlow } from '../hooks/useStartSecurityFlow';
import { fmtDeadline, useLocale } from '../lib/format';
import { pendingEmailChange, pendingToWaiting } from '../lib/pendingOperation';
import { saveSecurityFlow } from '../lib/securityFlow';
import { EMAIL_ANCHOR } from './contactAnchors';
import {
  ContactAction,
  ContactCardShell,
  ContactDone,
  ContactForm,
  ContactValue,
} from './ContactCard';
import { LifeBuoyIcon, MailIcon } from './icons';

/** Поле этой формы: под него садится 400, чей суффикс `code` совпал с именем поля запроса. */
const EMAIL_FIELDS: ReadonlySet<string> = new Set(['new_email']);

/** Одинаковые адреса — без учёта регистра и пробелов по краям: так их различает и почта. */
function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Карточка емаила. Смена идёт двумя операциями: код с текущего адреса доказывает владение
 * аккаунтом, код с нового — владение адресом. Между ними человек может уйти: вторая операция живёт
 * порядка трёх суток и видна в профиле, поэтому карточка показывает её и даёт к ней вернуться.
 */
export function EmailCard({
  user,
  editing,
  anyEditing,
  onEdit,
  onClose,
  done,
}: {
  user: UserInfo;
  /** Правка открыта здесь. Держит её страница: открытой может быть только одна карточка. */
  editing: boolean;
  /**
   * Правка открыта где-то на странице — здесь или в соседней карточке. Итог, достигнутый в этой
   * карточке, гаснет от любой начатой правки, а не только от своей: страничный итог живёт по
   * тому же правилу, и разойтись им нельзя — оба говорят про одну и ту же прошлую смену.
   */
  anyEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
  /** Смена только что завершилась на экране подтверждения — сказать об этом здесь. */
  done: boolean;
}) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) =>
    t(`auth.contacts.email.${key}`, opts ?? {});
  const pending = pendingEmailChange(user);
  // Итог, достигнутый прямо в карточке: подтверждённую смену она применяет сама.
  const [finished, setFinished] = useState(false);
  // Отказ в применении держится здесь, а не в блоке ожидания: отказавшая операция уходит из профиля,
  // блок исчезает при перечитывании, а объяснить, куда делась смена, всё равно нужно.
  const [failure, setFailure] = useState<unknown>(null);

  // Начатая правка снимает и то и другое. Сравнением с прошлым значением, а не эффектом: сброс
  // попадает в тот же рендер, что и открытая правка, — как форма настроек догоняет профиль.
  const [seenEditing, setSeenEditing] = useState(anyEditing);
  if (seenEditing !== anyEditing) {
    setSeenEditing(anyEditing);
    if (anyEditing) {
      setFinished(false);
      setFailure(null);
    }
  }

  return (
    <ContactCardShell
      id={EMAIL_ANCHOR}
      icon={<MailIcon size={22} />}
      title={p('title')}
      chip={
        // Подтверждённая смена тоже ждёт — но не кода, а применения: до него адрес не сменился, и
        // операция из профиля не ушла. «Ждёт кода» звало бы там искать письмо, которого больше нет.
        pending && !editing ? (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={p(pending.status === 'CONFIRMED' ? 'pendingConfirmedChip' : 'pendingChip')}
          />
        ) : undefined
      }
    >
      {/* Итог говорит о прошлой смене и уходит, как только начата следующая. */}
      {(done || finished) && !editing && <ContactDone title={p('done')} />}
      {failure != null && !editing && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {apiErrorText(failure, t)}
        </Alert>
      )}
      {editing ? (
        <EmailForm user={user} onClose={onClose} />
      ) : (
        <>
          {/* Начатое изменение видно прямо в значении: чип и блок под ним сообщают сам факт, а
              что меняется — только эта строка. Показывается при обоих статусах операции: адрес
              аккаунта не сменился ни пока ждут код, ни пока ждут применения. */}
          <ContactValue
            value={user.email}
            sub={p('sub')}
            next={
              pending?.extra_value
                ? { value: pending.extra_value, label: p('changingTo') }
                : undefined
            }
            // Пока изменение ждёт, начать новое отсюда нельзя: его действия — подтвердить или
            // отменить — стоят в блоке под строкой, и второй, спорящий с ними вход был бы лишним.
            action={
              pending ? undefined : (
                <ContactAction label={t('auth.contacts.change')} onClick={onEdit} />
              )
            }
          />
          {pending && (
            <PendingChange
              user={user}
              op={pending}
              onFinished={() => setFinished(true)}
              onFailed={setFailure}
            />
          )}
        </>
      )}
    </ContactCardShell>
  );
}

/**
 * Правка адреса. Живёт, только пока открыта: закрытие сбрасывает набранное, и следующее открытие
 * начинается с чистого поля.
 */
function EmailForm({ user, onClose }: { user: UserInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) =>
    t(`auth.contacts.email.${key}`, opts ?? {});
  const flow = useStartSecurityFlow();
  const [value, setValue] = useState('');
  const [same, setSame] = useState(false);
  const [recovery, setRecovery] = useState(false);

  // Путь без письма есть только при включённой 2FA: без неё доказательство у аккаунта одно — код
  // на текущий адрес. Профиль мог перечитаться с выключенной 2FA (409 от сервера) — режим гаснет
  // сам, а набранное остаётся.
  const twoFa = user.auth_2fa_type !== 'NONE';
  const byRecovery = recovery && twoFa;

  const parts = flow.error instanceof ApiFieldError ? flow.error.split(EMAIL_FIELDS, t) : null;
  const fieldError = same ? p('same') : parts?.byField.find((f) => f.name === 'new_email')?.detail;
  const formError = parts ? parts.global : flow.error ? apiErrorText(flow.error, t) : undefined;

  const change = (next: string) => {
    setValue(next);
    setSame(false);
    flow.reset();
  };

  const submit = () => {
    // Операция на тот же адрес была бы пустой — ловим до запроса.
    if (sameEmail(value, user.email)) {
      setSame(true);
      return;
    }
    const req = { new_email: value.trim() };
    flow.mutate({
      kind: byRecovery ? 'email-recovery' : 'email',
      start: () => (byRecovery ? startEmailChangeByRecovery(req) : startEmailChange(req)),
      value: req.new_email,
    });
  };

  return (
    <>
      <ContactForm
        name="new_email"
        label={p('new')}
        value={value}
        onChange={change}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder={p('placeholder')}
        maxLength={limits.newEmail.max}
        hint={byRecovery ? p('recoveryHint') : p('hint', { email: user.email })}
        fieldError={fieldError}
        formError={formError}
        top={
          <>
            {byRecovery && (
              <Alert severity="info" icon={<LifeBuoyIcon size={20} />} sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {p('recoveryTitle')}
                </Typography>
                <Typography variant="body2">{p('recoveryText')}</Typography>
              </Alert>
            )}
          </>
        }
        aside={
          twoFa &&
          !flow.isPending && (
            <Link
              component="button"
              type="button"
              variant="body2"
              sx={{ fontWeight: 600 }}
              onClick={() => {
                setRecovery(!byRecovery);
                flow.reset();
              }}
            >
              {byRecovery ? p('hasAccess') : p('noAccess')}
            </Link>
          )
        }
        busy={flow.isPending}
        canSubmit={value.trim().length >= limits.newEmail.min && !fieldError}
        onCancel={onClose}
        onSubmit={submit}
      />
    </>
  );
}

/**
 * Смена, которая ждёт кода с нового адреса. Адрес аккаунта пока прежний — строка значения над
 * этим блоком его и показывает.
 *
 * «Подтвердить» открывает экран подтверждения с тем же снимком, что был бы у только что созданной
 * операции: профиль несёт у неё метод звена и счётчики. Берём профиль свежим — в кэше мог лежать
 * снимок до вчерашней попытки. Подтверждённую, но не применённую смену карточка завершает сама:
 * вводить там уже нечего.
 */
function PendingChange({
  user,
  op,
  onFinished,
  onFailed,
}: {
  user: UserInfo;
  op: PendingOperation;
  onFinished: () => void;
  /** Отказ в применении или его сброс (`null`) — показывает карточка, см. `failure` в `EmailCard`. */
  onFailed: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) =>
    t(`auth.contacts.email.${key}`, opts ?? {});
  const locale = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dispatch = useOperationStore((s) => s.dispatch);
  const userKey = moduleQueryKey('auth', 'user');
  const reread = () => queryClient.invalidateQueries({ queryKey: userKey });

  const resume = useMutation({
    mutationFn: async () => {
      const fresh = await queryClient.fetchQuery({
        queryKey: userKey,
        queryFn: getUserInfo,
        staleTime: 0,
      });
      const current = pendingEmailChange(fresh);
      // Операция успела закрыться или подтвердиться — карточка уже перерисована по свежему профилю.
      if (!current || current.status !== 'OPENED') return null;
      const parts = pendingToWaiting(current, Date.now());
      // Поля звена у OPENED есть по спеке — сюда не доходят. Отказ вместо тишины стоит ровно
      // затем, чтобы невозможное не обернулось кнопкой, молчащей на каждое нажатие.
      if (!parts) throw new Error('Pending email change has no confirmation link');
      return { parts, value: current.extra_value };
    },
    onSuccess: (resumed) => {
      if (!resumed) return;
      dispatch({ type: 'START', parts: resumed.parts, now: Date.now() });
      saveSecurityFlow({ kind: 'email-confirm-resume', value: resumed.value });
      navigate('/security/confirm');
    },
  });
  const cancel = useMutation({
    mutationFn: () => revokeOperation({ token: op.token }),
    onSettled: reread,
  });
  const finish = useMutation({
    mutationFn: () => applyOperation({ token: op.token }),
    onMutate: () => onFailed(null),
    onSuccess: onFinished,
    onError: onFailed,
    // И успех, и отказ меняют профиль: адрес сменился либо операции больше нет.
    onSettled: reread,
  });

  const busy = resume.isPending || cancel.isPending || finish.isPending;
  const error = resume.error ?? cancel.error;
  const confirmed = op.status === 'CONFIRMED';
  const until = fmtDeadline(op.expires_at, locale, resolveTimeZone(user.tz));

  return (
    <Box
      sx={{
        mt: 2,
        p: 1.5,
        pl: 1.75,
        border: 1,
        borderColor: 'divider',
        borderLeft: 3,
        borderLeftColor: 'warning.main',
        borderRadius: 1,
        bgcolor: 'background.default',
      }}
    >
      {/* Адрес идёт внутри фразы, а не своей строкой: набранный тем же кеглем, что и текст вокруг,
          он читался не значением, а очередной строкой абзаца. Перенос внутри слова остаётся за
          ним — длинный адрес иначе распёр бы блок. */}
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        {p(confirmed ? 'pendingConfirmed' : 'pending', { email: op.extra_value })}
      </Typography>
      {/* Срок у операции один, а истекает по нему в двух состояниях разное: пока код ждут —
          подтверждение, а принятому коду подтверждать нечего, и до того же часа надо успеть
          завершить смену. Один ключ на оба состояния и пришлось бы оставить безличным. */}
      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 13, mt: 0.5 }}>
        {p(confirmed ? 'pendingConfirmedWhen' : 'pendingWhen', { date: until })}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {apiErrorText(error, t)}
        </Alert>
      )}
      {/* Продолжение стоит первым: блок читают, чтобы вернуться к смене, а не чтобы бросить её.
          Узким экраном тот же порядок читается сверху вниз. */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'flex-end', mt: 1.5 }}
      >
        <Button
          variant="contained"
          disabled={busy}
          startIcon={resume.isPending || finish.isPending ? <UiBusyIcon /> : undefined}
          onClick={() => {
            if (confirmed) {
              finish.mutate();
              return;
            }
            cancel.reset();
            resume.mutate();
          }}
        >
          {p(confirmed ? 'finish' : 'confirm')}
        </Button>
        {/* Отказ обведён, как отключение защиты в соседней карточке: обе кнопки снимают то, что
            уже действует, и различать их рисунком было бы нечем. */}
        <Button
          variant="outlined"
          color="error"
          disabled={busy}
          startIcon={cancel.isPending ? <UiBusyIcon /> : undefined}
          // Нажатие стирает отказ соседнего действия: состояние мутации живёт до следующего её
          // вызова, а строка отказа тут одна на двоих — иначе сорвавшееся «Подтвердить» объясняло
          // бы неудачу отмены, нажатой после него.
          onClick={() => {
            resume.reset();
            cancel.mutate();
          }}
        >
          {p('cancelChange')}
        </Button>
      </Stack>
    </Box>
  );
}
