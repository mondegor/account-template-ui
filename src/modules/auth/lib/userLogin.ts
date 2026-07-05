import { limits } from '@config';

/**
 * Валидация поля `user_login` (email ИЛИ телефон). Клиентская проверка — только для быстрого
 * UX-фидбека; источник истины — сервер (`signin`/`check-login` вернут 400 с ошибкой поля).
 * Переиспользуется в signup и позже в zod-схемах schema-renderer.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Телефон: опц. ведущий '+', остальное — цифры/разделители; значимых цифр ≥10 (openapi phone min10). */
const PHONE_MIN_DIGITS = 10;

export function isEmailOrPhone(value: string): boolean {
  const v = value.trim();
  if (v.includes('@')) return EMAIL_RE.test(v);
  const digits = v.replace(/\D/g, '');
  return digits.length >= PHONE_MIN_DIGITS && /^\+?[\d\s()-]+$/.test(v);
}

/** Возвращает текст ошибки для поля или `null`, если ввод валиден. */
export function validateUserLogin(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Укажите email или телефон';
  if (v.length < limits.userLogin.min || v.length > limits.userLogin.max) {
    return 'Введите корректный email или телефон';
  }
  return isEmailOrPhone(v) ? null : 'Введите корректный email или телефон';
}

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Валидация поля email на регистрации (signup принимает только email, не телефон). */
export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Укажите email';
  if (v.length < limits.userLogin.min || v.length > limits.userLogin.max) {
    return 'Введите корректный email';
  }
  return isEmail(v) ? null : 'Введите корректный email';
}
