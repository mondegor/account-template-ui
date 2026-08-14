import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { UiCodeInput } from './codeInput';

/**
 * Ряд клеток наружу — одно поле: тест читает и заполняет его строкой, как и любой потребитель.
 * Подписи клеток атом не сочиняет, они приходят пропом, поэтому здесь это литералы теста.
 */
function Row({ onChange, length = 6 }: { onChange?: (value: string) => void; length?: number }) {
  const [value, setValue] = useState('');
  return (
    <UiCodeInput
      length={length}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      digitLabel={(n, total) => `Digit ${n} of ${total}`}
      name="code"
      autoComplete="one-time-code"
    />
  );
}

/**
 * Ряд внутри формы, которая чистит его на отправке: так экран обходится с кодом, не принятым
 * сервером. Отправка по Enter идёт прямо из клетки и курсор оттуда не уводит — в отличие от клика
 * по кнопке, который забрал бы фокус себе.
 */
function SubmittingRow() {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setValue('');
      }}
    >
      <UiCodeInput
        length={6}
        value={value}
        onChange={setValue}
        digitLabel={(n, total) => `Digit ${n} of ${total}`}
        name="code"
      />
    </form>
  );
}

const cells = () => within(screen.getByTestId('field-code')).getAllByRole('textbox');
const value = () =>
  cells()
    .map((cell) => (cell as HTMLInputElement).value)
    .join('');
const paste = (target: HTMLElement, text: string) =>
  fireEvent.paste(target, { clipboardData: { getData: () => text } });

