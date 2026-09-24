import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Link,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MONO_FONT, UiBusyIcon, UiCodeInput, UiFieldMessage, uiFieldBlockSx } from '@ui';
import { ApiFieldError, ApiProblemError, apiErrorText } from '@core/api';
import { moduleQueryKey } from '@core/module-registry';
import { limits } from '@config';
import {
  applyTotp,
  getTotpQrCode,
  getTotpSecret,
  revokeOperation,
  startTotpSetup,
} from '../api/authApi';
import { clearSecurityFlow, loadSecurityFlow } from '../lib/securityFlow';
import { isOperationGone } from '../lib/operationGone';
import { setRecoveryCodes } from '../lib/recoveryCodes';
import { useStartSecurityFlow } from '../hooks/useStartSecurityFlow';
import { SecurityPage } from '../ui/SecurityPage';
import { AlertCircleIcon, CheckIcon, CopyIcon, RefreshIcon, ShieldCheckIcon } from '../ui/icons';

/**
 * Последний шаг включения 2FA по TOTP: человек заводит генератор в приложении и доказывает это
 * кодом из него. Код с емаила к этому моменту уже принят — операцию подтвердил общий экран, а
 * применяет её `apply-totp` отсюда: он включает 2FA и единоразово отдаёт аварийные коды.
 *
 * Заготовка генератора приходит двумя представлениями одного секрета: картинкой для сканирования и
 * строкой Base32 со ссылкой `otpauth://` для ручного ввода. Спека просит показывать оба —
 * сканировать можно не всегда: аутентификатор стоит на том же устройстве, на десктопе нет камеры,
 * человек работает с экранным диктором.
 *
 * QR грузится сразу, секрет — лениво, по нажатию: строкой его заводит меньшинство, а показанный
 * секрет это ещё один путь его утечки, в том числе через плечо. Исключение одно: не пришёл QR —
 * секрет раскрывается сам, другого способа завести генератор не остаётся.
 */

/** Поля этой формы: под них садится 400, чей суффикс `code` совпал с именем поля запроса. */
const TOTP_FIELDS: ReadonlySet<string> = new Set(['totp_code']);

/** Сторона плиты заготовки вместе с полями. */
const QR_BOX = 176;

/**
 * Поля вокруг кода — его зона тишины: без неё код не читается частью сканеров. Отступ, а не рамка,
 * потому что подложка под ним обязана быть той же белой.
 */
const QR_QUIET_ZONE = 13;

/** Сколько держится галочка: она отвечает на нажатие, а не описывает состояние буфера. */
const COPIED_HOLD_MS = 3000;

/** id строки сообщения под рядом клеток: она описывает ряд целиком, а не отдельную клетку. */
const MESSAGE_ID = 'totp-code-error';

/**
 * Отказ, за которым больше нет самой операции, — а значит, нет и заготовки генератора внутри неё.
 * Кроме причин 400 сюда входит 403: спека отдаёт его на чужую операцию и на операцию не того типа,
 * то есть на то, что не лечится ни повтором, ни другим кодом. Так же разбирает эти отказы и общий
 * экран подтверждения.
 */
function operationGone(e: unknown): boolean {
  return (
    (e instanceof ApiFieldError && isOperationGone(e)) ||
    (e instanceof ApiProblemError && e.status === 403)
  );
}

export function TotpSetupPage() {
  // Снимок записи берётся один раз: успешное применение её гасит, и перечитанная пустая запись
  // увела бы экран в настройки прямо в момент перехода к только что выданным кодам.
  const [record] = useState(loadSecurityFlow);

  // Заходить сюда можно только из своего потока и только с подтверждённой операцией: заготовка
  // генератора живёт внутри неё, а токен — единственное, чем её применяют.
  if (record?.kind !== 'totp' || !record.token) return <Navigate to="/settings" replace />;

  return <TotpSetup token={record.token} />;
}

