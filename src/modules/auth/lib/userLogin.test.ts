import { describe, expect, it } from 'vitest';
import { isSignupEmail } from './userLogin';

describe('isSignupEmail (регистрация — только email)', () => {
  it('пустое не проходит', () => {
    expect(isSignupEmail('  ')).toBe(false);
  });
  it('телефон отклоняется: регистрация только по email', () => {
    expect(isSignupEmail('+79998887766')).toBe(false);
  });
  it("короче лимита не проходит, даже когда по форме это email ('a@b' — 3 символа)", () => {
    expect(isSignupEmail('a@b')).toBe(false);
  });
  it('битый email не проходит, валидный проходит', () => {
    expect(isSignupEmail('user@@x')).toBe(false);
    expect(isSignupEmail('user@example.com')).toBe(true);
  });
});
