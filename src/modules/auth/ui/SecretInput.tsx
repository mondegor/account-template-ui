import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { UiCodeInput, UiFieldMessage, UiTextField, uiFieldBlockSx } from '@ui';
import { SECRET_FORMAT, type SecretMode } from '../lib/secretFormat';

/**
 * Поле секрета: ряд клеток либо обычное поле — смотря какой формат сейчас набирают. Каждый формат
 * показывает себя собой: код известной длины — рядом клеток, пароль — точками и глазом, аварийный
 * код — моноширинным открытым текстом.
 *
 * Что вводят, сказано сообщением над полем, поэтому название формата остаётся только доступным
 * именем.
 *
 * Строка под полем объявляется диктором: отказ приходит ответом сервера, курсор после отправки
 * остаётся здесь же, и экран не меняется ничем другим — необъявленный отказ достался бы только
 * тому, кто на него смотрит.
 *
 * Выбранный режим и значение держит экран подтверждения: ему же их отправлять и по ним включать
 * кнопку. Поле знает только, как этот режим выглядит и как в него набирают.
 */

export function SecretInput({
  mode,
  value,
  onChange,
  errorText,
  noticeText,
  autoFocus,
}: {
  /** Выбранный формат — совпадает с форматом звена, пока не переключились на аварийный код. */
  mode: SecretMode;
  value: string;
  onChange: (value: string) => void;
  /** Вердикт сервера по набранному: красит поле и раскрывается строкой под ним. */
  errorText?: string;
  /**
   * Отказ, до вердикта не дошедший, — повторить можно тем же значением. Строка встаёт там же и
   * тем же красным, а поле остаётся чистым: пометить его значило бы позвать исправлять набранное.
   */
  noticeText?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const format = SECRET_FORMAT[mode];
  const error = !!errorText;
  // Источник отказа один, так что и текст приходит один; порядок задан на случай, когда оба.
  const message = errorText ?? noticeText;
  const ownId = useId();
  const messageId = `${ownId}-message`;

  return format.kind === 'digits' ? (
    <Box sx={uiFieldBlockSx(message ? 'message' : 'quiet')}>
      <UiCodeInput
        length={format.length.max}
        value={value}
        onChange={onChange}
        label={t(format.label)}
        digitLabel={(n, total) => t('common.field.digit', { n, total })}
        error={error}
        autoFocus={autoFocus}
        name="secret"
        autoComplete={format.autoComplete}
        describedBy={message ? messageId : undefined}
      />
      <UiFieldMessage id={messageId} text={message} tone="error" live />
    </Box>
  ) : (
    <UiTextField
      // Смена формата пересоздаёт поле: фокус уходит в него сам, а показанный пароль при этом не
      // переживает переключение — иначе он остался бы открытым в поле аварийного кода.
      key={mode}
      label={t(format.label)}
      hideLabel
      name="secret"
      type={format.kind === 'password' ? 'password' : 'text'}
      mono={format.kind === 'mono'}
      reveal={
        format.kind === 'password'
          ? { show: t('common.field.showPassword'), hide: t('common.field.hidePassword') }
          : undefined
      }
      // Подсказка стоит там, где формат объявлен заранее, и показывает форму: подставь туда
      // рабочий на вид код — и его начнут набирать.
      placeholder={format.kind === 'mono' ? t('auth.field.recoveryCodeFormat') : undefined}
      value={value}
      onChange={onChange}
      collapseHelper
      error={error}
      helperText={message}
      helperTone="error"
      messageLive
      autoFocus={autoFocus}
      autoComplete={format.autoComplete}
      maxLength={format.length.max}
    />
  );
}
