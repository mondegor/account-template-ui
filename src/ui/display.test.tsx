import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UiButton } from './display';

/**
 * Занятая кнопка. Подпись приходит пропом, поэтому здесь это литерал теста.
 */

const label = 'Continue';
const button = () => screen.getByRole('button', { name: label });

describe('UiButton busy', () => {
  it('shows no busy sign and stays enabled by default', () => {
    render(<UiButton label={label} />);

    expect(button()).toBeEnabled();
    expect(button()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('marks the button busy, disables it and shows the sign', () => {
    render(<UiButton label={label} busy />);

    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  // Знак ничего не говорит, и доступное имя кнопки остаётся её подписью: по ней её ищут и тесты,
  // и диктор.
  it('keeps the accessible name while busy', () => {
    render(<UiButton label={label} busy />);

    expect(button()).toBeInTheDocument();
  });

  // Гашение приходит с двух сторон, и занятость снимать его не должна: форма может быть не готова
  // и во время запроса — например, пока сервер отвечает на предыдущую отправку.
  it('stays disabled when disabled without being busy', () => {
    render(<UiButton label={label} disabled />);

    expect(button()).toBeDisabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
