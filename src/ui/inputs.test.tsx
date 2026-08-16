import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UiFieldMessage, UiTextField } from './inputs';

/** Управляемое поле: атом значение не хранит, а тесту нужно видеть результат ввода. */
function Field({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <UiTextField
      name="user_email"
      label="Email"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

/** Подписи кнопки показа приходят пропом — атом своих строк не заводит, и тут это литералы теста. */
const REVEAL = { show: 'Show password', hide: 'Hide password' };

/** Строка под полем приходит пропом — тут это литерал теста. */
const HELPER = 'Enter a valid email';

function FieldWithHelper({ collapseHelper }: { collapseHelper?: boolean }) {
  return (
    <UiTextField
      name="user_email"
      label="Email"
      value=""
      onChange={() => {}}
      error
      helperText={HELPER}
      collapseHelper={collapseHelper}
    />
  );
}

/** Строка, которую рисует не поле, а тот, кто его поставил, — тут это литерал теста. */
const OUTER = 'The server refused this value';
const OUTER_ID = 'outer-message';

function FieldWithOuterMessage({ helperText }: { helperText?: string }) {
  return (
    <>
      <UiTextField
        name="user_email"
        label="Email"
        value=""
        onChange={() => {}}
        error
        collapseHelper
        messageBelow
        describedBy={OUTER_ID}
        helperText={helperText}
      />
      <UiFieldMessage id={OUTER_ID} text={OUTER} tone="error" />
    </>
  );
}

/** Что диктор прочитает вместе с полем: строки всех связанных с ним узлов. */
function describedText(field: HTMLElement) {
  return (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

function PasswordField() {
  const [value, setValue] = useState('secret');
  return (
    <UiTextField
      name="password"
      label="Password"
      type="password"
      value={value}
      onChange={setValue}
      reveal={REVEAL}
    />
  );
}

/** Подпись и знак действия приходят пропами — тут это литералы теста. */
const ACTION_LABEL = 'Copy password';

function FieldWithAction({
  onAction,
  reveal,
  disabled,
}: {
  onAction: () => void;
  reveal?: boolean;
  disabled?: boolean;
}) {
  return (
    <UiTextField
      name="password"
      label="Password"
      type="password"
      value="secret"
      onChange={() => {}}
      reveal={reveal ? REVEAL : undefined}
      action={{ label: ACTION_LABEL, icon: <span>copy</span>, onClick: onAction, disabled }}
    />
  );
}

describe('UiTextField', () => {
  /**
   * Поле ищут по testid, чтобы заполнить и прочитать его. Окажись он на обёртке MUI, запрос вернул
   * бы div: значение с него не прочитать, а ввод по нему до onChange не доедет.
   */
  it('puts the testid on the input itself', () => {
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    const field = screen.getByTestId('field-user_email');
    expect(field).toBe(screen.getByRole('textbox'));

    fireEvent.change(field, { target: { value: 'user@example.com' } });
    expect(onChange).toHaveBeenCalledWith('user@example.com');
    expect(field).toHaveValue('user@example.com');
  });

  /**
   * Пароль набирают вслепую, и единственный способ проверить набранное — показать его. Доступное
   * имя кнопки меняется вместе с состоянием: иначе с экрана читателя оно врало бы про действие.
   */
  it('the eye shows the value and renames itself', () => {
    render(<PasswordField />);
    const field = screen.getByTestId('field-password');
    expect(field).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: REVEAL.show }));
    expect(field).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: REVEAL.hide }));
    expect(field).toHaveAttribute('type', 'password');
  });

  /** Enter в поле обязан отправлять форму, а не показывать пароль. */
  it('the eye never submits the form', () => {
    render(<PasswordField />);

    expect(screen.getByRole('button', { name: REVEAL.show })).toHaveAttribute('type', 'button');
  });

  /**
   * Отказ по полю читается вместе с полем, кем бы строка ни была отрисована: своей в режиме
   * раскрытия и подписью MUI без него. Иначе вердикт достался бы только тому, кто смотрит на экран.
   */
  it('ties the message under the field to the field itself', () => {
    const { rerender } = render(<FieldWithHelper />);
    expect(describedText(screen.getByTestId('field-user_email'))).toContain(HELPER);

    rerender(<FieldWithHelper collapseHelper />);
    expect(describedText(screen.getByTestId('field-user_email'))).toContain(HELPER);
  });

  /**
   * Строку рисуют и снаружи — там, где между полем и ней стоит что-то третье. Своя строка при этом
   * старше: у поля одно описание, и оно ближайшее.
   */
  it('reads the message drawn outside, and its own one ahead of it', () => {
    const { rerender } = render(<FieldWithOuterMessage />);
    expect(describedText(screen.getByTestId('field-user_email'))).toContain(OUTER);

    rerender(<FieldWithOuterMessage helperText={HELPER} />);
    const described = describedText(screen.getByTestId('field-user_email'));
    expect(described).toContain(HELPER);
    expect(described).not.toContain(OUTER);
  });

  /** Кнопки нет вовсе там, где её не просили: скрывать нечего у обычного поля. */
  it('has no eye without the labels for it', () => {
    render(<Field />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * Действие над значением зовёт своё, а не показывает поле: у знака рядом с глазом должен быть
   * свой обработчик, иначе клик по нему открывал бы пароль.
   */
  it('calls the action in the tail of the field', () => {
    const onAction = vi.fn();
    render(<FieldWithAction onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: ACTION_LABEL }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('field-password')).toHaveAttribute('type', 'password');
  });

  /**
   * Делать над значением бывает нечего, и тогда знак не ждёт нажатия: доступным его состояние
   * решает вызывающий — что считать пустым значением, знает он.
   */
  it('the disabled action takes no clicks', () => {
    const onAction = vi.fn();
    render(<FieldWithAction onAction={onAction} disabled />);

    const button = screen.getByRole('button', { name: ACTION_LABEL });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  /** Enter в поле обязан отправлять форму, а не запускать действие. */
  it('the action never submits the form', () => {
    render(<FieldWithAction onAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: ACTION_LABEL })).toHaveAttribute('type', 'button');
  });

  /** Глаз и действие уживаются в одном хвосте: показ значения и действие над ним независимы. */
  it('keeps the eye next to the action', () => {
    const onAction = vi.fn();
    render(<FieldWithAction onAction={onAction} reveal />);
    const field = screen.getByTestId('field-password');

    fireEvent.click(screen.getByRole('button', { name: REVEAL.show }));
    expect(field).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: ACTION_LABEL }));
    expect(onAction).toHaveBeenCalledTimes(1);
    // Действие значения не прячет: показ им не управляется.
    expect(field).toHaveAttribute('type', 'text');
  });
});

