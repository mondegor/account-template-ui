import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { UiCodeInput, UiFieldMessage, UiTextField, uiFieldBlockSx } from '@ui';
import { SECRET_FORMAT, hasNonAscii, secretValue, type SecretMode } from '../lib/secretFormat';

/**
 * Поле секрета: ряд клеток либо обычное поле — смотря какой формат сейчас набирают. Каждый формат
 * показывает себя собой: код известной длины — рядом клеток, пароль — точками и глазом, аварийный
 * код — моноширинным открытым текстом.
 *
 * Что вводят, сказано сообщением над полем, поэтому название формата остаётся только доступным
 * именем.
 *
 * Символ вне ASCII в пароле или аварийном коде поле называет само, пока набирают: почти всегда это
 * не та раскладка, а узнать об этом из отказа сервера — значит сжечь попытку. Отказ сервера старше
 * подсказки: он про отправленное значение.
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
  // Меряется то, что уйдёт на сервер, — как и у кнопки: неразрывный пробел по краю вставки
  // обрезка снимает, и звать из-за него раскладку значило бы спорить с активной кнопкой.
  const wrongLayout = format.kind !== 'digits' && hasNonAscii(secretValue(mode, value));
  const error = !!errorText || wrongLayout;
  // Источник отказа один, так что и текст приходит один; порядок задан на случай, когда оба.
  // Раскладка идёт раньше notice: поле она красит, и строка под ним обязана назвать причину, а
  // notice про прошлую попытку, тогда как раскладка — про набранное сейчас.
  const message =
    errorText ?? (wrongLayout ? t('auth.field.wrongLayout') : undefined) ?? noticeText;
  const ownId = useId();
  const messageId = `${ownId}-message`;
  const fieldRef = useRef<HTMLInputElement>(null);

  // Регистр поднимается в самом поле — и при наборе, и при вставке: оба приходят сюда целым
  // значением. Новое значение кладётся в узел заранее, вместе с прежней кареткой: тогда React
  // находит там уже то, что рисует, и не переписывает узел, а курсор не уезжает в конец строки.
  // Длина при смене регистра не меняется, поэтому старая позиция годится как есть.
  function change(next: string) {
    const el = fieldRef.current;
    if (!format.upperCase || !el) {
      onChange(next);
      return;
    }
    const upper = next.toUpperCase();
    if (upper !== next) {
      const { selectionStart, selectionEnd } = el;
      el.value = upper;
      el.setSelectionRange(selectionStart, selectionEnd);
    }
    onChange(upper);
  }

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
      onChange={change}
      inputRef={fieldRef}
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
