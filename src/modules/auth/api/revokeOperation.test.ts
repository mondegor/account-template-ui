import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { config } from '@config';
import { server } from '@mocks/server';
import { forceLogout, useAuthStore } from '@core/auth';
import { revokeOperation } from './authApi';

/**
 * Отмена операции — единственный метод операции класса any-users, то есть требующий токена.
 * У авторизованного (отмена смены емаила/пароля) 401 означает протухший access — сессия
 * продлевается и запрос повторяется. Гость (кнопка «Отменить» на подтверждении входа
 * и регистрации) права на отзыв не имеет, поэтому в сеть не ходим вовсе.
 */

const BASE = config.authApiBaseUrl;

/** Отзыв: 204 только по свежему токену, иначе 401 — как у бэка с bearer. */
function revokeHandler(calls: (string | null)[]) {
  return http.patch(`${BASE}/v1/operation/revoke`, ({ request }) => {
    const auth = request.headers.get('Authorization');
    calls.push(auth);
    if (auth !== 'Bearer fresh') {
      return HttpResponse.json(
        { title: 'Unauthorized', status: 401 },
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }
    return new HttpResponse(null, { status: 204 });
  });
}

function refreshHandler(patches: string[]) {
  return http.patch(`${BASE}/v1/session`, () => {
    patches.push('patch');
    return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
  });
}

describe('revokeOperation', () => {
  afterEach(() => {
    // Снимает проактивный таймер, который поставил успешный refresh.
    forceLogout();
  });

  it('for an authenticated user a 401 means a stale access token: the session is refreshed and the revoke retried', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'stale', expiresAt: null });
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), revokeHandler(calls));

    await revokeOperation({ token: 'x' });

    expect(patches).toHaveLength(1);
    expect(calls).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('for a guest there is no request at all: they have nothing to revoke with, a 401 would be guaranteed', async () => {
    useAuthStore.setState({ status: 'anonymous', accessToken: null, expiresAt: null });
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), revokeHandler(calls));

    await expect(revokeOperation({ token: 'x' })).resolves.toBeUndefined();

    expect(calls).toEqual([]);
    expect(patches).toEqual([]);
  });
});
