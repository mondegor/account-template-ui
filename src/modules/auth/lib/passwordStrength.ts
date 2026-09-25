import type { PasswordStrength } from '../api/types';

/**
 * Что форма установки пароля знает про оценку сервера: сколько делений шкалы заполнено и пропускает
 * ли эта оценка дальше.
 *
 * Сама оценка считается на сервере — здесь только её показ и ворота. Ворота стоят на `STRONG` —
 * пороге сервера по умолчанию: пароль ниже него сервер всё равно отклонит, а `NOT_RATED` значит,
 * что оценки нет вовсе, и открывать ворота нечем.
 */

/** Заполненных делений шкалы из четырёх. У `NOT_RATED` шкала пустая: оценивать было нечем. */
const BARS: Record<PasswordStrength, number> = {
  NOT_RATED: 0,
  WEAK: 1,
  MIDDLE: 2,
  STRONG: 3,
  THE_BEST: 4,
};

const PASSING: ReadonlySet<PasswordStrength> = new Set<PasswordStrength>(['STRONG', 'THE_BEST']);

/** Всего делений на шкале — им же меряется ширина пустой шкалы, когда оценки нет. */
export const STRENGTH_BARS = 4;

export function strengthBars(strength: PasswordStrength): number {
  return BARS[strength];
}

export function isPassingStrength(strength: PasswordStrength): boolean {
  return PASSING.has(strength);
}

/**
 * Тон шкалы — исход ворот: цвет говорит «не пропустим / пропустим», а насколько именно хорошо,
 * показывают сами деления.
 */
export function strengthTone(strength: PasswordStrength): 'error' | 'success' | 'none' {
  if (strength === 'NOT_RATED') return 'none';
  return isPassingStrength(strength) ? 'success' : 'error';
}
