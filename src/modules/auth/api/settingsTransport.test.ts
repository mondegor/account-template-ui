import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { config } from '@config';
import { server } from '@mocks/server';

/**
 * Транспорт настроек: что уходит на сервер при сохранении (POST /v1/user/settings) и при
 * регистрации, и что применяется после ответа. Заголовок X-Accept-Time-Zone здесь ключевой —
 * он единственный источник пояса и уходит ровно в двух местах, а не со всеми запросами.
 *
 * Модули грузим заново на каждый кейс — язык, оверрайд и стор токена живут в модульных
 * переменных. Обработчики локальные: важно не поведение мока, а то, что уходит из клиента.
 */

const BASE = config.authApiBaseUrl;

interface Sent {
  body: unknown;
  tzHeader: string | null;
  query: URLSearchParams;
}

async function load(saved: { lang: string; tz: string }) {
  vi.resetModules();
  localStorage.clear();
  const i18n = await import('@core/i18n');
  i18n.initI18n();
  const auth = await import('@core/auth');
  const requestMeta = await import('@core/request-meta');
  const { changeUserSettings } = await import('./authApi');

  auth.useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'access',
    expiresAt: null,
  });

  const sent: Sent[] = [];
  server.use(
    http.post(`${BASE}/v1/user/settings`, async ({ request }) => {
      sent.push({
        body: await request.json(),
        tzHeader: request.headers.get('X-Accept-Time-Zone'),
        query: new URL(request.url).searchParams,
      });
      // Сервер отвечает СОХРАНЁННЫМИ значениями: в режиме «Авто» — подобранными им самим.
      return HttpResponse.json(saved);
    }),
  );

  return { ...i18n, ...requestMeta, changeUserSettings, sent };
}

describe('changeUserSettings: что уходит на сервер', () => {
  it('«Авто» по поясу → поля tz в теле нет, пояс уезжает заголовком', async () => {
    const { changeUserSettings, sent } = await load({ lang: 'ru-RU', tz: 'Europe/Moscow' });

    await changeUserSettings({ lang: 'ru-RU' });

    expect(sent[0]!.body).toEqual({ lang: 'ru-RU' });
    expect(sent[0]!.tzHeader).toMatch(/^[\w/+-]+;offset=[+-]\d{2}:\d{2};dst=[01]$/);
  });

  it('явный пояс → уходит телом, заголовок не собираем (тело всё равно строже)', async () => {
    const { changeUserSettings, sent } = await load({ lang: 'ru-RU', tz: 'Asia/Tokyo' });

    await changeUserSettings({ lang: 'ru-RU', tz: 'Asia/Tokyo' });

    expect(sent[0]!.body).toEqual({ lang: 'ru-RU', tz: 'Asia/Tokyo' });
    expect(sent[0]!.tzHeader).toBeNull();
  });

  it('«Авто» по обоим → тело пустое, пустых строк в нём нет', async () => {
    const { changeUserSettings, sent } = await load({ lang: 'en-US', tz: 'Asia/Tokyo' });

    await changeUserSettings({});

    expect(sent[0]!.body).toEqual({});
  });

  it('оверрайд прошлого сохранения на этот запрос не уходит — иначе «Авто» вернуло бы старое', async () => {
    const { changeUserSettings, setSettingsOverride, sent } = await load({
      lang: 'ru-RU',
      tz: 'Europe/Moscow',
    });
    setSettingsOverride({ lang: 'en-US', tz: 'Asia/Tokyo' });

    await changeUserSettings({});

    expect(sent[0]!.query.get('lang')).toBeNull();
    expect(sent[0]!.query.get('tz')).toBeNull();
  });

  it('язык навигации на этом запросе, наоборот, остаётся: это и есть текущее окружение', async () => {
    const { changeUserSettings, setLanguage, sent } = await load({
      lang: 'en-US',
      tz: 'Europe/Moscow',
    });
    setLanguage('en');

    await changeUserSettings({});

    expect(sent[0]!.query.get('lang')).toBe('en-US');
  });
});

