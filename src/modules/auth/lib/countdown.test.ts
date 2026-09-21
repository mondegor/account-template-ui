import { describe, expect, it } from 'vitest';
import { mmss } from './countdown';

describe('mmss', () => {
  it('short countdowns go without a leading zero', () => {
    expect(mmss(42)).toBe('0:42');
    expect(mmss(125)).toBe('2:05');
  });

  it('the operation lifetime pads minutes so the width does not jump', () => {
    expect(mmss(125, true)).toBe('02:05');
  });

  /** Подтверждение нового адреса живёт ~72 часа: тысячи минут читать некому. */
  it('an hour or more is shown with hours, minutes always padded', () => {
    expect(mmss(3600)).toBe('1:00:00');
    expect(mmss(72 * 3600 - 1, true)).toBe('71:59:59');
  });
});
