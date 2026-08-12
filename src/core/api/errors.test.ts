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
        detail: 'Try again later',
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
  it('code without a suffix: a refusal on the merits, no field attached', () => {
    expect(parseErrorCode('ErrorCode')).toEqual({ reason: 'ErrorCode' });
  });

  it('code with a suffix: the reason and the request field name', () => {
    expect(parseErrorCode('EmailAlreadyExists/user_email')).toEqual({
      reason: 'EmailAlreadyExists',
      field: 'user_email',
    });
  });

  it('splits on the FIRST slash: the rest is the field name in full', () => {
    expect(parseErrorCode('ValidateError/realm/extra')).toEqual({
      reason: 'ValidateError',
      field: 'realm/extra',
    });
  });

  it('an empty suffix is not a field: no request field has an empty name', () => {
    expect(parseErrorCode('ValidateError/')).toEqual({ reason: 'ValidateError' });
  });
});

describe('ApiFieldError.split: mapping onto form fields', () => {
  it('only a matching suffix lands on a field, the rest becomes a form-wide message', async () => {
    server.use(
      error400([
        { code: 'ValidateError/user_email', detail: 'Malformed email' },
        { code: 'ErrorCode', detail: 'Refused on the merits' },
        { code: 'ValidateError/realm', detail: 'Realm not found' },
      ]),
    );

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiFieldError);
    // В форме есть только user_email: отказ по существу и ошибка по чужому полю класть некуда.
    const { byField, global } = (err as ApiFieldError).split(new Set(['user_email']), t);
    expect(byField).toEqual([{ name: 'user_email', detail: 'Malformed email' }]);
    expect(global).toBe('Refused on the merits Realm not found');
  });

  it('a form with no matching field: everything goes to the form-wide message, nothing is lost', async () => {
    server.use(error400([{ code: 'ValidateError/user_email', detail: 'Malformed email' }]));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    const { byField, global } = (err as ApiFieldError).split(new Set(['user_login']), t);
    expect(byField).toEqual([]);
    expect(global).toBe('Malformed email');
  });

  it('no global errors: there is no form-wide message at all', async () => {
    server.use(error400([{ code: 'ValidateError/user_email', detail: 'Malformed email' }]));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect((err as ApiFieldError).split(new Set(['user_email']), t).global).toBeUndefined();
  });

  it('two reasons for one field merge into a single entry: the second does not overwrite the first', async () => {
    server.use(
      error400([
        { code: 'ValidateError/user_email', detail: 'Too long.' },
        { code: 'EmailAlreadyExists/user_email', detail: 'Already taken.' },
      ]),
    );

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    // Место под полем одно: отдай split() две записи, потребитель показал бы только последнюю.
    expect((err as ApiFieldError).split(new Set(['user_email']), t).byField).toEqual([
      { name: 'user_email', detail: 'Too long. Already taken.' },
    ]);
  });

  it('a global error with an empty detail falls back to a translation, not an empty string', async () => {
    server.use(error400([{ code: 'ErrorCode', detail: '' }]));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect((err as ApiFieldError).split(new Set(['user_email']), t).global).toBe(
      'common.error.generic',
    );
  });
});

/**
 * Серверная деталь доезжает до пользователя как есть. Срок повтора из Retry-After разобран в
 * retryAfterSec и виден в логах, но в текст не подмешивается: назвать срок словами — дело детали.
 */
describe('apiErrorText: the server detail is shown as is', () => {
  const details = (detail: string) => ({
    title: 'Too Many Requests',
    status: 429 as const,
    detail,
    instance: '',
    time: '',
  });

  it('a delay was named: still the detail alone, without a retry clause of ours', () => {
    expect(apiErrorText(new ApiRateLimitError(details('Busy'), 30), t)).toBe('Busy');
  });

  it('no delay: the same text — the header changes nothing here', () => {
    expect(apiErrorText(new ApiRateLimitError(details('Busy')), t)).toBe('Busy');
  });

  it('the server named neither reason nor delay: our own rate-limit text', () => {
    expect(apiErrorText(new ApiRateLimitError(details('')), t)).toBe('common.error.rateLimited');
  });

  it('never reached the server: the connection text, not the retry-later one', () => {
    expect(apiErrorText(new ApiTransportError(), t)).toBe('common.error.network');
  });
});

/**
 * apiErrorText — путь для потребителя БЕЗ формы: класть под поля нечего, поэтому полевые детали
 * идут в общий текст наравне с остальными. У кого форма есть, тот зовёт split().
 */
describe('apiErrorText: a 400 for a consumer without a form', () => {
  it('field details are not lost: otherwise the reason for the refusal would never be shown', () => {
    const err = new ApiFieldError(
      [
        { code: 'ValidateError/user_email', detail: 'Malformed email.' },
        { code: 'ErrorCode', detail: 'Refused on the merits.' },
      ],
      400,
    );

    expect(apiErrorText(err, t)).toBe('Malformed email. Refused on the merits.');
  });

  it('no details at all: a translation, not an empty string', () => {
    expect(apiErrorText(new ApiFieldError([{ code: 'ErrorCode', detail: '' }], 400), t)).toBe(
      'common.error.generic',
    );
  });
});

describe('normalizeError: 429', () => {
  it('Retry-After arrives in seconds', async () => {
    server.use(error429('600'));

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiRateLimitError);
    expect((err as ApiRateLimitError).retryAfterSec).toBe(600);
    expect((err as ApiRateLimitError).details.detail).toBe('Try again later');
  });

  it('without the header a 429 is still its own class; the client picks the delay', async () => {
    server.use(error429());

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiRateLimitError);
    expect((err as ApiRateLimitError).retryAfterSec).toBeUndefined();
  });

  it('429 without problem+json (a proxy): detail stays empty so the UI shows its own translation', async () => {
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

  it('403 stays an ApiProblemError: the 429 branch does not intercept it', async () => {
    server.use(
      http.post(`${BASE}/v1/signup`, () =>
        HttpResponse.json(
          { title: 'Forbidden', status: 403, detail: 'You are already signed in' },
          { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    const err = await authClient.post(`/v1/signup`, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiProblemError);
    expect((err as ApiProblemError).status).toBe(403);
  });
});
