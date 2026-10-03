import { describe, expect, it } from 'vitest';
import { hasNonAscii } from './secretFormat';

describe('secret format', () => {
  /** Не та раскладка — это символ вне ASCII; пробел и спецсимволы в ASCII входят. */
  it('flags characters outside ASCII only', () => {
    expect(hasNonAscii('Secret Pass !~')).toBe(false);
    expect(hasNonAscii('')).toBe(false);
    expect(hasNonAscii('pass\u0434')).toBe(true);
    expect(hasNonAscii('caf\u00e9')).toBe(true);
  });
});
