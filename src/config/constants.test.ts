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

describe('field limits match the openapi contract', () => {
  it('user_login 7/64 (AuthorizeUser)', () => {
    expect(limits.userLogin).toEqual({ min: 7, max: 64 });
    expect(hasMinMax(schemaBlock('Auth.Request.Model.AuthorizeUser'), 'user_login', 7, 64)).toBe(
      true,
    );
  });

  it('secret/code 4/32 (ConfirmOperation)', () => {
    expect(limits.secret).toEqual({ min: 4, max: 32 });
    expect(
      hasMinMax(schemaBlock('Auth.Operation.Request.Model.ConfirmOperation'), 'secret', 4, 32),
    ).toBe(true);
  });

  it('new_password 8/32 (ChangePassword)', () => {
    expect(limits.password).toEqual({ min: 8, max: 32 });
    expect(
      hasMinMax(schemaBlock('Auth.Security.Request.Model.ChangePassword'), 'new_password', 8, 32),
    ).toBe(true);
  });

  it('totp_code 6/6 (ApplyTotpGenerator)', () => {
    expect(limits.totpCode).toEqual({ min: 6, max: 6 });
    expect(
      hasMinMax(schemaBlock('Auth.Security.Request.Model.ApplyTotpGenerator'), 'totp_code', 6, 6),
    ).toBe(true);
  });
});
