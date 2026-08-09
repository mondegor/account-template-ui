import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { config } from '@config';
import { server } from '@mocks/server';

/**
 * `?lang` / `?tz` в запросах. Матрица «источник языка × есть ли токен» плюс окно после сохранения:
 * параметр должен уходить ровно там, где токен или заголовок окружения дали бы не то, и не
 * мешаться в остальное время. Правило у языка и пояса общее — у пояса пока нет только ветки
 * «выбор в навигации», потому что и переключателя такого пока нет.
 *
 * Модули грузим заново на каждый кейс: и выбор языка, и оверрайд живут в модульных переменных,
 * поэтому без сброса состояние протекало бы между тестами (localStorage.clear() его не трогает).
 * Инстанс MSW-сервера при этом общий — он перехватывает запросы любого axios-клиента.
 */

const BASE = config.authApiBaseUrl;

async function load() {
  vi.resetModules();
  localStorage.clear();
  const i18n = await import('@core/i18n');
  const auth = await import('@core/auth');
  const { authClient } = await import('./httpClient');
  const requestMeta = await import('@core/request-meta');

  const seen: URL[] = [];
  server.use(
    http.get(`${BASE}/v1/user`, ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json({ ok: true });
    }),
  );

  /** Делает запрос и возвращает его query. */
  const call = async (cfg?: Parameters<typeof authClient.get>[1]) => {
    await authClient.get('/v1/user', cfg);
    return seen[seen.length - 1]!.searchParams;
  };

  const authenticate = () =>
    auth.useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'access',
      expiresAt: null,
    });

  return { ...i18n, ...requestMeta, call, authenticate };
}

describe('interceptor: ?lang by language source', () => {
  it('auto: we send nothing, the language comes from the browser Accept-Language', async () => {
    const { call, authenticate } = await load();
    expect((await call()).get('lang')).toBeNull();

    authenticate();
    expect((await call()).get('lang')).toBeNull();
  });

  it('local: sent both for a guest (email language) and for an authenticated user (preview)', async () => {
    const { call, authenticate, setLanguage } = await load();
    setLanguage('en');
    expect((await call()).get('lang')).toBe('en-US');

    authenticate();
    expect((await call()).get('lang')).toBe('en-US');
  });

  it('profile: sent for a guest (no token), not for an authenticated user (the token carries the language)', async () => {
    const { call, authenticate, setProfileLanguage } = await load();
    setProfileLanguage('en');
    expect((await call()).get('lang')).toBe('en-US');

    authenticate();
    expect((await call()).get('lang')).toBeNull();
  });
});

describe('interceptor: the window after settings are saved', () => {
  it('the override sends both params: texts and dates in them are already the new ones', async () => {
    const { call, authenticate, setSettingsOverride } = await load();
    authenticate();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });

    const params = await call();
    expect(params.get('lang')).toBe('en-US');
    expect(params.get('tz')).toBe('Asia/Tokyo');
  });

  it('the navigation language beats the override language, while the window time zone stays', async () => {
    const { call, authenticate, setSettingsOverride, setLanguage } = await load();
    authenticate();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });
    setLanguage('ru');

    const params = await call();
    expect(params.get('lang')).toBe('ru-RU');
    expect(params.get('tz')).toBe('Asia/Tokyo');
  });

  it('no override for a guest: it is about a token they do not have', async () => {
    const { call, setSettingsOverride } = await load();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });

    const params = await call();
    expect(params.get('lang')).toBeNull();
    expect(params.get('tz')).toBeNull();
  });

  it('skipSettingsOverride drops the override but not the navigation language', async () => {
    const { call, authenticate, setSettingsOverride, setLanguage } = await load();
    authenticate();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });
    setLanguage('ru');

    const params = await call({ skipSettingsOverride: true });
    // Сам POST /v1/user/settings в режиме «Авто» подбирает настройки по запросу, поэтому старые
    // значения там подменили бы подбор; язык навигации, наоборот, и есть «текущее окружение».
    expect(params.get('lang')).toBe('ru-RU');
    expect(params.get('tz')).toBeNull();
  });

  it('clearSettingsOverride (called by applyAccess) removes both params', async () => {
    const { call, authenticate, setSettingsOverride, clearSettingsOverride } = await load();
    authenticate();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });
    clearSettingsOverride();

    const params = await call();
    expect(params.get('lang')).toBeNull();
    expect(params.get('tz')).toBeNull();
  });
});

describe('interceptor: params and headers that are not ours', () => {
  it('explicit caller params survive the interceptor (realm in getUserSessions)', async () => {
    const { call, authenticate, setLanguage } = await load();
    authenticate();
    setLanguage('en');

    const params = await call({ params: { realm: 'print-shop/admin' } });
    expect(params.get('realm')).toBe('print-shop/admin');
    expect(params.get('lang')).toBe('en-US');
  });

  it('?tz never appears on its own, only through the window after saving', async () => {
    const { call, authenticate, setLanguage } = await load();
    authenticate();
    setLanguage('en');

    expect((await call()).get('tz')).toBeNull();
  });

  it('the shared headers carry neither X-Accept-Time-Zone nor Accept-Language', async () => {
    const { commonHeaders } = await load();
    // Пояс уходит точечно (регистрация и сохранение в «Авто»), а язык окружения ставит сам
    // браузер: подменять его выбранным языком интерфейса нельзя — сервер читает его как раз там,
    // где нужно окружение.
    expect(Object.keys(commonHeaders())).toEqual(['X-Correlation-Id']);
  });
});
