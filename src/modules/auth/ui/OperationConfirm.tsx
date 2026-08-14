import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Link, Stack, Typography } from '@mui/material';
import { UiAlert, UiButton, UiSmoothHeight } from '@ui';
import type { ConfirmFlow } from '../hooks/useConfirmFlow';
import {
  isSwapMode,
  SECRET_FORMAT,
  secretValue,
  type SecretMode,
  type SwapMode,
} from '../lib/secretFormat';
import { AuthenticatorIcon, KeyIcon, LifeBuoyIcon } from './icons';
import { SecretInput } from './SecretInput';
import { SecretModeSwitch, type SecretModeOption } from './SecretModeSwitch';

/**
 * Экран подтверждения операции — презентационная часть, общая для всех потоков: читает
 * confirm_method, рисует ввод, счётчики attempts/resends/expires и кнопки повтора, отмены и
 * «запросить новый код». Терминальное действие и навигацию сюда не пускаем: их задаёт вызывающий,
 * когда зовёт useConfirmFlow, — поэтому один и тот же экран обслуживает и вход, и security-потоки.
 */

interface OperationConfirmProps {
  flow: ConfirmFlow;
  /**
   * Заголовок экрана — он же левая половина строки, в правой которой стоит переключатель формата.
   * Рисуется здесь, а не схемой страницы: разделить строку надвое может только тот, кто знает про
   * переключатель. Значение по умолчанию — заголовок подтверждения; security-потоки, которым эта
   * же форма служит под своим поводом, называют себя сами.
   */
  title?: string;
  /**
   * Префикс ключа подсказки над полем: к нему добавляется метод подтверждения текущего звена.
   * Один и тот же метод в разных потоках объясняется по-разному — пароль на входе и пароль при
   * отключении второго фактора спрашивают об одном, но по разному поводу. Ключа под своим
   * префиксом может не оказаться — тогда берётся подсказка экрана подтверждения: она про тот же
   * метод и объясняет, что вводить, пусть и без повода потока.
   */
  hintPrefix?: string;
  /**
   * Текст тупика «дальше эту операцию не завершить»: попытки кончились либо истёк срок, а нового
   * кода не будет. Заменяет собой весь разбор причин, поэтому задавать его стоит там, где «начните
   * вход заново» из общих текстов уводит не туда. Не путать с тупиком фазы `dead` — там причину
   * называет сервер.
   */
  deadEndText?: string;
  /** Текст «код принят, сорвался терминал»: шаг у каждого потока свой, как и finishErrorKey. */
  awaitingFinishText?: string;
  /** Запасной текст аннулированной операции — на случай, когда причины от сервера нет. */
  invalidatedText?: string;
  /**
   * Аварийный код принимается вместо второго фактора — тогда у поля появляется переключатель
   * формата. Спека разрешает такую подмену обычному входу и отключению 2FA и не разрешает
   * остальным операциям; в цепочках `.../recovery` аварийный код идёт отдельным звеном, и
   * предъявить его раньше последнего звена негде. Различить это по снимку операции нельзя —
   * звенья приходят по одному и о своём происхождении не рассказывают, — поэтому признак ставит
   * вызывающий, который знает, какую операцию он начал.
   */
  allowRecoverySwap?: boolean;
}

/**
 * Нулём минуты дополняются только там, где отсчёт переваливает за десять минут, — у срока жизни
 * операции: иначе на переходе через десять ширина числа меняется и подпись дёргается. Отсчёты
 * повторной отправки минуты не достигают вовсе, и ведущий ноль был бы у них просто шумом.
 */
function mmss(total: number, padMinutes = false): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  const mm = padMinutes ? String(m).padStart(2, '0') : String(m);
  return `${mm}:${String(s).padStart(2, '0')}`;
}

const HINT_PREFIX = 'auth.confirm.hint';

/**
 * Формат, которого звено просит само. Код из сообщения идёт по умолчанию: телефонное звено от
 * почтового отличается только тем, куда код отправлен.
 *
 * Формат звена и формат поля — разные вещи: на звене второго фактора спека разрешает предъявить
 * вместо пароля или кода из приложения аварийный код, и что именно набирают сейчас, говорит
 * выбранный режим, а не звено.
 */
const LINK_MODE: Record<string, SecretMode> = {
  PASSWORD: 'PASSWORD',
  TOTP: 'TOTP',
  RECOVERY: 'RECOVERY',
};

