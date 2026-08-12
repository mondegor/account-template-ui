import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UiTextField } from './inputs';

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
});
