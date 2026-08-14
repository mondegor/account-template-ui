import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { limits } from './index';

/**
 * Тест-сверка констант ограничений с openapi.yaml.
 * Если бэкенд поменяет длины — тест упадёт и заставит синхронизировать limits.
 *
 * Пиннятся только границы, которые фронт применяет в формах (см. limits): то, чем он не
 * пользуется, сюда не добавляем — падение такого теста было бы не про наш код.
 *
 * Проверки якорятся по имени схемы: пары min/max в спеке повторяются (realm и secret — оба 4/32),
 * поэтому поиск по всему файлу зеленел бы по чужому совпадению.
 *
 * Форматы, которые делят одно поле `secret`, объявлены не парой minLength/maxLength, а разбивкой
 * по методам в описании поля — общими там остаются 4..32. Такие границы сверяются по тексту
 * описания, и в якорь подставляются числа из `limits`: расхождение размеров тест увидит,
 * переформулировка описания его не сломает.
 */
const spec = readFileSync(resolve(__dirname, '../../contracts/auth/openapi.yaml'), 'utf8');

/** Блок схемы `components.schemas.<name>` — от её строки до следующей записи того же отступа. */
function schemaBlock(name: string): string {
  const lines = spec.split('\n');
  const start = lines.findIndex((l) => l === `    ${name}:`);
  expect(start, `schema ${name} not found in openapi.yaml`).toBeGreaterThan(-1);
  let end = start + 1;
  while (end < lines.length && (lines[end]!.startsWith('      ') || lines[end]!.trim() === '')) {
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

/** Есть ли в блоке поле `field` с указанными minLength/maxLength. */
function hasMinMax(block: string, field: string, min: number, max: number): boolean {
  const re = new RegExp(
    `^        ${field}:$[\\s\\S]*?minLength: ${min}\\n\\s*maxLength: ${max}$`,
    'm',
  );
  return re.test(block);
}

/** Строка `- <METHOD> - …` из разбивки форматов в описании поля `secret`. */
function secretFormatLine(method: string): string {
  const block = schemaBlock('Auth.Operation.Request.Model.ConfirmOperation');
  const line = block.split('\n').find((l) => l.trim().startsWith(`- ${method} - `));
  expect(line, `format of ${method} not found in the secret description`).toBeDefined();
  return line!;
}

describe('field limits match the openapi contract', () => {
  it('user_login 7/64 (AuthorizeUser)', () => {
    expect(limits.userLogin).toEqual({ min: 7, max: 64 });
    expect(hasMinMax(schemaBlock('Auth.Request.Model.AuthorizeUser'), 'user_login', 7, 64)).toBe(
      true,
    );
  });

  it('secret 4/32 (ConfirmOperation)', () => {
    expect(limits.secret).toEqual({ min: 4, max: 32 });
    expect(
      hasMinMax(schemaBlock('Auth.Operation.Request.Model.ConfirmOperation'), 'secret', 4, 32),
    ).toBe(true);
  });

  /** Число в якоре — количество знаков кода: `- 6-` из строки формата, где следом идёт «значный». */
  it('confirm code 6/6 (EMAIL and PHONE links)', () => {
    expect(limits.confirmCode).toEqual({ min: 6, max: 6 });
    const digits = `- ${limits.confirmCode.max}-`;
    expect(secretFormatLine('EMAIL')).toContain(digits);
    expect(secretFormatLine('PHONE')).toContain(digits);
    // Код занимает поле secret, поэтому за его схемные границы выйти не может.
    expect(limits.confirmCode.min).toBeGreaterThanOrEqual(limits.secret.min);
    expect(limits.confirmCode.max).toBeLessThanOrEqual(limits.secret.max);
  });

  it('recovery code 8/32 (RECOVERY link)', () => {
    expect(limits.recoveryCode).toEqual({ min: 8, max: 32 });
    expect(secretFormatLine('RECOVERY')).toContain(
      `${limits.recoveryCode.min}..${limits.recoveryCode.max}`,
    );
    expect(limits.recoveryCode.min).toBeGreaterThanOrEqual(limits.secret.min);
    expect(limits.recoveryCode.max).toBeLessThanOrEqual(limits.secret.max);
  });

  /** Один и тот же размер объявлен дважды: у формы установки пароля и у парольного звена. */
  it('new_password 8/32 (ChangePassword and PASSWORD link)', () => {
    expect(limits.password).toEqual({ min: 8, max: 32 });
    expect(
      hasMinMax(schemaBlock('Auth.Security.Request.Model.ChangePassword'), 'new_password', 8, 32),
    ).toBe(true);
    expect(secretFormatLine('PASSWORD')).toContain(
      `${limits.password.min}..${limits.password.max}`,
    );
  });

  it('totp_code 6/6 (ApplyTotpGenerator and TOTP link)', () => {
    expect(limits.totpCode).toEqual({ min: 6, max: 6 });
    expect(
      hasMinMax(schemaBlock('Auth.Security.Request.Model.ApplyTotpGenerator'), 'totp_code', 6, 6),
    ).toBe(true);
    expect(secretFormatLine('TOTP')).toContain(`- ${limits.totpCode.max}-`);
  });
});
