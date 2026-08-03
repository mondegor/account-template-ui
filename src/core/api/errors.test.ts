import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { TFunction } from 'i18next';
import { config } from '@config';
import { server } from '@mocks/server';
import {
  ApiFieldError,
  ApiProblemError,
  ApiRateLimitError,
  ApiTransportError,
  apiErrorText,
  parseErrorCode,
} from './errors';
import { authClient } from './httpClient';

/**
 * Разбор ответов об ошибке по спеке: форма `code` в 400 и отдельная ветка 429.
 * Ходим через authClient — normalizeError живёт в его response-интерсепторе, и проверять
 * его отдельно от интерсептора значило бы проверять не тот путь, которым ошибки доезжают до UI.
 */

const BASE = config.authApiBaseUrl;

/**
 * Переводы здесь не проверяются — важно лишь, ЧТО берётся из них, а не из кода, и с какими
 * аргументами. Поэтому заглушка возвращает сам ключ, дописывая `count`, когда он передан:
 * выбор ключа и число в нём — это и есть проверяемое поведение.
 */
const t = ((key: string, opts?: { count?: number }) =>
  opts?.count === undefined ? key : `${key}(${opts.count})`) as unknown as TFunction;

function error400(errors: { code: string; detail: string }[]) {
  return http.post(`${BASE}/v1/signup`, () =>
    HttpResponse.json(
      { status: 400, instance: '', errors, time: new Date().toISOString() },
      { status: 400 },
    ),
  );
}

function error429(retryAfter?: string) {
  return http.post(`${BASE}/v1/signup`, () =>
    HttpResponse.json(
      {
        title: 'Too Many Requests',
        status: 429,
        detail: 'Повторите позже',
        instance: '',
        time: new Date().toISOString(),
      },
      {
        status: 429,
        headers: {
          'Content-Type': 'application/problem+json;charset=UTF-8',
          ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
        },
      },
    ),
  );
}

describe('parseErrorCode', () => {
  it('код без суффикса — отказ по существу, поля у него нет', () => {
    expect(parseErrorCode('ErrorCode')).toEqual({ reason: 'ErrorCode' });
  });

  it('код с суффиксом — причина и имя поля запроса', () => {
    expect(parseErrorCode('EmailAlreadyExists/user_email')).toEqual({
      reason: 'EmailAlreadyExists',
      field: 'user_email',
    });
  });

  it('режет по ПЕРВОМУ слэшу: остаток целиком считается именем поля', () => {
    expect(parseErrorCode('ValidateError/realm/extra')).toEqual({
      reason: 'ValidateError',
      field: 'realm/extra',
    });
  });

  it('пустой суффикс полем не считается — поля с пустым именем в запросе нет', () => {
    expect(parseErrorCode('ValidateError/')).toEqual({ reason: 'ValidateError' });
  });
});

describe('ApiFieldError.split: раскладка по полям формы', () => {
  it('под поле садится только совпавший суффикс, остальное — общим сообщением', async () => {
    server.use(
      error400([
        { code: 'ValidateError/user_email', detail: 'Некорректный емаил' },
        { code: 'ErrorCode', detail: 'Отказано по существу' },
        { code: 'ValidateError/realm', detail: 'Realm не найден' },
      ]),
    );

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiFieldError);
    // В форме есть только user_email: отказ по существу и ошибка по чужому полю класть некуда.
    const { byField, global } = (err as ApiFieldError).split(new Set(['user_email']), t);
    expect(byField).toEqual([{ name: 'user_email', detail: 'Некорректный емаил' }]);
    expect(global).toBe('Отказано по существу Realm не найден');
  });

  it('форма без единого совпавшего поля — всё уходит в общее сообщение, ничего не теряется', async () => {
    server.use(error400([{ code: 'ValidateError/user_email', detail: 'Некорректный емаил' }]));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    const { byField, global } = (err as ApiFieldError).split(new Set(['user_login']), t);
    expect(byField).toEqual([]);
    expect(global).toBe('Некорректный емаил');
  });

  it('глобальных ошибок не было — общего сообщения нет вовсе', async () => {
    server.use(error400([{ code: 'ValidateError/user_email', detail: 'Некорректный емаил' }]));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect((err as ApiFieldError).split(new Set(['user_email']), t).global).toBeUndefined();
  });

  it('две причины по одному полю склеиваются в одну запись — вторая не затирает первую', async () => {
    server.use(
      error400([
        { code: 'ValidateError/user_email', detail: 'Слишком длинный.' },
        { code: 'EmailAlreadyExists/user_email', detail: 'Уже занят.' },
      ]),
    );

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    // Место под полем одно: отдай split() две записи, потребитель показал бы только последнюю.
    expect((err as ApiFieldError).split(new Set(['user_email']), t).byField).toEqual([
      { name: 'user_email', detail: 'Слишком длинный. Уже занят.' },
    ]);
  });

  it('глобальная ошибка с пустым detail → перевод, а не пустая строка (иначе тишина в UI)', async () => {
    server.use(error400([{ code: 'ErrorCode', detail: '' }]));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect((err as ApiFieldError).split(new Set(['user_email']), t).global).toBe(
      'common.error.generic',
    );
  });
});

