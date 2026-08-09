import { describe, expect, it } from 'vitest';
import { isSignupEmail } from './userLogin';

describe('isSignupEmail (signup accepts an email only)', () => {
  it('an empty value does not pass', () => {
    expect(isSignupEmail('  ')).toBe(false);
  });
  it('a phone number is rejected: signup is by email only', () => {
    expect(isSignupEmail('+79998887766')).toBe(false);
  });
  it("shorter than the limit does not pass even when it looks like an email ('a@b' is 3 characters)", () => {
    expect(isSignupEmail('a@b')).toBe(false);
  });
  it('a broken email does not pass, a valid one does', () => {
    expect(isSignupEmail('user@@x')).toBe(false);
    expect(isSignupEmail('user@example.com')).toBe(true);
  });
});
