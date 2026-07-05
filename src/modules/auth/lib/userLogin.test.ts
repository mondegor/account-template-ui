import { describe, expect, it } from 'vitest';
import { isEmailOrPhone, validateEmail, validateUserLogin } from './userLogin';

describe('isEmailOrPhone', () => {
  it('принимает валидный email', () => {
    expect(isEmailOrPhone('user@example.com')).toBe(true);
  });
  it('принимает телефон с +, пробелами, скобками (≥10 цифр)', () => {
    expect(isEmailOrPhone('+7 (999) 888-77-66')).toBe(true);
  });
  it('отклоняет мусор и слишком короткий телефон', () => {
    expect(isEmailOrPhone('abcdefg')).toBe(false);
    expect(isEmailOrPhone('12345')).toBe(false);
    expect(isEmailOrPhone('user@@x')).toBe(false);
  });
});

describe('validateUserLogin', () => {
  it('пустое → просьба указать', () => {
    expect(validateUserLogin('   ')).toBe('Укажите email или телефон');
  });
  it('короткое/битое → единое сообщение', () => {
    expect(validateUserLogin('a@b')).toBe('Введите корректный email или телефон');
    expect(validateUserLogin('abcdefg')).toBe('Введите корректный email или телефон');
  });
  it('валидный email/телефон → null', () => {
    expect(validateUserLogin('user@example.com')).toBeNull();
    expect(validateUserLogin('+79998887766')).toBeNull();
  });
});

describe('validateEmail (signup — только email)', () => {
  it('пустое → просьба указать', () => {
    expect(validateEmail('  ')).toBe('Укажите email');
  });
  it('телефон отклоняется (регистрация только по email)', () => {
    expect(validateEmail('+79998887766')).toBe('Введите корректный email');
  });
  it('битый email → сообщение, валидный → null', () => {
    expect(validateEmail('a@b')).toBe('Введите корректный email');
    expect(validateEmail('user@example.com')).toBeNull();
  });
});
