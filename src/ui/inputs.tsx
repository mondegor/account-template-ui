import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Box,
  Checkbox,
  Collapse,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { MONO_FONT } from './codeInput';
import { uiFieldBlockSx } from './fieldBlock';

/**
 * Презентационные атомы полей ввода над MUI (плоские пропсы; связь с формой — в адаптерах core).
 *
 * Подпись рисуется строкой над полем, а с `hideLabel` не рисуется вовсе и остаётся только
 * доступным именем. В рамку она не уходит ни в одном из режимов: рамка всюду сплошная.
 */

/**
 * Строка сообщения под полем: ошибка, статус проверки, подтверждение. Места под себя не резервирует
 * — появляясь, раздвигает зазор до следующего блока, и делает это плавно; уходя, так же плавно его
 * сдвигает обратно. В разметке узел живёт ровно от начала раскрытия до конца схлопывания: сказать
 * нечего — под строку не занято ничего.
 *
 * Анимация здесь про изменение, а не про первый показ: строка, которая есть с первого кадра
 * (постоянная подсказка поля), рисуется сразу раскрытой. Иначе заход на страницу выглядел бы так,
 * будто форма сама собой раздвигается, — и всё, что ниже, уезжало бы у пользователя на глазах.
 *
 * Пока текст есть, узел не перемонтируется и при смене строки не переигрывает анимацию: путь
 * «проверяем → свободен» проходит на месте, одним раскрытием.
 */
export function UiFieldMessage({
  text,
  tone = 'neutral',
  align = 'center',
  id,
  live,
}: {
  text?: string;
  tone?: 'error' | 'success' | 'neutral';
  /** Выравнивание строки: по центру — под полем в узкой карточке, по началу — под подписью слева. */
  align?: 'center' | 'start';
  /** Связывает строку с полем через `aria-describedby`: своей подписи у неё нет. */
  id?: string;
  /**
   * Строку объявляет экранный диктор. Нужно там, где отказ приходит ответом сервера, а не разбором
   * набранного: курсор после отправки остаётся в поле, `aria-describedby` заново не читается, и
   * необъявленная строка досталась бы только тому, кто на неё смотрит.
   *
   * Регион при этом постоянный, а сама строка — нет: объявляется вставка текста внутрь готового
   * региона, поэтому роль живёт на обёртке, которая стоит на месте с первого кадра.
   */
  live?: boolean;
}) {
  // Текст и тон схлопывающейся строки — последние показанные: пока идёт анимация, узел ещё на
  // экране, и опустошать его нельзя — сворачивать было бы нечего, а цвет перекинулся бы на серый
  // на глазах у пользователя.
  const shown = useRef({ text, tone });
  if (text) shown.current = { text, tone };
  const color = shown.current.tone === 'neutral' ? 'text.secondary' : `${shown.current.tone}.main`;
  const line = (
    <Collapse in={Boolean(text)} unmountOnExit>
      <FormHelperText
        id={id}
        // Цвет строки задаёт её собственный тон, а не состояние поля вокруг: под полем в ошибке
        // могут стоять две строки, и красная там только та, которая эту ошибку и говорит.
        // `.Mui-error` в селекторе — чтобы перебить окраску от FormControl: она идёт по двум
        // классам и одиночному правилу sx иначе не уступит.
        sx={{ '&, &.Mui-error': { color }, textAlign: align, mx: 0, mt: 0.75, mb: 0 }}
      >
        {shown.current.text}
      </FormHelperText>
    </Collapse>
  );
  return live ? <Box role="alert">{line}</Box> : line;
}

/** Открытый глаз — «показать», перечёркнутый — «скрыть». Line-стиль, как у глифов приложения. */
function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

