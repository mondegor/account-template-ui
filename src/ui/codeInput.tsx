import {
  Fragment,
  useEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { Box } from '@mui/material';

/**
 * Ряд клеток под код известной длины: сколько клеток, столько цифр — поле показывает формат собой,
 * а не подписью, и вопрос «сколько ещё набирать» не возникает вовсе.
 *
 * Наружу ряд отдаёт СТРОКУ и для формы, и для теста остаётся одним полем: шесть значений наружу
 * превратили бы каждого потребителя в сборщика кода. Внутри — обычные `input`, по одному на клетку,
 * поэтому мобильная клавиатура, автоподстановка кода из сообщения и обход табом работают сами.
 *
 * Дырок в значении не бывает: строка компактна, и клетка `i` показывает её `i`-й символ. Поэтому
 * фокус в клетку правее набранного не пускается — он съезжает на первую пустую, иначе цифра
 * оказалась бы записана в дырку, а строка наружу сложилась бы не из тех позиций.
 */

/** Моноширинный стек: цифры одинаковой ширины не дают ряду дёргаться при наборе. */
export const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

export interface UiCodeInputProps {
  /** Число клеток; оно же максимальная длина значения. */
  length: number;
  value: string;
  onChange: (value: string) => void;
  /** Зазор после каждых N клеток: тройку глаз читает целиком, шесть подряд пересчитывает. */
  groupSize?: number;
  /** id внешней подписи ряда — она даёт группе доступное имя. */
  labelId?: string;
  /** Имя ряда, когда видимой подписи нет вовсе: тогда его берёт на себя `aria-label`. */
  label?: string;
  /** id строки сообщения под рядом — она описывает ряд целиком, а не отдельную клетку. */
  describedBy?: string;
  /** Доступное имя клетки; текст приходит снаружи — своих строк слой ui не заводит. */
  digitLabel: (n: number, total: number) => string;
  /** Красит ВЕСЬ ряд: сервер отвечает про код целиком и не говорит, какая цифра не та. */
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  /** Ставится только на первую клетку, иначе автоподстановка кода из SMS сработает N раз. */
  autoComplete?: string;
}

const CELL_HEIGHT = 44;

export function UiCodeInput({
  length,
  value,
  onChange,
  groupSize = 3,
  labelId,
  label,
  describedBy,
  digitLabel,
  error,
  disabled,
  autoFocus,
  name,
  autoComplete,
}: UiCodeInputProps) {
  const cells = useRef<Array<HTMLInputElement | null>>([]);
  /**
   * Фокус переставлен самим рядом, а не человеком. Значение при этом ещё старое — новое доедет
   * только следующим рендером, — и проверка «не пустил в клетку правее набранного» отбросила бы
   * курсор назад ровно на той цифре, которая его туда и продвинула.
   */
  const moving = useRef(false);
  const testId = name ? `field-${name}` : 'ui-code-input';
  /**
   * Единственная клетка ряда, стоящая в табуляции, — первая пустая: та же, куда ведёт страж
   * `onFocus` и упирается шаг вправо. Наружу ряд — одно поле, и место в порядке обхода у него одно;
   * будь табулируемой каждая клетка, Tab из ряда упирался бы в стража и наружу не выходил бы, пока
   * код не набран целиком. Ход между клетками делают стрелки и Home/End.
   */
  const caret = Math.min(value.length, length - 1);

  function focusCell(index: number) {
    moving.current = true;
    cells.current[Math.min(Math.max(index, 0), length - 1)]?.focus();
    moving.current = false;
  }

  /**
   * Значение умеет меняться и снаружи: экран чистит ряд, получив отказ по набранному. События
   * фокуса при этом нет — курсор остаётся в клетке правее нового значения, и страж `onFocus` его
   * не проверит. Без этого набранная там цифра встала бы в другую позицию, а курсор так и стоял бы
   * в конце ряда, пока код набирается с начала.
   *
   * Курсор двигается, только если он и правда в ряду: чужой фокус ряд себе не забирает.
   */
  useEffect(() => {
    const active = cells.current.indexOf(document.activeElement as HTMLInputElement);
    if (active > value.length) focusCell(value.length);
  });

  /** Раскладка вставки: мусор отброшен ДО раскладки, поэтому «18 39 47» и «183-947» дают 183947. */
  function paste(from: number, digits: string) {
    const next = (value.slice(0, from) + digits).slice(0, length);
    onChange(next);
    focusCell(next.length);
  }

  function onCellChange(index: number, e: ChangeEvent<HTMLInputElement>) {
    const current = value[index] ?? '';
    const raw = e.target.value;
    // Управляемая клетка держит один символ, поэтому набор поверх занятой приезжает вместе со
    // старым: браузер дописывает новый к нему. Старый символ не часть набранного — снимаем его,
    // иначе набор поверх цифры выглядел бы как вставка двух. Ровно два символа — это и есть набор
    // поверх; всё длиннее приходит от автоподстановки кода из сообщения и раскладывается по ряду.
    const typed = current && raw.length === 2 ? raw.replace(current, '') : raw;
    const digits = typed.replace(/\D/g, '');

    if (!digits) {
      // Набрали нецифру — заведомо промах (чужая раскладка, случайная клавиша): ряд остаётся как
      // был. Стирание — только когда клетка действительно опустела, то есть символ из неё убрали.
      if (raw) return;
      // Пустая клетка — стирание: символ уходит, хвост подтягивается, дырки не остаётся.
      onChange(value.slice(0, index) + value.slice(index + 1));
      return;
    }
    // Больше одной цифры — код приехал целиком (автоподстановка из сообщения): раскладываем по ряду.
    if (digits.length > 1) {
      paste(index, digits);
      return;
    }
    // Набор поверх занятой клетки заменяет её цифру и только её: остальные не сдвигаются, ничего
    // не вытесняется за край ряда — человек отправляет ровно то, что видит.
    const next =
      index < value.length
        ? value.slice(0, index) + digits + value.slice(index + 1)
        : value + digits;
    onChange(next.slice(0, length));
    focusCell(index + 1);
  }

  function onCellPaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!digits) return;
    e.preventDefault();
    paste(index, digits);
  }

  function onCellKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'Backspace':
        // Один клавишный ход, а не два: на пустой клетке шаг назад сразу и чистит предыдущую.
        if (!value[index]) {
          e.preventDefault();
          onChange(value.slice(0, Math.max(index - 1, 0)) + value.slice(index));
          focusCell(index - 1);
        }
        return;
      case 'ArrowLeft':
        e.preventDefault();
        focusCell(index - 1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        // Дальше первой пустой шаг вправо не идёт: страж на onFocus переставленный самим рядом
        // фокус не проверяет, и без клампа стрелка увезла бы курсор в клетку правее набранного —
        // цифра оттуда записалась бы не в ту позицию, а шаг назад ничего бы не стёр.
        focusCell(Math.min(index + 1, value.length));
        return;
      case 'Home':
        e.preventDefault();
        focusCell(0);
        return;
      case 'End':
        e.preventDefault();
        focusCell(value.length);
        return;
      default:
    }
  }

  return (
    <Box
      role="group"
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : label}
      aria-describedby={describedBy}
      data-testid={testId}
      sx={{ display: 'flex', gap: 0.75 }}
    >
      {Array.from({ length }, (_, index) => (
        <Fragment key={index}>
          {/* Зазор между группами: клетки резиновые, а разрыв между тройками фиксированный. */}
          {index > 0 && index % groupSize === 0 && <Box sx={{ flex: '0 0 10px' }} />}
          <Box
            component="input"
            ref={(el: HTMLInputElement | null) => {
              cells.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? autoComplete : 'off'}
            autoFocus={autoFocus && index === 0}
            disabled={disabled}
            value={value[index] ?? ''}
            placeholder="–"
            aria-label={digitLabel(index + 1, length)}
            aria-invalid={error || undefined}
            data-testid={`${testId}-${index}`}
            tabIndex={index === caret ? 0 : -1}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onCellChange(index, e)}
            onPaste={(e: ClipboardEvent<HTMLInputElement>) => onCellPaste(index, e)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => onCellKeyDown(index, e)}
            // Клик в клетку правее набранного не создаёт дырку, а ведёт к первой пустой. Табуляция
            // сюда не приходит: клетки правее места в порядке обхода не занимают.
            onFocus={() => {
              if (!moving.current && index > value.length) focusCell(value.length);
            }}
            sx={{
              flex: '1 1 0',
              minWidth: 0,
              height: CELL_HEIGHT,
              p: 0,
              textAlign: 'center',
              fontFamily: MONO_FONT,
              fontSize: 20,
              fontWeight: 600,
              color: error ? 'error.main' : 'text.primary',
              bgcolor: disabled ? 'action.disabledBackground' : 'background.paper',
              borderRadius: 1.5,
              border: 1,
              // Цвет рамки MUI держит внутри своего notched-outline и наружу не отдаёт: повторяем
              // его значением, иначе ряд стоял бы рядом с обычными полями другой линией.
              borderColor: error
                ? 'error.main'
                : (theme) =>
                    theme.palette.mode === 'light' ? 'rgb(0 0 0 / 23%)' : 'rgb(255 255 255 / 23%)',
              '&::placeholder': { color: 'text.disabled', opacity: 1, fontWeight: 400 },
              // Под курсором подсказка формы уже не нужна — там мигает каретка.
              '&:focus::placeholder': { color: 'transparent' },
              '&:focus': {
                outline: 'none',
                borderColor: error ? 'error.main' : 'primary.main',
                boxShadow: (theme) =>
                  `0 0 0 1px ${error ? theme.palette.error.main : theme.palette.primary.main}`,
              },
              '&:disabled': { color: 'text.disabled', WebkitTextFillColor: 'currentColor' },
            }}
          />
        </Fragment>
      ))}
    </Box>
  );
}