/** Строка сообщения приходит пропом — тут это литерал теста. */
const MESSAGE = 'Enter a valid email';

describe('UiFieldMessage', () => {
  /** Пока сказать нечего, места под строку не занято ничем — узла в разметке нет. */
  it('renders nothing without text', () => {
    const { container } = render(<UiFieldMessage />);

    expect(container).toBeEmptyDOMElement();
  });

  /**
   * Схлопывание плавное, поэтому строка уезжает вместе со своей высотой и до конца анимации
   * остаётся на экране со своим текстом: опустошить её значило бы сворачивать пустоту.
   */
  it('keeps its text while it collapses, then leaves the markup', async () => {
    const { container, rerender } = render(<UiFieldMessage text={MESSAGE} tone="error" />);
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();

    rerender(<UiFieldMessage tone="error" />);
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  /**
   * Раскрытие относится к изменению, а не к первому показу: постоянная подсказка поля стоит на
   * месте с первого кадра, иначе заход на страницу двигал бы всё, что ниже неё.
   *
   * `MuiCollapse-entered` — класс завершённого перехода: пока он идёт, класса нет.
   */
  const collapse = (container: HTMLElement) => container.querySelector('.MuiCollapse-root');

  it('is already open when the text is there from the first frame', () => {
    const { container } = render(<UiFieldMessage text={MESSAGE} />);

    expect(collapse(container)).toHaveClass('MuiCollapse-entered');
  });

  /** А вот появившаяся строка раздвигает место переходом — иначе всё ниже дёргалось бы скачком. */
  it('opens with a transition when the text appears later', async () => {
    const { container, rerender } = render(<UiFieldMessage />);

    rerender(<UiFieldMessage text={MESSAGE} />);
    expect(collapse(container)).not.toHaveClass('MuiCollapse-entered');

    await waitFor(() => expect(collapse(container)).toHaveClass('MuiCollapse-entered'));
  });
});
