import { limits } from '@config';

/**
 * Предварительная проверка емаила регистрации — ради одного потребителя: EmailFieldNode дёргает
 * `check-login` только после паузы в наборе и только для правдоподобного адреса, чтобы не ходить
 * в сеть на каждый символ. Полноценная валидация формы живёт не здесь: сообщения под полями
 * собирает zod-схема из `validation` узлов (@core/renderer/validationToZod), а источник истины —
 * сервер (`signup`/`check-login` вернут 400 с ошибкой поля).
 *
 * Поэтому предикат, а не текст ошибки: второй набор строк был бы и лишним, и непереведённым —
 * язык интерфейса в lib неизвестен.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Годен ли ввод как email регистрации: длина по openapi + формат (телефон signup не принимает). */
export function isSignupEmail(value: string): boolean {
  const v = value.trim();
  return v.length >= limits.userLogin.min && v.length <= limits.userLogin.max && EMAIL_RE.test(v);
}
