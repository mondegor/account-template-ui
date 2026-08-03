import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { config } from '@config';
import { server } from '@mocks/server';
import { forceLogout, useAuthStore } from '@core/auth';
import { authClient } from './httpClient';

/**
 * 401-интерсептор: single-flight refresh + один повтор запроса. Проверяем именно выбор пути: он
 * сверяется точно, а не по префиксу, поэтому `/v1/sessions` (список устройств) — обычный
 * защищённый ресурс и подлежит продлению.
 */

const BASE = config.authApiBaseUrl;

/** Отдаёт 401 на первый вызов и 200 — на повтор с новым access. */
function protectedOnce(method: 'get' | 'post' | 'patch', path: string, calls: (string | null)[]) {
  return http[method](`${BASE}${path}`, ({ request }) => {
    const auth = request.headers.get('Authorization');
    calls.push(auth);
    if (auth !== 'Bearer fresh') {
      return HttpResponse.json(
        { title: 'Unauthorized', status: 401 },
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }
    return HttpResponse.json({ ok: true });
  });
}

/** PATCH /v1/session — единственная точка продления; считаем, сколько раз её дёрнули. */
function refreshHandler(patches: string[]) {
  return http.patch(`${BASE}/v1/session`, () => {
    patches.push('patch');
    return HttpResponse.json({ access_token: 'fresh', expires_in: 1800 }, { status: 201 });
  });
}

describe('authClient: 401 → refresh → повтор', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'stale', expiresAt: null });
  });

  afterEach(() => {
    // Снимает проактивный таймер, который поставил успешный refresh.
    forceLogout();
  });

  it('401 на GET /v1/sessions продлевает сессию и повторяет запрос с новым access', async () => {
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), protectedOnce('get', '/v1/sessions', calls));

    const res = await authClient.get('/v1/sessions', { params: { realm: 'print-shop/admin' } });

    expect(res.status).toBe(200);
    expect(patches).toHaveLength(1);
    expect(calls).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('401 на POST /v1/sessions/close тоже продлевается: это защищённый ресурс, а не выход', async () => {
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), protectedOnce('post', '/v1/sessions/close', calls));

    await authClient.post('/v1/sessions/close', { session_ids: ['aaaaaaaa'] });

    expect(patches).toHaveLength(1);
    expect(calls).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('401 на POST /v1/session (открытие сессии) refresh НЕ запускает', async () => {
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), protectedOnce('post', '/v1/session', calls));

    await expect(authClient.post('/v1/session', { token: 'x', secret: '1' })).rejects.toThrow();

    expect(patches).toEqual([]);
    expect(calls).toEqual(['Bearer stale']);
  });

  it('401 на PATCH /v1/operation/revoke продлевается: отзыв доступен авторизованному', async () => {
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), protectedOnce('patch', '/v1/operation/revoke', calls));

    await authClient.patch('/v1/operation/revoke', { token: 'x' });

    expect(patches).toHaveLength(1);
    expect(calls).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('401 на PATCH /v1/operation/confirm refresh НЕ запускает: метод гостевой', async () => {
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), protectedOnce('patch', '/v1/operation/confirm', calls));

    await expect(authClient.patch('/v1/operation/confirm', { token: 'x' })).rejects.toThrow();

    expect(patches).toEqual([]);
    expect(calls).toEqual(['Bearer stale']);
  });

  it('401 на POST /v1/signin refresh НЕ запускает (guests-only)', async () => {
    const patches: string[] = [];
    const calls: (string | null)[] = [];
    server.use(refreshHandler(patches), protectedOnce('post', '/v1/signin', calls));

    await expect(authClient.post('/v1/signin', { login: 'user@example.com' })).rejects.toThrow();

    expect(patches).toEqual([]);
    expect(calls).toEqual(['Bearer stale']);
  });
});
