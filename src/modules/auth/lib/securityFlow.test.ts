import { beforeEach, describe, expect, it } from 'vitest';
import { clearSecurityFlow, loadSecurityFlow, saveSecurityFlow } from './securityFlow';

/**
 * Запись переживает reload вместе с самой операцией, поэтому читается из хранилища, а не из
 * состояния вкладки. Пустое чтение — это не ошибка, а «операция не из security-потока»: на нём
 * стоит развилка двух экранов подтверждения, и бросок вместо null увёл бы обе страницы в белый
 * экран.
 */

beforeEach(() => {
  sessionStorage.clear();
});

describe('securityFlow', () => {
  it('with no record it is null: the operation belongs to the sign-in, not to a security flow', () => {
    expect(loadSecurityFlow()).toBeNull();
  });

  it('a stored record is read in full, token included', () => {
    saveSecurityFlow({ kind: 'totp', token: 't'.repeat(64) });

    expect(loadSecurityFlow()).toEqual({ kind: 'totp', token: 't'.repeat(64) });
  });

  it('the token is optional: before confirmation the flow kind is enough', () => {
    saveSecurityFlow({ kind: 'disable2fa' });

    expect(loadSecurityFlow()).toEqual({ kind: 'disable2fa' });
  });

  it('clearing removes the flow marker', () => {
    saveSecurityFlow({ kind: 'password' });
    clearSecurityFlow();

    expect(loadSecurityFlow()).toBeNull();
  });

  it('corrupted storage neither breaks the read nor leaves garbage behind', () => {
    sessionStorage.setItem('auth:securityFlow', '{not json');

    expect(loadSecurityFlow()).toBeNull();
    expect(sessionStorage.getItem('auth:securityFlow')).toBeNull();
  });

  /**
   * Разобравшаяся, но чужая запись опаснее битой: по `kind` выбирается терминальное действие, и
   * неизвестный вид увёл бы на экран подтверждения, закрывать который нечем.
   */
  it('an unknown flow kind does not count as a record', () => {
    sessionStorage.setItem('auth:securityFlow', JSON.stringify({ kind: 'wire-transfer' }));

    expect(loadSecurityFlow()).toBeNull();
    expect(sessionStorage.getItem('auth:securityFlow')).toBeNull();
  });
});
