import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFieldError } from '@core/api';

vi.mock('../api/authApi', () => ({ checkLogin: vi.fn() }));
import { checkLogin } from '../api/authApi';
import {
  checkEmailAvailability,
  getCachedEmailAvailability,
  resetEmailAvailabilityCache,
} from './emailAvailability';

beforeEach(() => {
  resetEmailAvailabilityCache();
  vi.mocked(checkLogin).mockReset();
});

describe('checkEmailAvailability (общий кэш дедупит check-login)', () => {
  it('детерминированный исход кэшируется: повторный вызов не дёргает ручку', async () => {
    vi.mocked(checkLogin).mockResolvedValue(true);
    expect(await checkEmailAvailability('user@example.com')).toEqual({ state: 'free' });
    // Второй раз (напр. async-валидатор на сабмите после живого чека поля) — из кэша, без сети.
    expect(await checkEmailAvailability('user@example.com')).toEqual({ state: 'free' });
    expect(checkLogin).toHaveBeenCalledTimes(1);
    // Синхронное чтение того же кэша — для мгновенного UX в поле.
    expect(getCachedEmailAvailability('  user@example.com  ')).toEqual({ state: 'free' });
  });

  it("занятый email кэшируется c текстом; 'unknown' (сеть/5xx) — нет", async () => {
    vi.mocked(checkLogin).mockRejectedValueOnce(
      new ApiFieldError([{ code: 'user_email', detail: 'Занят' }], 400),
    );
    expect(await checkEmailAvailability('taken@example.com')).toEqual({
      state: 'taken',
      message: 'Занят',
    });
    expect(await checkEmailAvailability('taken@example.com')).toEqual({
      state: 'taken',
      message: 'Занят',
    });
    expect(checkLogin).toHaveBeenCalledTimes(1);

    // Транзиентная ошибка не кэшируется → следующий вызов снова идёт в сеть.
    vi.mocked(checkLogin).mockRejectedValue(new Error('network'));
    expect(await checkEmailAvailability('flaky@example.com')).toEqual({ state: 'unknown' });
    expect(getCachedEmailAvailability('flaky@example.com')).toBeUndefined();
    await checkEmailAvailability('flaky@example.com');
    expect(vi.mocked(checkLogin).mock.calls.filter((c) => c[0] === 'flaky@example.com')).toHaveLength(
      2,
    );
  });
});
