import { beforeEach, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { config } from '@config';
import { server } from '@mocks/server';
import { authClient } from '@core/api';
import { logout } from './refresh';
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

describe('logout', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'stale', expiresAt: null });
  });

  it('401 на DELETE → продление и повтор: серверная сессия не переживает выход', async () => {
    const deletes: (string | null)[] = [];
    const patches: string[] = [];
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        patches.push('patch');
        return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 });
      }),
      deleteHandler(deletes),
    );

    await logout();

    expect(patches).toHaveLength(1);
    expect(deletes).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('живой access → один DELETE, без лишнего продления', async () => {
    const deletes: (string | null)[] = [];
    const patches: string[] = [];
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        patches.push('patch');
        return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 });
      }),
      deleteHandler(deletes, 'stale'),
    );

    await logout();

    expect(patches).toEqual([]);
    expect(deletes).toEqual(['Bearer stale']);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('продлить не удалось → повторного DELETE нет, но вкладка всё равно анонимна', async () => {
    const deletes: (string | null)[] = [];
    server.use(
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

  it('401 в параллельном запросе во время выхода не продлевает сессию', async () => {
    const patches: string[] = [];
    server.use(
      http.patch(`${BASE}/v1/session`, () => {
        patches.push('patch');
        return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 });
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

    // Продление внутри grace-окна вернуло бы 200, applyAccess() снова выставил бы authenticated —
    // вкладка осталась бы «залогиненной» с сессией, которую сервер уже закрыл.
    expect(patches).toEqual([]);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('сервер недоступен → клиентскую очистку всё равно доводим до конца', async () => {
    server.use(http.delete(`${BASE}/v1/session`, () => HttpResponse.error()));

    await logout();

    expect(useAuthStore.getState().status).toBe('anonymous');
  });
});