function TotpSetup({ token }: { token: string }) {
  const { t } = useTranslation();
  const p = (key: string) => t(`auth.totp.${key}`);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  /** Секрет раскрыт по нажатию. До этого он не запрашивается вовсе. */
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const qr = useQuery({
    queryKey: moduleQueryKey('auth', 'totpQr', token),
    queryFn: () => getTotpQrCode(token),
  });

  // Без картинки ручной ввод остаётся единственным путём, и прятать его за ссылкой значит оставить
  // экран без выхода. Раскрытие при этом залипает: удавшийся повтор QR не должен схлопывать секрет
  // обратно под ссылку — к этому моменту его уже переписывают в приложение.
  const secretOpen = revealed || qr.isError;
  useEffect(() => {
    if (qr.isError) setRevealed(true);
  }, [qr.isError]);

  const secret = useQuery({
    queryKey: moduleQueryKey('auth', 'totpSecret', token),
    queryFn: () => getTotpSecret(token),
    enabled: secretOpen,
  });

  /**
   * Адрес картинки живёт ровно столько, сколько сам blob: не отпустив его, вкладка держала бы
   * изображение в памяти до своего закрытия.
   */
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!qr.data) {
      setQrUrl(null);
      return;
    }
    const url = URL.createObjectURL(qr.data);
    setQrUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [qr.data]);

  // Заготовка не переживает экран: показанный секрет это ещё один путь его утечки, а кеш держал бы
  // обе записи ещё несколько минут после ухода отсюда — и после включения 2FA тоже. Убираем на
  // размонтировании: у живого экрана наблюдатели запросили бы их тут же заново.
  useEffect(
    () => () => {
      queryClient.removeQueries({ queryKey: moduleQueryKey('auth', 'totpSecret', token) });
      queryClient.removeQueries({ queryKey: moduleQueryKey('auth', 'totpQr', token) });
    },
    [queryClient, token],
  );

  const apply = useMutation({
    mutationFn: () => applyTotp({ token, totp_code: code }),
    onSuccess: ({ recovery_codes }) => {
      setRecoveryCodes(recovery_codes);
      clearSecurityFlow();
      // Сессий и токенов метод не трогает — по спеке достаточно перечитать профиль: из него берут
      // состояние 2FA и остаток аварийных кодов и карточка настроек, и полоса профиля.
      void queryClient.invalidateQueries({ queryKey: moduleQueryKey('auth', 'user') });
      navigate('/security/codes', { replace: true });
    },
  });

  /** Тупик лечится только новой операцией — её же начинают и с карточки настроек. */
  const restart = useStartSecurityFlow();

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyFailed(false);
      // Галочка гаснет сама: что лежит в буфере дальше, странице не видно, и держаться ей не на чем.
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
    } catch {
      // Запись в буфер доступна не всегда — нужен защищённый контекст и разрешение браузера.
      clearTimeout(copiedTimer.current);
      setCopied(false);
      setCopyFailed(true);
    }
  }

  async function cancel() {
    try {
      await revokeOperation({ token });
    } catch {
      /* отмена лучшего усилия */
    }
    clearSecurityFlow();
    navigate('/settings', { replace: true });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    apply.mutate();
  }

  // Вердикт был про прошлое значение: правка снимает его вместе с покраской ряда.
  function changeCode(next: string) {
    setCode(next);
    apply.reset();
  }

  // 400 приходит по полю (`TOTPCodeIsIncorrect/totp_code`) — садится под рядом клеток. Отдельно
  // стоят два тупика: операции больше нет и 409 — не отказ по значению, а состояние аккаунта, при
  // котором активный второй фактор не перезаписывается.
  //
  // Про мёртвую операцию говорит не только применение: заготовка живёт внутри неё, и запрос секрета
  // отвечает тем же отказом. Читаем именно его — у картинки стоит `responseType: 'arraybuffer'`,
  // тело её отказа не разбирается и причины не несёт; зато не пришедший QR раскрывает секрет сам,
  // так что до этого запроса дело доходит в любом случае. Иначе экран остался бы с «повторить»,
  // которое не может сработать.
  const parts = apply.error instanceof ApiFieldError ? apply.error.split(TOTP_FIELDS, t) : null;
  const fieldError = parts?.byField.find((f) => f.name === 'totp_code')?.detail;
  const gone = operationGone(apply.error) || operationGone(secret.error);
  const conflict = apply.error instanceof ApiProblemError && apply.error.status === 409;
  const formError =
    gone || conflict
      ? undefined
      : parts
        ? parts.global
        : apply.error
          ? apiErrorText(apply.error, t)
          : undefined;

  // Любой тупик гасит запись потока: уйти отсюда можно и мимо кнопки — навигацией оболочки или
  // назад, — а оставленная запись встречала бы человека на следующем заходе полной формой с
  // токеном, которым уже ничего не сделать. У 409 операция ещё жива, но применить её нечем:
  // активный второй фактор не перезаписывается, а снимают его отдельной операцией, которая эту
  // запись всё равно перепишет. Эффектом, чтобы рендер не зависел от того, сколько раз его позвали;
  // свою запись перезапуск пишет сам.
  const terminal = gone || conflict;
  useEffect(() => {
    if (terminal) clearSecurityFlow();
  }, [terminal]);

  const filled = code.length === limits.totpCode.max;

  return (
    <SecurityPage icon={<ShieldCheckIcon size={22} />} title={p('title')}>
      {conflict ? (
        <Alert severity="warning">
          {p('conflict')}{' '}
          <Link component={RouterLink} to="/settings">
            {p('conflictLink')}
          </Link>
        </Alert>
      ) : gone ? (
        <>
          {/* Заготовка генератора живёт внутри операции и умирает вместе с ней: вводить нечего,
              поле уходит, остаётся дорога назад. */}
          <Alert severity="error" sx={{ mb: 2 }}>
            {p('gone')}
          </Alert>
          {/* Сорвавшийся перезапуск — про новую операцию, а не про мёртвую: плашка выше объясняет,
              почему человек здесь оказался, и заменить её этим отказом значило бы забрать
              объяснение. */}
          {restart.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {apiErrorText(restart.error, t)}
            </Alert>
          )}
          <Button
            variant="contained"
            size="large"
            fullWidth
            disabled={restart.isPending}
            startIcon={restart.isPending ? <UiBusyIcon size="large" /> : undefined}
            onClick={() => restart.mutate({ kind: 'totp', start: startTotpSetup })}
          >
            {p('restart')}
          </Button>
        </>
      ) : (
        <Box component="form" onSubmit={submit} noValidate>
          {/* Сначала — что изменится: 2FA включает нажатие внизу, и сказать об этом нужно до него. */}
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {p('intro')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {p('lead')}
          </Typography>

          {/* Пока идёт повтор, отказ уступает место ожиданию: иначе нажатая ссылка «Повторить»
              ответила бы ничем и была бы неотличима от неработающей. */}
          <QrBlock
            url={qrUrl}
            failed={qr.isError && !qr.isFetching}
            onRetry={() => void qr.refetch()}
          />

          <SecretBlock
            open={secretOpen}
            loading={secret.isPending || secret.isFetching}
            failed={secret.isError && !secret.isFetching}
            secret={secret.data}
            copied={copied}
            copyFailed={copyFailed}
            onReveal={() => setRevealed(true)}
            onRetry={() => void secret.refetch()}
            onCopy={(value) => void copy(value)}
          />

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {p('codeLead')}
          </Typography>

          {/* Подписи у ряда нет — что вводят, сказано строкой над ним; название формата остаётся
              доступным именем группы. Фокус сюда не ставится: первое дело на экране — отсканировать
              код, а курсор, забранный полем внизу, увёл бы страницу от картинки, ради которой сюда
              и пришли. */}
          <Box sx={uiFieldBlockSx(fieldError ? 'message' : 'quiet')}>
            <UiCodeInput
              length={limits.totpCode.max}
              value={code}
              onChange={changeCode}
              name="totp_code"
              label={t('auth.field.totpCode')}
              digitLabel={(n, total) => t('common.field.digit', { n, total })}
              error={Boolean(fieldError)}
              // Код из приложения живёт полминуты, и правка набранного во время отправки означала бы
              // гонку с уже ушедшим значением.
              disabled={apply.isPending}
              describedBy={fieldError ? MESSAGE_ID : undefined}
            />
            <UiFieldMessage id={MESSAGE_ID} text={fieldError} tone="error" live />
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
            disabled={!filled || apply.isPending}
            startIcon={apply.isPending ? <UiBusyIcon size="large" /> : undefined}
          >
            {p('submit')}
          </Button>
          <Stack sx={{ alignItems: 'center', mt: 2 }}>
            <Link
              component="button"
              type="button"
              onClick={() => void cancel()}
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

/**
 * Плита заготовки: картинка, скелет на время загрузки либо причина отказа с повтором. Место она
 * занимает одно и то же — пришедший QR ничего не сдвигает, а схлопнись плита на отказе, раскрытый
 * ниже секрет читался бы как единственный задуманный путь.
 *
 * Подложка белая в обеих темах: код приходит чёрным по белому, и на тёмном фоне карточки часть
 * сканеров его не берёт.
 */
function QrBlock({
  url,
  failed,
  onRetry,
}: {
  url: string | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (failed) {
    return (
      <QrPlate
        sx={{
          flexDirection: 'column',
          gap: 0.75,
          textAlign: 'center',
          color: 'error.main',
          bgcolor: (theme) => alpha(theme.palette.error.main, 0.08),
          border: 1,
          borderColor: 'error.main',
        }}
      >
        <AlertCircleIcon size={16} />
        <Typography variant="caption">{t('auth.totp.qrFailed')}</Typography>
        <RetryLink nameKey="retryQr" onClick={onRetry} bold />
      </QrPlate>
    );
  }

  if (!url) {
    return (
      <QrPlate
        sx={{
          bgcolor: 'background.default',
          border: 1,
          borderColor: 'divider',
          animation: 'ui-pulse 1.4s ease-in-out infinite',
          '@keyframes ui-pulse': { '50%': { opacity: 0.45 } },
        }}
      />
    );
  }

  return (
    <QrPlate sx={{ bgcolor: '#ffffff' }}>
      <Box
        component="img"
        src={url}
        alt={t('auth.totp.qrAlt')}
        sx={{ width: '100%', height: '100%' }}
      />
    </QrPlate>
  );
}

/** Общая геометрия плиты: все её состояния занимают ровно одно место. */
function QrPlate({ sx, children }: { sx?: SxProps<Theme>; children?: ReactNode }) {
  return (
    <Box
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: QR_BOX,
          height: QR_BOX,
          p: `${QR_QUIET_ZONE}px`,
          mx: 'auto',
          mb: 2,
          borderRadius: 1,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}

/**
 * Секрет строкой: ссылка-раскрытие, ожидание, значение с действиями либо отказ с повтором. Отказ
 * говорится строкой на месте значения, а не плашкой над всем экраном: QR при этом жив, и основной
 * путь остаётся открытым. Повтор рядом обязателен — запрос ленивый, сам он не переспросит.
 */
function SecretBlock({
  open,
  loading,
  failed,
  secret,
  copied,
  copyFailed,
  onReveal,
  onRetry,
  onCopy,
}: {
  open: boolean;
  loading: boolean;
  failed: boolean;
  secret?: { secret: string; otpauth_uri: string };
  copied: boolean;
  copyFailed: boolean;
  onReveal: () => void;
  onRetry: () => void;
  onCopy: (value: string) => void;
}) {
  const { t } = useTranslation();
  const p = (key: string) => t(`auth.totp.${key}`);

  if (!open) {
    return (
      <Box sx={{ mb: 2 }}>
        <Link component="button" type="button" variant="body2" onClick={onReveal}>
          {p('secretReveal')}
        </Link>
      </Box>
    );
  }

  const label = (
    <Typography
      variant="caption"
      component="span"
      sx={{ display: 'block', color: 'text.secondary' }}
    >
      {p('secretLabel')}
    </Typography>
  );

  if (failed) {
    return (
      <Box sx={{ mb: 2 }}>
        {label}
        <Typography variant="caption" component="p" sx={{ color: 'error.main' }}>
          {p('secretFailed')}
        </Typography>
        <RetryLink nameKey="retrySecret" onClick={onRetry} />
      </Box>
    );
  }

  if (loading || !secret) {
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {p('secretLoading')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      {label}
      <Typography
        component="p"
        sx={{
          fontFamily: MONO_FONT,
          fontWeight: 600,
          letterSpacing: '0.06em',
          // Секрет длиннее строки не обрезается и не уезжает: его переписывают в приложение целиком.
          overflowWrap: 'anywhere',
          mb: 0.5,
        }}
      >
        {secret.secret}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Та же заготовка ссылкой: приложение добавляет генератор без ручного ввода. Единственным
            путём она быть не может — схему обслуживает не всякое устройство, и отказать браузер не
            обязан, поэтому секрет строкой стоит рядом намеренно. */}
        <Link href={secret.otpauth_uri} variant="body2">
          {p('openInApp')}
        </Link>
        {/* Копирование обязано ответить: молча сработавшая кнопка неотличима от несработавшей.
            Отвечает при этом сама кнопка — знаком и подписью, а не вставший на её место узел: тот,
            кто нажал её с клавиатуры, остался бы без кнопки и без фокуса разом. */}
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={() => onCopy(secret.secret)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            color: copied ? 'success.main' : undefined,
          }}
        >
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {p(copied ? 'copied' : 'copy')}
        </Link>
      </Stack>
      {/* Отказ буфера произносится: фокус остаётся на кнопке, и молча выросшая под ней строка
          досталась бы только тому, кто смотрит на экран. */}
      <UiFieldMessage
        text={copyFailed ? p('copyFailed') : undefined}
        tone="error"
        align="start"
        live
      />
    </Box>
  );
}

/**
 * Повтор ленивого запроса: сам он не переспросит. Подпись у всех повторов одна, а доступное имя
 * своё: отказать могут обе дороги к заготовке разом, и в списке ссылок два «Повторить» подряд
 * неразличимы.
 */
function RetryLink({
  nameKey,
  onClick,
  bold,
}: {
  nameKey: 'retryQr' | 'retrySecret';
  onClick: () => void;
  bold?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Link
      component="button"
      type="button"
      variant="body2"
      aria-label={t(`auth.totp.${nameKey}`)}
      // На плите отказа ссылка берёт цвет самой плиты: брендовый тон спорил бы с её красным.
      color={bold ? 'inherit' : undefined}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        fontWeight: bold ? 600 : undefined,
      }}
    >
      <RefreshIcon size={15} />
      {t('auth.totp.retry')}
    </Link>
  );
}
