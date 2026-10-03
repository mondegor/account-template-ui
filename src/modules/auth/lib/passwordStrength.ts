import type { PasswordAcceptStatus, PasswordStrength } from '../api/types';

/**
 * Что форма установки пароля показывает из оценки сервера: сколько делений шкалы заполнено и каким
 * цветом.
 *
 * Сама оценка и её исход считаются на сервере — здесь только их показ. Порог приёма у приложения
 * свой, и ступень его не выдаёт: пропустит ли пароль установка, говорит `accept_status` из того же
 * ответа.
 */

/** Заполненных делений шкалы из четырёх. У `NOT_RATED` шкала пустая: оценивать было нечем. */
const BARS: Record<PasswordStrength, number> = {
  NOT_RATED: 0,
  WEAK: 1,
  MIDDLE: 2,
  STRONG: 3,
  THE_BEST: 4,
};

/** Всего делений на шкале — им же меряется ширина пустой шкалы, когда оценки нет. */
export const STRENGTH_BARS = 4;

export function strengthBars(strength: PasswordStrength): number {
  return BARS[strength];
}

/**
 * Тон шкалы — исход ворот: цвет говорит «не пропустим / пропустим», а насколько именно хорошо,
 * показывают сами деления. Ступень на цвет не влияет, `NOT_RATED` в том числе: цвет обязан
 * совпадать с тем, пропустит ли форма.
 */
export function strengthTone(status: PasswordAcceptStatus): 'error' | 'success' {
  return status === 'ACCEPTED' ? 'success' : 'error';
}

const PASSWORD_CHARSET = /^[\x21-\x7E]*$/;

/**
 * Набор символов пароля по контракту: латинские буквы, цифры и спецсимволы — любые печатные символы
 * ASCII, кроме пробела. Значение вне набора сервер отклоняет уже на оценке надёжности, поэтому
 * спрашивать её незачем: причину называет сама форма. Чаще всего это не та раскладка.
 */
export function hasPasswordCharset(value: string): boolean {
  return PASSWORD_CHARSET.test(value);
}