/**
 * Срок повтора 429 показывается в двух шкалах. Одной не хватает: округление вверх до минуты нужно,
 * чтобы не обещать «через 0 минут», но короткую паузу оно завысило бы в разы — а лимит
 * одновременных сессий сервер снимает и за полминуты.
 */
describe('apiErrorText: срок повтора 429', () => {
  const details = (detail: string) => ({
    title: 'Too Many Requests',
    status: 429 as const,
    detail,
    instance: '',
    time: '',
  });

  it('меньше минуты — секундами, как прислал сервер', () => {
    expect(apiErrorText(new ApiRateLimitError(details('Занято'), 30), t)).toBe(
      'Занято common.error.retryAfterSec(30)',
    );
  });

  it('ровно минута — уже минутная шкала', () => {
    expect(apiErrorText(new ApiRateLimitError(details('Занято'), 60), t)).toBe(
      'Занято common.error.retryAfter(1)',
    );
  });

  it('минуты округляются вверх: 601 секунда — это 11 минут, а не 10', () => {
    expect(apiErrorText(new ApiRateLimitError(details('Занято'), 601), t)).toBe(
      'Занято common.error.retryAfter(11)',
    );
  });

  it('срока нет — только причина, без обрывка про повтор', () => {
    expect(apiErrorText(new ApiRateLimitError(details('Занято')), t)).toBe('Занято');
  });

  it('сервер не назвал ни причины, ни срока — свой текст про лимит', () => {
    expect(apiErrorText(new ApiRateLimitError(details('')), t)).toBe('common.error.rateLimited');
  });

  it('до сервера не дошли — текст про связь, а не про повтор позже', () => {
    expect(apiErrorText(new ApiTransportError(), t)).toBe('common.error.network');
  });
});

/**
 * apiErrorText — путь для потребителя БЕЗ формы: класть под поля нечего, поэтому полевые детали
 * идут в общий текст наравне с остальными. У кого форма есть, тот зовёт split().
 */
describe('apiErrorText: 400 у потребителя без формы', () => {
  it('полевые детали не теряются — иначе причина отказа не показалась бы вовсе', () => {
    const err = new ApiFieldError(
      [
        { code: 'ValidateError/user_email', detail: 'Некорректный емаил.' },
        { code: 'ErrorCode', detail: 'Отказано по существу.' },
      ],
      400,
    );

    expect(apiErrorText(err, t)).toBe('Некорректный емаил. Отказано по существу.');
  });

  it('деталей нет вовсе → перевод, а не пустая строка', () => {
    expect(apiErrorText(new ApiFieldError([{ code: 'ErrorCode', detail: '' }], 400), t)).toBe(
      'common.error.generic',
    );
  });
});

describe('normalizeError: 429', () => {
  it('Retry-After доезжает в секундах', async () => {
    server.use(error429('600'));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiRateLimitError);
    expect((err as ApiRateLimitError).retryAfterSec).toBe(600);
    expect((err as ApiRateLimitError).details.detail).toBe('Повторите позже');
  });

  it('без заголовка — 429 всё равно свой класс, задержку выбирает клиент', async () => {
    server.use(error429());

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiRateLimitError);
    expect((err as ApiRateLimitError).retryAfterSec).toBeUndefined();
  });

  it('429 без problem+json (прокси): detail пуст, чтобы UI показал свой перевод', async () => {
    server.use(
      http.post(`${BASE}/v1/signup`, () => new HttpResponse('<html>429</html>', { status: 429 })),
    );

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiRateLimitError);
    // Сообщение axios в этот слот не подставляем: иначе пользователь увидел бы английское
    // «Request failed with status code 429» вместо common.error.rateLimited.
    expect((err as ApiRateLimitError).details.detail).toBe('');
    expect((err as ApiRateLimitError).details.status).toBe(429);
  });

  it('403 остаётся ApiProblemError — 429-ветка его не перехватывает', async () => {
    server.use(
      http.post(`${BASE}/v1/signup`, () =>
        HttpResponse.json(
          { title: 'Forbidden', status: 403, detail: 'Вы уже авторизованы' },
          { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiProblemError);
    expect((err as ApiProblemError).status).toBe(403);
  });
});