const SWAP_ICON: Record<SwapMode | 'RECOVERY', (props: { size?: number }) => ReactElement> = {
  PASSWORD: KeyIcon,
  TOTP: AuthenticatorIcon,
  RECOVERY: LifeBuoyIcon,
};

export function OperationConfirm({
  flow,
  title,
  hintPrefix = HINT_PREFIX,
  deadEndText,
  awaitingFinishText,
  invalidatedText,
  allowRecoverySwap,
}: OperationConfirmProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const linkMode: SecretMode = flow.snapshot
    ? (LINK_MODE[flow.snapshot.confirmMethod] ?? 'CODE')
    : 'CODE';
  const [mode, setMode] = useState<SecretMode>(linkMode);
  const [shownLink, setShownLink] = useState(linkMode);

  // Смена звена начинает всё заново: у нового звена свой формат, а набранное в прошлом ему заведомо
  // не подходит.
  if (shownLink !== linkMode) {
    setShownLink(linkMode);
    setMode(linkMode);
    setCode('');
  }

  if (!flow.snapshot) return null;

  const { snapshot, expiresLeft, resendLeft, isResendApplicable } = flow;
  // Операцию завершить нельзя ничем — ни вводом кода, ни новым кодом, ни ожиданием: сервер снял
  // условие её создания (409), отказал в самом действии (403), не принял её токен (400 по
  // OperationInvalid/OperationAlreadyExpired/OperationIsNotConfirmed) либо истёк срок уже
  // подтверждённой (см. ниже). Дальше она ведёт себя как тупик, поэтому попадает в exhausted.
  const dead = snapshot.phase === 'dead';
  const exhausted = dead || snapshot.phase === 'exhausted' || snapshot.phase === 'expired';
  // Код уже принят, сорвалось только терминальное действие: вводить нечего и подтверждать нечего —
  // экран сводится к «Повторить» и таймеру остатка жизни операции.
  const awaitingFinish = flow.awaitingFinish && !exhausted;
  const resendsLeft = snapshot.remainingResends;
  const resendReady =
    isResendApplicable &&
    (resendsLeft ?? 0) > 0 &&
    resendLeft === 0 &&
    !flow.submitting &&
    !flow.resending;
  const canRequestNewCode = isResendApplicable && (resendsLeft ?? 0) > 0;
  // У аннулированной операции запрашивать новый код тоже не у чего — тупик независимо от остатка.
  const deadEnd = dead || (exhausted && !canRequestNewCode);
  // Отсчёт идёт по сроку жизни операции, но подписан он тем, что на этом звене истекает. Кодом его
  // называть можно, только когда код действительно есть: пароль не «истекает», у аварийного кода
  // срока нет вовсе, а код из 2FA-приложения живёт своей минутой и к этому таймеру отношения не
  // имеет. Код, о котором тут уместно говорить, — только присланный сообщением.
  //
  // Ожидание терминала — случай третий, и подписан он своим: секрет уже принят, вводить нечего, и
  // остаток времени значит здесь одно — сколько ещё можно повторять само действие. «Повторить» —
  // единственная кнопка на экране, и таймер обязан говорить про неё.
  const timerKey = awaitingFinish
    ? { left: 'auth.confirm.finishExpiresIn', out: 'auth.confirm.finishExpired' }
    : isResendApplicable
      ? { left: 'auth.confirm.expiresIn', out: 'auth.confirm.expired' }
      : { left: 'auth.confirm.expiresInNoCode', out: 'auth.confirm.expiredNoCode' };
  // Тупик приходит по двум разным причинам, и назвать надо ту, что случилась: попытки ввода
  // кончились либо истёк срок операции. Ко второй причине попытки отношения не имеют — их может
  // оставаться сколько угодно. Поверх этого выбор текста учитывает, есть ли на звене повторная
  // отправка: у второго фактора и аварийного кода её нет вовсе, и упоминание отправок звало бы в
  // кнопку, которой здесь не бывает.
  const deadEndKey =
    snapshot.phase === 'expired'
      ? isResendApplicable
        ? 'auth.confirm.deadEndExpired'
        : 'auth.confirm.deadEndExpiredNoResend'
      : isResendApplicable
        ? 'auth.confirm.deadEnd'
        : 'auth.confirm.deadEndNoResend';
  // У аннулированной операции причину знает только сервер («2FA была отключена», «доступ к контуру
  // отозван»), и общий текст её не заменяет: без неё пользователю не отличить свою ошибку от
  // изменившихся обстоятельств. Запасной вариант нужен для истечения ПОДТВЕРЖДЁННОЙ операции —
  // туда приводит локальный TICK, и отказа сервера там не было вовсе.
  const exhaustedAlert = dead
    ? (flow.error ?? invalidatedText ?? t('auth.confirm.invalidated'))
    : deadEnd
      ? (deadEndText ?? t(deadEndKey))
      : snapshot.phase === 'expired'
        ? t('auth.confirm.exhaustedExpired')
        : t('auth.confirm.exhaustedAttempts');
  const lastResendUsed = !exhausted && !awaitingFinish && isResendApplicable && resendsLeft === 0;
  // Что уйдёт на сервер — по нему же и меряется нижняя граница: иначе пробелы по краям включали бы
  // кнопку, а до сервера доезжало бы значение короче минимума, и попытка сгорала бы впустую.
  const secret = secretValue(mode, code);
  // Переключатель есть, только пока есть что переключать: подмена разрешена, звено её допускает, и
  // поле на экране вообще присутствует — в тупике и в ожидании терминала вводить нечего.
  const swapFrom =
    allowRecoverySwap && !exhausted && !awaitingFinish && isSwapMode(linkMode) ? linkMode : null;
  const options: Array<SecretModeOption<SecretMode>> = swapFrom
    ? [
        {
          mode: swapFrom,
          label: t(`auth.confirm.mode.${swapFrom}`),
          Icon: SWAP_ICON[swapFrom],
        },
        {
          mode: 'RECOVERY',
          label: t('auth.confirm.mode.RECOVERY'),
          Icon: SWAP_ICON.RECOVERY,
        },
      ]
    : [];
  // Сообщение — единственное место, где формат назван словом, поэтому говорит оно про формат
  // выбранный, а не про формат звена. Пока не переключились, это одно и то же, но спрашивает
  // сообщение именно звено: почтовое от телефонного отличается только тем, куда ушёл код, и
  // выбранный режим у обоих один — «код из сообщения».
  const hintMethod = mode === linkMode ? snapshot.confirmMethod : mode;
  // Подсказка потока необязательна: нет ключа под его префиксом — падаем на подсказку экрана
  // подтверждения по тому же методу, иначе на экран уехал бы сам ключ.
  const hint = awaitingFinish
    ? (awaitingFinishText ?? t('auth.confirm.awaitingFinish'))
    : t(`${hintPrefix}.${hintMethod}`, {
        defaultValue: t(`${HINT_PREFIX}.${hintMethod}`),
      });

  // Переключение формата чистит поле: форматы несовместимы, набранное в одном другому заведомо не
  // подойдёт, а хвост пароля, оставшийся в поле аварийного кода, был бы показан открытым текстом.
  // Попытка при этом не тратится — счётчик про отправки на сервер, а переключение до него не
  // доходит.
  function onModeChange(next: SecretMode) {
    // Знаки стоят парой, и по ним же читают, какой формат набирают сейчас: клик по выбранному —
    // не переключение, и набранного он не касается.
    if (next === mode) return;
    setMode(next);
    setCode('');
    flow.clearError();
  }

  // Вердикт был про прошлое значение: правка снимает его вместе с красной рамкой. Остальное правка
  // не лечит и не убирает — ни сорвавшуюся отправку нового кода, ни отказ без вердикта: связь от
  // набора цифр не появится, и убрать эту строку значило бы забрать единственное объяснение.
  function onCodeChange(next: string) {
    setCode(next);
    if (flow.errorFrom === 'confirm') flow.clearError();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await flow.confirm(secret);
    setCode('');
  }

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1.5, minHeight: 28 }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {title ?? t('auth.confirm.title')}
        </Typography>
        {options.length > 0 && (
          <SecretModeSwitch options={options} value={mode} onChange={onModeChange} />
        )}
      </Stack>
      {/* Сообщения разных форматов разной высоты — у пароля строка, у аварийного кода две.
          Переключение меняет высоту плавно, иначе поле и кнопка под ним скачут. */}
      <UiSmoothHeight>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            mt: 0.5,
            mb: 2,
          }}
        >
          {hint}
        </Typography>
      </UiSmoothHeight>
      {/* Место отказа решает, есть ли что делать с ним у поля. Под полем — то, что повторяют тем же
          набором: и вердикт по нему, и лимит с обрывом связи. Наверху остаётся то, к чему поля нет:
          тупик, предупреждение об отправках, срыв терминала (вводить уже нечего, и ошибка говорит
          про само действие) и сорвавшаяся повторная отправка — она про кнопку, а не про набранные
          цифры. Покраску поля решает второй вопрос, не этот: краснит его только вердикт. */}
      {exhausted ? (
        <UiAlert severity="error">{exhaustedAlert}</UiAlert>
      ) : flow.error && (awaitingFinish || flow.errorFrom === 'resend') ? (
        <UiAlert severity="error">{flow.error}</UiAlert>
      ) : lastResendUsed ? (
        <UiAlert severity="warning">{t('auth.confirm.lastResend')}</UiAlert>
      ) : null}
      <Box component="form" onSubmit={onSubmit} noValidate>
        {!exhausted && !awaitingFinish && (
          <SecretInput
            mode={mode}
            value={code}
            onChange={onCodeChange}
            errorText={flow.errorFrom === 'confirm' ? (flow.error ?? undefined) : undefined}
            noticeText={flow.errorFrom === 'notice' ? (flow.error ?? undefined) : undefined}
            autoFocus
          />
        )}
        {!exhausted && (
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              // Отступ сверху держит блок поля — он же его сокращает, когда показана ошибка.
              mb: 1.5,
              fontSize: 12,
              minHeight: 20,
            }}
          >
            {/* Попытки ввода к повтору терминала не относятся: код уже принят. */}
            {!awaitingFinish && (
              <Typography
                variant="caption"
                sx={{ color: snapshot.remainingAttempts <= 1 ? 'error.main' : 'text.secondary' }}
              >
                {t('auth.confirm.attemptsLeft', { n: snapshot.remainingAttempts })}
              </Typography>
            )}
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                ml: 'auto',
              }}
            >
              {expiresLeft > 0
                ? t(timerKey.left, { time: mmss(expiresLeft, true) })
                : t(timerKey.out)}
            </Typography>
          </Stack>
        )}

        {exhausted ? (
          deadEnd ? null : (
            <UiButton
              label={
                resendLeft > 0
                  ? t('auth.confirm.requestNewCodeTimer', { time: mmss(resendLeft) })
                  : t('auth.confirm.requestNewCode')
              }
              disabled={!resendReady}
              onClick={() => void flow.resend()}
            />
          )
        ) : (
          <UiButton
            type="submit"
            label={t(awaitingFinish ? 'auth.confirm.retryFinish' : 'auth.confirm.submit')}
            disabled={
              flow.submitting || (!awaitingFinish && secret.length < SECRET_FORMAT[mode].length.min)
            }
          />
        )}
      </Box>
      <Stack
        direction="row"
        spacing={3}
        sx={{
          justifyContent: 'center',
          alignItems: 'center',
          mt: 2,
          minHeight: 24,
        }}
      >
        {/* Повторная отправка кода подтверждённой операции бессмысленна — только «Отменить». */}
        {canRequestNewCode &&
          !exhausted &&
          !awaitingFinish &&
          (resendReady ? (
            <Link
              component="button"
              type="button"
              onClick={() => void flow.resend()}
              sx={{ verticalAlign: 'baseline', fontSize: 14, lineHeight: 'inherit', p: 0 }}
            >
              {t('auth.confirm.resendLink')}
            </Link>
          ) : (
            <Typography
              variant="body2"
              sx={{
                color: 'text.disabled',
              }}
            >
              {resendLeft > 0
                ? t('auth.confirm.resendTimer', { time: mmss(resendLeft) })
                : t('auth.confirm.resendLink')}
            </Typography>
          ))}
        <Link
          component="button"
          type="button"
          onClick={() => void flow.revoke()}
          sx={{
            color: 'text.secondary',
            verticalAlign: 'baseline',
            fontSize: 14,
            lineHeight: 'inherit',
            p: 0,
          }}
        >
          {t('auth.confirm.revoke')}
        </Link>
      </Stack>
    </Box>
  );
}
