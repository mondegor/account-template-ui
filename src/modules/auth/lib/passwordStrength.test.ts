import { describe, expect, it } from 'vitest';
import type { PasswordStrength } from '../api/types';
import { STRENGTH_BARS, strengthBars, strengthTone } from './passwordStrength';

/** Все значения перечисления спеки — таблицы обязаны отвечать на каждое. */
const ALL: PasswordStrength[] = ['NOT_RATED', 'WEAK', 'MIDDLE', 'STRONG', 'THE_BEST'];

describe('password strength', () => {
  /** Шкала растёт вместе с оценкой и не выходит за свои деления. */
  it('fills the scale monotonically', () => {
    const filled = ALL.map(strengthBars);

    expect(filled).toEqual([...filled].sort((a, b) => a - b));
    expect(Math.max(...filled)).toBe(STRENGTH_BARS);
    expect(Math.min(...filled)).toBe(0);
  });

  /**
   * Цвет говорит про исход ворот (`accept_status`), а не про ступень: непрошедшее красное, прошедшее
   * зелёное.
   */
  it('colours the scale by the verdict', () => {
    expect(strengthTone('TOO_WEAK')).toBe('error');
    expect(strengthTone('RECOVERY_CODE_FORMAT')).toBe('error');
    expect(strengthTone('ACCEPTED')).toBe('success');
  });
});
