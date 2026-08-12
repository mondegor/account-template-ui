import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Link, Stack, TextField, Typography } from '@mui/material';
import { limits } from '@config';
import { UiAlert, UiButton } from '@ui';
import type { ConfirmFlow } from '../hooks/useConfirmFlow';

/**
 * Экран подтверждения операции — презентационная часть, общая для всех потоков: читает
 * confirm_method, рисует ввод, счётчики attempts/resends/expires и кнопки повтора, отмены и
 * «запросить новый код». Терминальное действие и навигацию сюда не пускаем: их задаёт вызывающий,
 * когда зовёт useConfirmFlow, — поэтому один и тот же экран обслуживает и вход, и security-потоки.
 */

interface OperationConfirmProps {
  flow: ConfirmFlow;
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
 * Поле ввода на всех звеньях одно, а спрашивают они разное: пароль и аварийный код не цифровые, и
 * подпись «Код подтверждения» над полем пароля просто неверна. Звено с кодом из сообщения идёт по
 * умолчанию — оно и правда код из цифр.
 *
 * Пароль вдобавок скрыт точками: он живёт дольше одной операции, и подсматривание через плечо или
 * демонстрацию экрана переживёт только он. Одноразовому коду и аварийному коду скрывать нечего.
 *
 * Цифровое тут одно-единственное звено — с кодом из сообщения. Звено второго фактора цифровым не
 * назвать даже там, где спрашивает код из 2FA-приложения: спека разрешает ввести вместо него
 * аварийный код, и фильтр с короткой длиной закрыли бы этот путь совсем.
 */
interface SecretField {
  label: string;
  /** Цифровое звено: нецифры отбрасываются при вводе, длина ограничена продуктовым пределом. */
  numeric: boolean;
  type?: 'password';
  /**
   * Обрезать ли пробелы по краям перед отправкой. Обрезают все звенья, кроме парольного: в их
   * форматы пробел не входит, а приезжает вставкой из буфера — из списка аварийных кодов или из
   * сообщения. Уйди такой край на сервер, тот ответил бы «неверный код» и списал попытку за то,
   * чего человек не набирал.
   *
   * У пароля же ограничений на символы нет вовсе, и краевой пробел в нём — часть секрета: обрежь
   * его, и попытки сгорели бы на значении, которого никто не вводил.
   */
  trim: boolean;
  /**
   * Нижняя граница включает кнопку: заведомо короткое значение сервер всё равно отклонит, а попытка
   * на звене сгорит — их всего три. Своя она только у цифрового звена, где формат известен точно;
   * остальные обслуживают несколько форматов разом и меряются контрактной.
   */
  length: { min: number; max: number };
}

const SECRET_FIELD: Record<string, SecretField> = {
  PASSWORD: {
    label: 'auth.field.password',
    numeric: false,
    type: 'password',
    trim: false,
    // Границами пароля это звено не меряется: вместо пароля спека разрешает ввести аварийный код,
    // формата которого контракт не объявляет вовсе, — ровно та же причина, что и у TOTP. Меряй
    // звено паролем, и код короче парольного минимума не дошёл бы до сервера ни при каком вводе.
    length: limits.secret,
  },
  RECOVERY: {
    label: 'auth.field.recoveryCode',
    numeric: false,
    trim: true,
    length: limits.secret,
  },
  TOTP: {
    label: 'auth.field.code',
    numeric: false,
    trim: true,
    length: limits.secret,
  },
};
const DEFAULT_SECRET_FIELD: SecretField = {
  label: 'auth.field.code',
  numeric: true,
  trim: true,
  length: limits.confirmCode,
};

export function OperationConfirm({
  flow,
  hintPrefix = HINT_PREFIX,
  deadEndText,
  awaitingFinishText,
  invalidatedText,
}: OperationConfirmProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');

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
  const secretField = SECRET_FIELD[snapshot.confirmMethod] ?? DEFAULT_SECRET_FIELD;
  // Что уйдёт на сервер — по нему же и меряется нижняя граница: иначе пробелы по краям включали бы
  // кнопку, а до сервера доезжало бы значение короче минимума, и попытка сгорала бы впустую.
  const secretValue = secretField.trim ? code.trim() : code;
  // Подсказка потока необязательна: нет ключа под его префиксом — падаем на подсказку экрана
  // подтверждения по тому же методу, иначе на экран уехал бы сам ключ.
  const hint = awaitingFinish
    ? (awaitingFinishText ?? t('auth.confirm.awaitingFinish'))
    : t(`${hintPrefix}.${snapshot.confirmMethod}`, {
        defaultValue: t(`${HINT_PREFIX}.${snapshot.confirmMethod}`),
      });

  // У цифрового звена всё, кроме цифр, — заведомо не то: пробелы от вставки из буфера, буквы от
  // промаха по раскладке. Отбрасываем их прямо при вводе, иначе сервер ответит «неверный код» и
  // спишет попытку за то, чего человек не набирал. Пароль и аварийный код фильтровать нельзя: их
  // алфавит цифрами не ограничен — что там делать с краями от вставки, решает уже отправка.
  //
  // Здесь же держится и продуктовая длина: браузер применяет maxLength к вставке ДО фильтра, и код,
  // скопированный с пробелом или группами, обрезался бы по мусорным символам — «18 39 47» стало бы
  // «1839». Само поле ограничено контрактной длиной, а лишнее срезается уже после фильтра.
  //
  // Набор в заполненный код при этом отклоняется целиком, а не вытесняет крайнюю цифру: иначе ввод
  // в середину полного кода молча терял бы последнюю, и человек отправлял бы не то, что видит.
  // Вставки это не касается — ей срез и нужен. Отличаем по длине: поле управляемое, до изменения
  // в нём ровно `code`, и набор одного символа удлиняет сырое значение ровно на единицу.
  function onChange(value: string) {
    if (!secretField.numeric) {
      setCode(value);
      return;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length > secretField.length.max && value.length === code.length + 1) return;
    setCode(digits.slice(0, secretField.length.max));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await flow.confirm(secretValue);
    setCode('');
  }

  return (
    <Box>
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
      {exhausted ? (
        <UiAlert severity="error">{exhaustedAlert}</UiAlert>
      ) : flow.error ? (
        <UiAlert severity="error">{flow.error}</UiAlert>
      ) : lastResendUsed ? (
        <UiAlert severity="warning">{t('auth.confirm.lastResend')}</UiAlert>
      ) : null}
      <Box component="form" onSubmit={onSubmit} noValidate>
        {!exhausted && !awaitingFinish && (
          <TextField
            label={t(secretField.label)}
            type={secretField.type}
            value={code}
            onChange={(e) => onChange(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            slotProps={{
              htmlInput: {
                inputMode: secretField.numeric ? 'numeric' : 'text',
                // Автозаполнение не предлагается ни на одном звене, включая парольное: спека
                // разрешает ввести вместо пароля аварийный код, и менеджер паролей предложил бы
                // заменить сохранённый пароль погашенным одноразовым кодом.
                autoComplete: 'off',
                minLength: secretField.length.min,
                maxLength: limits.secret.max,
              },
            }}
          />
        )}
        {!exhausted && (
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              mt: 1,
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
              flow.submitting || (!awaitingFinish && secretValue.length < secretField.length.min)
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
