import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { config } from '@config';
import { server } from '@mocks/server';
import { authClient } from '@core/api';
import { getLanguage, getLanguageSource, setLanguage, setProfileLanguage } from '@core/i18n';
import { getSettingsOverride, setSettingsOverride } from '@core/request-meta';
import { applyAccess, forceLogout, logout, onSessionRecovered, refresh } from './refresh';
import { useAuthStore } from './authStore';

/**
 * Осознанный выход. Ключевой инвариант: клиент чистится только после того, как серверная сессия
 * действительно закрыта. Протухший access (вкладка проснулась после сна) даёт 401 на DELETE —
 * проглотить его нельзя: cookie RTID осталась бы валидной и silent-refresh после reload вернул бы
 * пользователя обратно.
 */

const BASE = config.authApiBaseUrl;

/** DELETE отвечает 204 только на свежий access; на любом другом — 401, как настоящий сервер. */
function deleteHandler(calls: (string | null)[], validAccess = 'fresh') {
  return http.delete(`${BASE}/v1/session`, ({ request }) => {
    const auth = request.headers.get('Authorization');
    calls.push(auth);
    if (auth !== `Bearer ${validAccess}`) {
      return HttpResponse.json(
        { title: 'Unauthorized', status: 401 },
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }
    return new HttpResponse(null, { status: 204 });
  });
}

describe('applyAccess', () => {
  it('drops the settings override: the new token carries the language and time zone itself', () => {
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });

    applyAccess({ access_token: 'fresh', expires_in: 1800 });

    expect(getSettingsOverride()).toEqual({ lang: null, tz: null });
    forceLogout();
  });
});

describe('forceLogout', () => {
  it("forgets the profile language: otherwise the next user's email goes out in the language of the one who left", () => {
    setProfileLanguage('en');

    forceLogout();

    expect(getLanguageSource()).toBe('auto');
  });

  it('drops the settings override: the drift window belongs to the session that ended', () => {
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });

    forceLogout();

    expect(getSettingsOverride()).toEqual({ lang: null, tz: null });
  });

  it('the shell language choice survives sign-out: it is about the device, not the user', () => {
    setLanguage('en');

    forceLogout();

    expect(getLanguage()).toBe('en');
    expect(getLanguageSource()).toBe('local');
    localStorage.clear();
  });
});

/**
 * Отказ продления разбирается по причине. `401` (refresh неизвестен, истёк или использован) и `400`
 * (токена в запросе нет) неисправимы — нужен новый вход. `5xx` и недоехавший запрос про сам токен
 * не говорят ничего: серверная сессия жива, и ронять из-за них вкладку нельзя — продление идёт
 * фоном, по таймеру, так что пользователь потерял бы страницу на ровном месте.
 */
