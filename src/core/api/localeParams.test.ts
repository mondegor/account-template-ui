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
  const { commonHeaders } = await import('./commonHeaders');
  const override = await import('./settingsOverride');

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

  return { ...i18n, ...override, commonHeaders, call, authenticate };
}

describe('интерсептор: ?lang по источнику языка', () => {
  it('auto: не шлём ничего — язык берёт браузерный Accept-Language', async () => {
    const { call, authenticate } = await load();
    expect((await call()).get('lang')).toBeNull();

    authenticate();
    expect((await call()).get('lang')).toBeNull();
  });

  it('local: шлём и гостю (язык письма), и авторизованному (предпросмотр)', async () => {
    const { call, authenticate, setLanguage } = await load();
    setLanguage('en');
    expect((await call()).get('lang')).toBe('en-US');

    authenticate();
    expect((await call()).get('lang')).toBe('en-US');
  });

  it('profile: гостю шлём (токена нет), авторизованному — нет (язык несёт токен)', async () => {
    const { call, authenticate, setProfileLanguage } = await load();
    setProfileLanguage('en');
    expect((await call()).get('lang')).toBe('en-US');

    authenticate();
    expect((await call()).get('lang')).toBeNull();
  });
});

describe('интерсептор: окно после сохранения настроек', () => {
  it('оверрайд шлёт оба параметра: тексты и даты в них — уже новые', async () => {
    const { call, authenticate, setSettingsOverride } = await load();
    authenticate();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });

    const params = await call();
    expect(params.get('lang')).toBe('en-US');
    expect(params.get('tz')).toBe('Asia/Tokyo');
  });

  it('язык навигации перебивает язык оверрайда, пояс окна при этом остаётся', async () => {
    const { call, authenticate, setSettingsOverride, setLanguage } = await load();
    authenticate();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });
    setLanguage('ru');

    const params = await call();
    expect(params.get('lang')).toBe('ru-RU');
    expect(params.get('tz')).toBe('Asia/Tokyo');
  });

  it('гостю оверрайд не шлём: он про токен, которого нет', async () => {
    const { call, setSettingsOverride } = await load();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });

    const params = await call();
    expect(params.get('lang')).toBeNull();
    expect(params.get('tz')).toBeNull();
  });

  it('skipSettingsOverride снимает оверрайд, но не язык навигации', async () => {
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

  it('clearSettingsOverride (его зовёт applyAccess) убирает оба параметра', async () => {
    const { call, authenticate, setSettingsOverride, clearSettingsOverride } = await load();
    authenticate();
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });
    clearSettingsOverride();

    const params = await call();
    expect(params.get('lang')).toBeNull();
    expect(params.get('tz')).toBeNull();
  });
});

describe('интерсептор: чужие параметры и заголовки', () => {
  it('явные params вызывающего переживают интерсептор (realm у getUserSessions)', async () => {
    const { call, authenticate, setLanguage } = await load();
    authenticate();
    setLanguage('en');

    const params = await call({ params: { realm: 'print-shop/admin' } });
    expect(params.get('realm')).toBe('print-shop/admin');
    expect(params.get('lang')).toBe('en-US');
  });

  it('?tz не появляется сам по себе — только окном после сохранения', async () => {
    const { call, authenticate, setLanguage } = await load();
    authenticate();
    setLanguage('en');

    expect((await call()).get('tz')).toBeNull();
  });

  it('в общих заголовках нет ни X-Accept-Time-Zone, ни Accept-Language', async () => {
    const { commonHeaders } = await load();
    // Пояс уходит точечно (регистрация и сохранение в «Авто»), а язык окружения ставит сам
    // браузер: подменять его выбранным языком интерфейса нельзя — сервер читает его как раз там,
    // где нужно окружение.
    expect(Object.keys(commonHeaders())).toEqual(['X-Correlation-Id']);
  });
});
