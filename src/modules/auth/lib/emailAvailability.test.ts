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

describe('checkEmailAvailability (a shared cache deduplicates check-login)', () => {
  it('a deterministic outcome is cached: a repeat call does not hit the endpoint', async () => {
    vi.mocked(checkLogin).mockResolvedValue(true);
    expect(await checkEmailAvailability('user@example.com')).toEqual({ state: 'free' });
    // Второй раз (напр. async-валидатор на сабмите после живого чека поля) — из кэша, без сети.
    expect(await checkEmailAvailability('user@example.com')).toEqual({ state: 'free' });
    expect(checkLogin).toHaveBeenCalledTimes(1);
    // Синхронное чтение того же кэша — для мгновенного UX в поле.
    expect(getCachedEmailAvailability('  user@example.com  ')).toEqual({ state: 'free' });
  });

  it("a taken email is cached with its text; 'unknown' (network/5xx) is not", async () => {
    vi.mocked(checkLogin).mockRejectedValueOnce(
      new ApiFieldError([{ code: 'EmailAlreadyExists/user_login', detail: 'Taken' }], 400),
    );
    expect(await checkEmailAvailability('taken@example.com')).toEqual({
      state: 'taken',
      message: 'Taken',
    });
    expect(await checkEmailAvailability('taken@example.com')).toEqual({
      state: 'taken',
      message: 'Taken',
    });
    expect(checkLogin).toHaveBeenCalledTimes(1);

    // Транзиентная ошибка не кэшируется → следующий вызов снова идёт в сеть.
    vi.mocked(checkLogin).mockRejectedValue(new Error('network'));
    expect(await checkEmailAvailability('flaky@example.com')).toEqual({ state: 'unknown' });
    expect(getCachedEmailAvailability('flaky@example.com')).toBeUndefined();
    await checkEmailAvailability('flaky@example.com');
    expect(
      vi.mocked(checkLogin).mock.calls.filter((c) => c[0] === 'flaky@example.com'),
    ).toHaveLength(2);
  });

  it("a 400 that is not about availability ('ValidateError/...') caches as 'unknown', not as taken", async () => {
    // Отказ по значению (в т.ч. по realm'у) к емаилу отношения не имеет: выдать его за занятость
    // значило бы навсегда — исход кэшируется — запретить пользователю его собственный адрес.
    vi.mocked(checkLogin).mockRejectedValue(
      new ApiFieldError([{ code: 'ValidateError/realm', detail: 'Realm not found' }], 400),
    );

    expect(await checkEmailAvailability('user@example.com')).toEqual({ state: 'unknown' });
    expect(getCachedEmailAvailability('user@example.com')).toBeUndefined();
  });
});