describe('UiCodeInput', () => {
  it('shows one cell per digit of the expected code', () => {
    render(<Row />);

    expect(cells()).toHaveLength(6);
    expect(cells()[0]).toHaveAttribute('aria-label', 'Digit 1 of 6');
    expect(cells()[5]).toHaveAttribute('aria-label', 'Digit 6 of 6');
  });

  /** Набранное уезжает наружу строкой: собирать код из шести значений потребителю не приходится. */
  it('reports the whole row as one string', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);

    fireEvent.change(cells()[0]!, { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith('1');
    fireEvent.change(cells()[1]!, { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith('18');
    expect(value()).toBe('18');
  });

  it('moves the caret forward as the digits go in', () => {
    render(<Row />);

    fireEvent.change(cells()[0]!, { target: { value: '1' } });
    expect(cells()[1]).toHaveFocus();
  });

  /** Один клавишный ход, а не два: на пустой клетке шаг назад сразу и чистит предыдущую. */
  it('backspace on an empty cell steps back and clears the previous one', () => {
    render(<Row />);
    paste(cells()[0]!, '18');

    fireEvent.keyDown(cells()[2]!, { key: 'Backspace' });
    expect(value()).toBe('1');
    expect(cells()[1]).toHaveFocus();
  });

  it('arrows and Home/End walk the row without editing it', () => {
    render(<Row />);
    paste(cells()[0]!, '183947');

    fireEvent.keyDown(cells()[3]!, { key: 'ArrowLeft' });
    expect(cells()[2]).toHaveFocus();
    fireEvent.keyDown(cells()[2]!, { key: 'ArrowRight' });
    expect(cells()[3]).toHaveFocus();
    fireEvent.keyDown(cells()[3]!, { key: 'Home' });
    expect(cells()[0]).toHaveFocus();
    fireEvent.keyDown(cells()[0]!, { key: 'End' });
    expect(value()).toBe('183947');
  });

  /**
   * Шаг вправо дырку тоже не заводит: дальше первой пустой клетки идти некуда — набранная оттуда
   * цифра встала бы не в ту позицию, а шаг назад не стёр бы ничего.
   */
  it('stops the caret at the first empty cell on ArrowRight', () => {
    render(<Row />);
    paste(cells()[0]!, '18');

    fireEvent.keyDown(cells()[1]!, { key: 'ArrowRight' });
    expect(cells()[2]).toHaveFocus();
    fireEvent.keyDown(cells()[2]!, { key: 'ArrowRight' });
    expect(cells()[2]).toHaveFocus();

    fireEvent.change(cells()[2]!, { target: { value: '5' } });
    expect(value()).toBe('185');
  });

  /**
   * Нецифры отбрасываются ДО раскладки: код, скопированный с пробелами или через дефис, иначе
   * обрубился бы по первому мусорному символу.
   */
  it('drops the junk of a pasted code before laying it out', () => {
    render(<Row />);

    paste(cells()[0]!, '18 39-47');
    expect(value()).toBe('183947');
  });

  it('lays a pasted code out from the cell it landed in', () => {
    render(<Row />);
    paste(cells()[0]!, '18');

    paste(cells()[2]!, '3947');
    expect(value()).toBe('183947');
  });

  it('drops what does not fit into the row', () => {
    render(<Row />);

    paste(cells()[0]!, '18394799');
    expect(value()).toBe('183947');
  });

  /**
   * Набор поверх занятой клетки заменяет её цифру и только её: ряд не растёт, хвост не сдвигается, и
   * последняя цифра не вытесняется за край — человек отправляет ровно то, что видит.
   */
  it('replaces the digit under the caret instead of pushing the row', () => {
    render(<Row />);
    paste(cells()[0]!, '183947');

    // Клетка управляемая и держит один символ: браузер дописывает набранное к тому, что там было.
    fireEvent.change(cells()[0]!, { target: { value: '19' } });
    expect(value()).toBe('983947');
  });

  /**
   * Нецифра поверх занятой клетки — промах, а не стирание: иначе на чужой раскладке набор поверх
   * цифры молча убирал бы её, а хвост ряда съезжал бы влево.
   */
  it('ignores a non-digit typed over a filled cell', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    paste(cells()[0]!, '183947');
    onChange.mockClear();

    // Набор поверх занятой клетки приезжает вместе со старым символом; выделили её и набрали —
    // приезжает один.
    fireEvent.change(cells()[2]!, { target: { value: '3a' } });
    fireEvent.change(cells()[2]!, { target: { value: 'a' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(value()).toBe('183947');
  });

  /** Стирание — по опустевшей клетке: хвост подтягивается, дырки не остаётся. */
  it('pulls the tail up when a filled cell is emptied', () => {
    render(<Row />);
    paste(cells()[0]!, '183947');

    fireEvent.change(cells()[2]!, { target: { value: '' } });
    expect(value()).toBe('18947');
  });

  /**
   * Автоподстановка кода из сообщения объявлена ровно на первой клетке: объяви её на каждой — и
   * браузер подставил бы код шесть раз, по разу в клетку.
   */
  it('asks for the one-time code on the first cell only', () => {
    render(<Row />);

    expect(cells()[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(cells()[1]).toHaveAttribute('autocomplete', 'off');
  });

  /** Мобильная клавиатура должна открыться цифрами: буквы в эти клетки всё равно не попадут. */
  it('asks for the numeric keyboard in every cell', () => {
    render(<Row />);

    for (const cell of cells()) expect(cell).toHaveAttribute('inputmode', 'numeric');
  });

  /**
   * Дырок в значении не бывает: клик в клетку правее набранного ведёт к первой пустой, иначе цифра
   * записалась бы в дырку, а строка наружу сложилась бы не из тех позиций.
   */
  it('sends the caret to the first empty cell instead of leaving a hole', () => {
    render(<Row />);
    paste(cells()[0]!, '18');

    cells()[5]!.focus();
    expect(cells()[2]).toHaveFocus();
  });

  /**
   * Наружу ряд — одно поле, и место в табуляции у него одно: клетку правее набранного страж фокуса
   * отбрасывает назад, поэтому будь табулируемой каждая, Tab упирался бы в этого стража и наружу
   * ряда не выходил бы, пока код не набран. Ход по клеткам делают стрелки.
   */
  it('takes a single stop in the tab order', () => {
    render(<Row />);
    const tabIndexes = () => cells().map((cell) => cell.getAttribute('tabindex'));

    expect(tabIndexes()).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);

    paste(cells()[0]!, '18');
    expect(tabIndexes()).toEqual(['-1', '-1', '0', '-1', '-1', '-1']);

    paste(cells()[2]!, '3947');
    expect(tabIndexes()).toEqual(['-1', '-1', '-1', '-1', '-1', '0']);
  });

  /**
   * Ряд, очищенный снаружи, забирает курсор с собой: события фокуса при этом не происходит, и без
   * этого он остался бы в конце ряда — цифры набирались бы с начала, а курсор мигал бы в шестой
   * клетке.
   */
  it('returns the caret to the start when the value is cleared from outside', () => {
    const { container } = render(<SubmittingRow />);
    paste(cells()[0]!, '183947');
    expect(cells()[5]).toHaveFocus();

    fireEvent.submit(container.querySelector('form')!);
    expect(value()).toBe('');
    expect(cells()[0]).toHaveFocus();

    fireEvent.change(cells()[0]!, { target: { value: '1' } });
    expect(value()).toBe('1');
    expect(cells()[1]).toHaveFocus();
  });
});
