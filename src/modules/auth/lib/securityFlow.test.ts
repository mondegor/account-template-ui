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
  it('без записи — null (операция принадлежит входу, а не security-потоку)', () => {
    expect(loadSecurityFlow()).toBeNull();
  });

  it('сохранённая запись читается целиком, вместе с токеном', () => {
    saveSecurityFlow({ kind: 'totp', token: 't'.repeat(64) });

    expect(loadSecurityFlow()).toEqual({ kind: 'totp', token: 't'.repeat(64) });
  });

  it('токен необязателен: до подтверждения хватает вида потока', () => {
    saveSecurityFlow({ kind: 'disable2fa' });

    expect(loadSecurityFlow()).toEqual({ kind: 'disable2fa' });
  });

  it('очистка снимает признак потока', () => {
    saveSecurityFlow({ kind: 'password' });
    clearSecurityFlow();

    expect(loadSecurityFlow()).toBeNull();
  });

  it('испорченное хранилище не роняет чтение и не остаётся мусором', () => {
    sessionStorage.setItem('auth:securityFlow', '{не json');

    expect(loadSecurityFlow()).toBeNull();
    expect(sessionStorage.getItem('auth:securityFlow')).toBeNull();
  });

  /**
   * Разобравшаяся, но чужая запись опаснее битой: по `kind` выбирается терминальное действие, и
   * неизвестный вид увёл бы на экран подтверждения, закрывать который нечем.
   */
  it('неизвестный вид потока записью не считается', () => {
    sessionStorage.setItem('auth:securityFlow', JSON.stringify({ kind: 'wire-transfer' }));

    expect(loadSecurityFlow()).toBeNull();
    expect(sessionStorage.getItem('auth:securityFlow')).toBeNull();
  });
});