describe('X-Accept-Time-Zone: где заголовок нужен, а где его быть не должно', () => {
  it('signup несёт пояс заголовком (его ставит интерсептор), тело — только realm и user_email', async () => {
    vi.resetModules();
    const { signup } = await import('./authApi');

    let sent: { body: unknown; tzHeader: string | null; corrId: string | null } | undefined;
    server.use(
      http.post(`${BASE}/v1/signup`, async ({ request }) => {
        sent = {
          body: await request.json(),
          tzHeader: request.headers.get('X-Accept-Time-Zone'),
          corrId: request.headers.get('X-Correlation-Id'),
        };
        return HttpResponse.json({
          token: 'a'.repeat(64),
          confirm_method: 'EMAIL',
          remaining_attempts: 3,
          expires_in: 600,
        });
      }),
    );

    await signup('new@example.com');

    expect(sent!.tzHeader).toMatch(/^[\w/+-]+;offset=[+-]\d{2}:\d{2};dst=[01]$/);
    expect(sent!.body).toEqual({ realm: config.realm, user_email: 'new@example.com' });
    // Per-request headers не вытесняют общие: интерсептор ставит их поверх уже слитых axios'ом.
    expect(sent!.corrId).toBeTruthy();
  });

  it('гостю заголовок уходит на любом запросе, авторизованному — ни на одном', async () => {
    vi.resetModules();
    const { signin, openSession, getUserInfo } = await import('./authApi');
    const auth = await import('@core/auth');
    (await import('@core/i18n')).initI18n();

    const headers: (string | null)[] = [];
    const push = (request: Request) => headers.push(request.headers.get('X-Accept-Time-Zone'));
    const waiting = {
      token: 'a'.repeat(64),
      confirm_method: 'EMAIL',
      remaining_attempts: 3,
      expires_in: 600,
    };
    server.use(
      http.post(`${BASE}/v1/signin`, ({ request }) => {
        push(request);
        return HttpResponse.json(waiting);
      }),
      http.post(`${BASE}/v1/session`, ({ request }) => {
        push(request);
        return HttpResponse.json(waiting);
      }),
      http.get(`${BASE}/v1/user`, ({ request }) => {
        push(request);
        return HttpResponse.json({ email: 'user@example.com', lang: 'ru-RU', tz: 'Europe/Moscow' });
      }),
    );

    // Гость: пояс брать больше неоткуда — заголовок наш, браузер его не поставит.
    await signin('user@example.com');
    await openSession({ token: 'a'.repeat(64), secret: '183947' });
    const tz = /^[\w/+-]+;offset=[+-]\d{2}:\d{2};dst=[01]$/;
    expect(headers[0]).toMatch(tz);
    expect(headers[1]).toMatch(tz);

    // С токеном заголовок бессмыслен: по приоритету спеки токен старше него.
    auth.useAuthStore.setState({ status: 'authenticated', accessToken: 'access', expiresAt: null });
    await getUserInfo();
    expect(headers[2]).toBeNull();
  });
});

describe('changeUserSettings: что применяется после ответа', () => {
  it('в оверрайд окна кладём значения ИЗ ОТВЕТА (в «Авто» они подобраны сервером)', async () => {
    const { changeUserSettings, getSettingsOverride } = await load({
      lang: 'en-US',
      tz: 'Asia/Tokyo',
    });

    await changeUserSettings({});

    expect(getSettingsOverride()).toEqual({ lang: 'en-US', tz: 'Asia/Tokyo' });
  });

  it('язык интерфейса подтягивается из ответа', async () => {
    const { changeUserSettings, getLanguage, getLanguageSource } = await load({
      lang: 'en-US',
      tz: 'Europe/Moscow',
    });

    await changeUserSettings({ lang: 'en-US' });

    expect(getLanguage()).toBe('en');
    expect(getLanguageSource()).toBe('profile');
  });

  it('сохранение НЕ перебивает язык, выбранный в навигации', async () => {
    const { changeUserSettings, setLanguage, getLanguage, getLanguageSource } = await load({
      lang: 'ru-RU',
      tz: 'Europe/Moscow',
    });
    setLanguage('en');

    await changeUserSettings({ lang: 'ru-RU' });

    // На сервере теперь русский профиль (язык писем), а интерфейс остаётся на выбранном английском.
    expect(getLanguage()).toBe('en');
    expect(getLanguageSource()).toBe('local');
  });
});