describe('session refresh: how a failure is read', () => {
  /** Отказ `PATCH /v1/session`; тела с кодом ошибки не-400 ответы не несут. */
  function patchFails(status: number, calls: string[]) {
    return http.patch(`${BASE}/v1/session`, () => {
      calls.push('patch');
      return HttpResponse.json(
        { title: 'Error', status },
        { status, headers: { 'Content-Type': 'application/problem+json' } },
      );
    });
  }

  function patchRenews(calls: string[]) {
    return http.patch(`${BASE}/v1/session`, () => {
      calls.push('patch');
      return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
    });
  }

  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'stale', expiresAt: null });
  });

  afterEach(() => {
    // Гасит и проактивный таймер, и цикл повторов: оба живут в модуле и утекли бы в соседний тест.
    forceLogout();
    vi.useRealTimers();
  });

  it('401: sign out at once, no retries', async () => {
    const calls: string[] = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(patchFails(401, calls));

    expect(await refresh()).toBe(false);
    expect(useAuthStore.getState().status).toBe('anonymous');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it('5xx: we keep the session, retry later and see it through', async () => {
    const calls: string[] = [];
    let broken = true;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        calls.push('patch');
        if (!broken) {
          return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
        }
        return HttpResponse.json(
          { title: 'Service error', status: 503 },
          { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }),
    );

    expect(await refresh()).toBe(false);
    // Главное: сессия на месте. Access остался прежним — он ещё жив, продление шло на опережение.
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().accessToken).toBe('stale');
    expect(calls).toHaveLength(1);

    // Пока взведена пауза, запроса нет: иначе каждый висящий 401 стартовал бы свой.
    expect(await refresh()).toBe(false);
    expect(calls).toHaveLength(1);

    broken = false;
    await vi.advanceTimersByTimeAsync(2000);

    expect(calls).toHaveLength(2);
    expect(useAuthStore.getState().accessToken).toBe('fresh');
  });

  it('no network is a transient failure too, not a sign-out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(http.patch(`${BASE}/v1/session`, () => HttpResponse.error()));

    expect(await refresh()).toBe(false);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('the loop stops once the refresh token expires while the server was down', async () => {
    const calls: string[] = [];
    let status = 503;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        calls.push('patch');
        return HttpResponse.json(
          { title: 'Error', status },
          { status, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }),
    );

    await refresh();
    expect(useAuthStore.getState().status).toBe('authenticated');

    status = 401;
    await vi.advanceTimersByTimeAsync(2000);

    expect(calls).toHaveLength(2);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  /**
   * Стартовая проба (main.tsx) — единственный вызов продления без открытой сессии. Цикл там не
   * нужен и вреден: восстанавливать нечего, а поздний успех залогинил бы гостя, который уже стоит
   * на /signin и, возможно, набирает чужой логин.
   */
  it('the initial probe without an access token does not start the retry loop', async () => {
    const calls: string[] = [];
    useAuthStore.setState({ status: 'unknown', accessToken: null, expiresAt: null });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(patchFails(503, calls));

    expect(await refresh()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(calls).toHaveLength(1);
  });

  it('a successful refresh resets the backoff counter', async () => {
    const calls: string[] = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(patchRenews(calls));

    expect(await refresh()).toBe(true);
    // Повтор не взведён — следующий вызов уходит в сеть сразу, а не ждёт паузы.
    expect(await refresh()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  /**
   * Пока цикл повторов крутился, продлить было нечем, и запросы этого времени отбились 401-ми.
   * Их результат осел у вызывающего (react-query, retry выключен) как ошибка и сам не переиграется,
   * поэтому о возвращении сессии нужно сказать наружу. Штатное продление молчит: там терять нечего.
   */
  describe('recovery notification', () => {
    it('success AFTER a retry loop notifies exactly once', async () => {
      let broken = true;
      const recovered = vi.fn();
      const off = onSessionRecovered(recovered);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      server.use(
        http.patch(`${BASE}/v1/session`, () => {
          if (!broken) {
            return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
          }
          return HttpResponse.json(
            { title: 'Service error', status: 503 },
            { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }),
      );

      await refresh();
      expect(recovered).not.toHaveBeenCalled();

      broken = false;
      await vi.advanceTimersByTimeAsync(2000);

      expect(useAuthStore.getState().accessToken).toBe('fresh');
      expect(recovered).toHaveBeenCalledTimes(1);
      off();
    });

    it('a first-try refresh wakes nobody', async () => {
      const recovered = vi.fn();
      const off = onSessionRecovered(recovered);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      server.use(patchRenews([]));

      expect(await refresh()).toBe(true);

      expect(recovered).not.toHaveBeenCalled();
      off();
    });
  });
});

describe('logout', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'stale', expiresAt: null });
  });

  it('401 on DELETE: refresh and retry, the server-side session must not outlive the sign-out', async () => {
    const deletes: (string | null)[] = [];
    const patches: string[] = [];
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        patches.push('patch');
        return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
      }),
      deleteHandler(deletes),
    );

    await logout();

    expect(patches).toHaveLength(1);
    expect(deletes).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('a live access token: a single DELETE, no extra refresh', async () => {
    const deletes: (string | null)[] = [];
    const patches: string[] = [];
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        patches.push('patch');
        return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
      }),
      deleteHandler(deletes, 'stale'),
    );

    await logout();

    expect(patches).toEqual([]);
    expect(deletes).toEqual(['Bearer stale']);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('refresh failed: no second DELETE, but the tab still becomes anonymous', async () => {
    const deletes: (string | null)[] = [];
    server.use(
      // Продление отказывает по 401: refresh токен неизвестен, истёк или уже использован. Тела с
      // кодом ошибки у 401 нет — причина задана самим методом.
      http.patch(`${BASE}/v1/session`, () =>
        HttpResponse.json(
          { title: 'Unauthorized', status: 401 },
          { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
      deleteHandler(deletes),
    );

    await logout();

    expect(deletes).toEqual(['Bearer stale']);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('a 401 from a parallel request during sign-out does not refresh the session', async () => {
    const patches: string[] = [];
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        patches.push('patch');
        return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
      }),
      // 401 от уже закрытой сессии — ровно то, что вернёт бэк смонтированной странице.
      http.get(`${BASE}/v1/user`, () =>
        HttpResponse.json(
          { title: 'Unauthorized', status: 401 },
          { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
      // DELETE отвечает не мгновенно: 401 стороннего запроса приходит, пока выход ещё идёт.
      http.delete(`${BASE}/v1/session`, async () => {
        await delay(20);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const out = logout();
    const stray = authClient.get('/v1/user').catch(() => undefined);
    await Promise.all([out, stray]);

    // Продление внутри grace-окна вернуло бы 201, applyAccess() снова выставил бы authenticated —
    // вкладка осталась бы «залогиненной» с сессией, которую сервер уже закрыл.
    expect(patches).toEqual([]);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('the server is unreachable: the client-side cleanup is still carried through', async () => {
    server.use(http.delete(`${BASE}/v1/session`, () => HttpResponse.error()));

    await logout();

    expect(useAuthStore.getState().status).toBe('anonymous');
  });
});
