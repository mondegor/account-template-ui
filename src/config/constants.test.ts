import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { limits } from './index';

/**
 * Тест-сверка констант ограничений с openapi.yaml (как требует plan.txt).
 * Если бэкенд поменяет длины — тест упадёт и заставит синхронизировать limits.
 */
const spec = readFileSync(resolve(__dirname, '../../docs/api/auth/openapi.yaml'), 'utf8');

/** Грубая проверка: в спеке присутствует блок min/max для соответствующего поля. */
function hasMinMax(min: number, max: number): boolean {
  const re = new RegExp(`minLength:\\s*${min}[\\s\\S]{0,60}maxLength:\\s*${max}`);
  return re.test(spec);
}

describe('ограничения полей соответствуют openapi', () => {
  it('user_login 7/64', () => {
    expect(limits.userLogin).toEqual({ min: 7, max: 64 });
    expect(hasMinMax(7, 64)).toBe(true);
  });

  it('secret/код 4/32', () => {
    expect(limits.secret).toEqual({ min: 4, max: 32 });
    expect(hasMinMax(4, 32)).toBe(true);
  });

  it('token 64/128', () => {
    expect(limits.token).toEqual({ min: 64, max: 128 });
    expect(hasMinMax(64, 128)).toBe(true);
  });

  it('realm maxLength 32', () => {
    expect(limits.realm.max).toBe(32);
    expect(/maxLength:\s*32/.test(spec)).toBe(true);
  });
});