export interface UiTextFieldProps {
  label?: string;
  /**
   * Подписи на экране нет: `label` уходит в `aria-label`. Ставится там, где поле в форме одно и
   * соседний текст уже сказал, что вводить.
   */
  hideLabel?: boolean;
  /**
   * Строка сообщения под полем не резервируется, а раскрывается по мере надобности
   * (`UiFieldMessage`). Для форм, где поле одно: пустой зазор между полем и кнопкой там ничем не
   * занят и виден как провал.
   */
  collapseHelper?: boolean;
  /**
   * Строку под блоком рисует кто-то снаружи — так форма с одним полем показывает сообщение, которое
   * относится к ней целиком. Блок тогда кончается вплотную и отдаёт зазор наружу: иначе чужая
   * строка встала бы ниже своей — отъехав от поля и подперев то, что под ней. Своя строка это
   * перебивает: рядом с ней зазор нужен, а не отдан.
   */
  messageBelow?: boolean;
  /** Строку под полем объявляет экранный диктор — см. `UiFieldMessage.live`. */
  messageLive?: boolean;
  /**
   * id строки, которую рисует кто-то снаружи, — когда между полем и его сообщением стоит что-то
   * третье и отдать строку полю значило бы это третье отодвинуть. Строк может быть несколько: их
   * id идут через пробел в том же порядке, в каком они стоят на экране. Своя строка
   * (`collapseHelper` с текстом) старше и перебивает их целиком: она ближайшая к полю.
   */
  describedBy?: string;
  /** Свой id поля — когда подпись рисует кто-то снаружи и связывает её через `htmlFor`. */
  id?: string;
  type?: 'text' | 'email' | 'password' | 'tel';
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  error?: boolean;
  /**
   * Проверка значения прошла: рамка и подпись зелёные, обводка активна и без фокуса. Нужно там,
   * где «пусто» и «всё хорошо» — разные состояния и молчание поля читалось бы как первое.
   */
  success?: boolean;
  helperText?: string;
  /**
   * Тон строки под полем, когда он расходится с состоянием самого поля. Обычно тон следует за
   * полем, но отказ, в котором набранное не виновато (лимит, сбой сервиса, обрыв связи), говорится
   * красным при чистом поле: помеченное поле означает «исправьте здесь», а исправлять там нечего.
   */
  helperTone?: 'error' | 'success' | 'neutral';
  disabled?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  /**
   * Кнопка показа значения справа внутри поля; наличие пропа её и включает. Доступные имена обоих
   * состояний приходят снаружи — своих строк слой ui не заводит.
   *
   * Показанное значение живёт ровно столько, сколько сам компонент: состояние держится здесь, и
   * пересоздание поля (сменили формат, ушли с экрана) возвращает его к скрытому.
   */
  reveal?: { show: string; hide: string };
  /**
   * Второй знак в конце поля — действие над значением (скопировать его, например). Стоит после
   * глаза и уживается с ним: знаки в конце поля читаются слева направо, и показ значения идёт
   * первым, потому что относится к самому полю, а не к тому, что с ним делают.
   *
   * Ни знака, ни подписи слой `ui` не придумывает: и то и другое приходит пропом, а вместе с ними
   * — и состояние действия. Сменить знак на галочку после удачного копирования может только тот,
   * кто знает, удалось ли оно: запись в буфер доступна не везде и умеет отказать. Оттуда же и
   * `disabled`: делать над пустым значением обычно нечего, но что считать пустым, знает вызывающий.
   */
  action?: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean };
  /**
   * Моноширинный шрифт: нужен там, где значение читают с листа или из менеджера паролей, — на
   * пропорциональном 0/O и 1/I сближаются, и разбирать их приходится глазом.
   */
  mono?: boolean;
}

