import { describe, expect, it } from 'vitest';
import type { PasswordStrength } from '../api/types';
import { STRENGTH_BARS, isPassingStrength, strengthBars, strengthTone } from './passwordStrength';

/** Все значения перечисления спеки — таблицы обязаны отвечать на каждое. */
const ALL: PasswordStrength[] = ['NOT_RATED', 'WEAK', 'MIDDLE', 'STRONG', 'THE_BEST'];

describe('password strength', () => {
  /**
   * Ворота — единственное, ради чего форма спрашивает оценку. Слабый пароль вторым фактором не
   * защищает, а `NOT_RATED` значит, что оценки нет: открывать ворота нечем.
   */
  it('opens the gate from MIDDLE up', () => {
    expect(ALL.filter(isPassingStrength)).toEqual(['MIDDLE', 'STRONG', 'THE_BEST']);
  });

  /** Шкала растёт вместе с оценкой и не выходит за свои деления. */
  it('fills the scale monotonically', () => {
    const filled = ALL.map(strengthBars);

    expect(filled).toEqual([...filled].sort((a, b) => a - b));
    expect(Math.max(...filled)).toBe(STRENGTH_BARS);
    expect(Math.min(...filled)).toBe(0);
  });

  /** Цвет говорит про исход ворот: непрошедшее красное, порог жёлтый, дальше зелёное. */
  it('colours the scale by the verdict', () => {
    expect(strengthTone('NOT_RATED')).toBe('none');
    expect(strengthTone('WEAK')).toBe('error');
    expect(strengthTone('MIDDLE')).toBe('warning');
    expect(strengthTone('STRONG')).toBe('success');
    expect(strengthTone('THE_BEST')).toBe('success');
  });
});
