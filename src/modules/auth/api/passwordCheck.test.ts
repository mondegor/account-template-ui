import { describe, expect, it } from 'vitest';
import { ApiFieldError } from '@core/api';
import { limits } from '@config';
import { calcPasswordStrength, generatePassword } from './authApi';

/**
 * Оценка и генерация пароля через реальный authApi против MSW-сервера — тот же приём, что в
 * остальных интеграционных проверках модуля. Проверяется связка «клиент → ручка», а не сами оценки
 * мока: как считать надёжность, решает развёртывание.
 */

describe('password check endpoints', () => {
  /** Обе ручки гостевые: ни сессии, ни токена им не нужно. */
  it('rates a password without a session', async () => {
    expect(await calcPasswordStrength('L$QI.qA6eu7zG%7w')).toBe('THE_BEST');
  });

  /** Ступени различимы: иначе ворота формы стояли бы на значении, которого не бывает. */
  it('tells a weak password from a passing one', async () => {
    expect(await calcPasswordStrength('password12')).toBe('WEAK');
    expect(await calcPasswordStrength('Sunflower42')).toBe('MIDDLE');
  });

  /** Границы поля — те же, что у самого пароля: короткое значение отклоняется по полю запроса. */
  it('rejects a password outside the limits by field', async () => {
    await expect(calcPasswordStrength('short')).rejects.toSatisfy(
      (e) => e instanceof ApiFieldError && e.fields[0]?.code === 'ValidateError/password',
    );
  });

  /** Сгенерированное значение форма подставляет в поле как есть — оно обязано влезать в границы. */
  it('generates a password that fits the field', async () => {
    const password = await generatePassword();

    expect(password.length).toBeGreaterThanOrEqual(limits.password.min);
    expect(password.length).toBeLessThanOrEqual(limits.password.max);
    expect(await calcPasswordStrength(password)).toBe('THE_BEST');
  });
});