export function UiTextField({
  label,
  hideLabel,
  collapseHelper,
  messageBelow,
  messageLive,
  describedBy,
  id,
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  name,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  success,
  helperText,
  helperTone,
  disabled,
  autoFocus,
  maxLength,
  reveal,
  action,
  mono,
}: UiTextFieldProps) {
  const [shown, setShown] = useState(false);
  const ownId = useId();
  const fieldId = id ?? ownId;
  const labelShown = !!label && !hideLabel;
  // В режиме раскрытия helper рисует не MUI, поэтому и связать его с полем приходится самим.
  const messageId = collapseHelper && helperText ? `${fieldId}-message` : undefined;
  const describedById = messageId ?? describedBy;
  return (
    <Box
      sx={
        collapseHelper
          ? // Зазор отдаётся наружу только когда своей строки у блока нет: со своей блок кончается
            // ею, и вплотную к ней встала бы чужая — две строки слиплись бы в одну красную кашу.
            uiFieldBlockSx(helperText ? 'message' : messageBelow ? 'flush' : 'quiet')
          : undefined
      }
    >
      {labelShown && (
        <FormLabel htmlFor={fieldId} sx={{ display: 'block', fontSize: 13, mb: 0.5 }}>
          {label}
        </FormLabel>
      )}
      <TextField
        id={fieldId}
        type={reveal && shown ? 'text' : type}
        placeholder={placeholder}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        inputRef={inputRef}
        error={error}
        // В режиме раскрытия строку рисует UiFieldMessage под полем: отдай её MUI — и он оставит
        // под неё место навсегда.
        helperText={collapseHelper ? undefined : (helperText ?? ' ')}
        disabled={disabled}
        autoFocus={autoFocus}
        fullWidth
        size="small"
        // Зелёный цвет MUI разносит по частям поля сам, кроме подписи под ним: её он красит только
        // ошибкой, поэтому подпись догоняем вручную. `focused` — чтобы рамка была видна и тогда,
        // когда курсор уже ушёл дальше.
        color={success ? 'success' : undefined}
        focused={success || undefined}
        sx={{
          ...(success ? { '& .MuiFormHelperText-root': { color: 'success.main' } } : null),
          ...(mono ? { '& input': { fontFamily: MONO_FONT, letterSpacing: '0.04em' } } : null),
        }}
        // testid висит на самом `input`, а не на обёртке: по нему поле и читают, и заполняют.
        slotProps={{
          htmlInput: {
            autoComplete,
            inputMode,
            maxLength,
            // Подписи на экране нет — имя полю даёт она же, только невидимая.
            'aria-label': labelShown ? undefined : label,
            // Ключ появляется только вместе со строкой — своей или внешней: свою подпись MUI
            // связывает с полем этим же атрибутом, а `htmlInput` разливает поверх — пустое
            // значение стёрло бы связь, и подпись под полем осталась бы непрочитанной.
            ...(describedById ? { 'aria-describedby': describedById } : null),
            'data-testid': name ? `field-${name}` : 'ui-textfield',
          },
          input:
            reveal || action
              ? {
                  // Знаки идут одним хвостом: `edge="end"` достаётся последнему из них, иначе
                  // правое поле подобрал бы глаз, а действие за ним встало бы с отступом.
                  endAdornment: (
                    <InputAdornment position="end">
                      {reveal && (
                        <IconButton
                          // Enter в поле обязан отправлять форму, а не показывать значение.
                          type="button"
                          edge={action ? false : 'end'}
                          size="small"
                          aria-label={shown ? reveal.hide : reveal.show}
                          onClick={() => setShown((v) => !v)}
                        >
                          <EyeIcon off={shown} />
                        </IconButton>
                      )}
                      {action && (
                        <IconButton
                          type="button"
                          edge="end"
                          size="small"
                          aria-label={action.label}
                          disabled={action.disabled}
                          onClick={action.onClick}
                        >
                          {action.icon}
                        </IconButton>
                      )}
                    </InputAdornment>
                  ),
                }
              : undefined,
        }}
      />
      {collapseHelper && (
        <UiFieldMessage
          id={messageId}
          text={helperText}
          tone={helperTone ?? (error ? 'error' : success ? 'success' : 'neutral')}
          live={messageLive}
        />
      )}
    </Box>
  );
}

export interface UiSelectProps {
  label?: string;
  /** Подписи на экране нет: `label` уходит в `aria-label`. См. `UiTextFieldProps.hideLabel`. */
  hideLabel?: boolean;
  name?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
}

export function UiSelect({
  label,
  hideLabel,
  name,
  value,
  options,
  onChange,
  onBlur,
  error,
  helperText,
  disabled,
}: UiSelectProps) {
  const ownId = useId();
  const labelShown = !!label && !hideLabel;
  const labelId = labelShown ? (name ? `${name}-label` : ownId) : undefined;
  const messageId = helperText ? `${name ?? ownId}-message` : undefined;
  return (
    <FormControl fullWidth size="small" error={error} disabled={disabled}>
      {/* `FormLabel` идёт в потоке; `InputLabel` MUI кладёт поверх рамки и вырезает под него
          место в ней. */}
      {labelShown && (
        <FormLabel id={labelId} sx={{ fontSize: 13, mb: 0.5 }}>
          {label}
        </FormLabel>
      )}
      <Select
        labelId={labelId}
        aria-label={labelShown ? undefined : label}
        aria-describedby={messageId}
        name={name}
        value={value}
        onChange={(e) => onChange(String(e.target.value))}
        onBlur={onBlur}
        data-testid={name ? `field-${name}` : 'ui-select'}
      >
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
      {/* Строка сообщения — своя, а не `helperText` от MUI: тот оставил бы под неё место навсегда.
          Зазор до следующего блока держит раскладка (`UiSection`, `UiGrid`) — своего отступа у
          селекта нет, иначе он складывался бы с ней. Подпись слева, по ней строка и равняется. */}
      <UiFieldMessage
        id={messageId}
        text={helperText}
        tone={error ? 'error' : 'neutral'}
        align="start"
      />
    </FormControl>
  );
}

export interface UiCheckboxProps {
  label?: string;
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
}

export function UiCheckbox({
  label,
  name,
  checked,
  onChange,
  onBlur,
  error,
  helperText,
  disabled,
}: UiCheckboxProps) {
  return (
    <FormControl error={error} disabled={disabled}>
      <FormControlLabel
        control={
          <Checkbox
            name={name}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            onBlur={onBlur}
            data-testid={name ? `field-${name}` : 'ui-checkbox'}
          />
        }
        label={label ?? ''}
      />
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}
