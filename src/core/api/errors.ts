import { AxiosError } from 'axios';
import type { TFunction } from 'i18next';
import type {
  ConfirmOperationState,
  ErrorAttribute,
  ErrorDetailsBody,
  OperationError400Body,
} from './types';

/**
 * Классы ошибок по форме тела:
 *  - ApiFieldError  — 400 application/json: список `errors` (+ опц. operation_state) → на форму/движок.
 *  - ApiRateLimitError — 429: запрос корректен, но отклонён временно; срок повтора — в Retry-After.
 *  - ApiProblemError — RFC 9457 problem+json: 401/403/404/422/5xx → глобальные уведомления.
 *  - ApiTransportError — сеть/таймаут/неизвестное.
 *
 * Собственные строки этого модуля (`Error.message`, запасной `title`) — английские и служебные:
 * ошибка собирается в интерсепторе, где языка интерфейса не знают, поэтому на экран эти значения
 * не идут — они для логов и devtools. Текст для пользователя даёт apiErrorText() в конце файла.
 */

/**
 * Разбор `code` из элемента `errors` ответа 400: `КодОшибки` либо `КодОшибки/имя_поля`.
 * Режем по ПЕРВОМУ `/` — так это правило и сформулировано в спеке. Пустой суффикс полем не считаем:
 * поля с пустым именем в запросе нет, и такая ошибка должна уйти общим уведомлением.
 */
export function parseErrorCode(code: string): { reason: string; field?: string } {
  const slash = code.indexOf('/');
  if (slash < 0) return { reason: code };
  const field = code.slice(slash + 1);
  return field ? { reason: code.slice(0, slash), field } : { reason: code.slice(0, slash) };
}

/**
 * Склейка нескольких `detail` в одну строку. Пустые пропускаются: сервер обязан прислать текст, но
 * если не прислал — пробелы-разделители в строке ни о чём не скажут. Правило одно, потому что
 * потребителей у него два (`split()` и `apiErrorText()`), и разъехаться им незачем.
 */
function joinDetails(details: readonly string[]): string {
  return details.filter(Boolean).join(' ');
}

export class ApiFieldError extends Error {
  readonly fields: ErrorAttribute[];
  readonly operationState?: ConfirmOperationState;
  readonly status: number;
  constructor(fields: ErrorAttribute[], status: number, operationState?: ConfirmOperationState) {
    super(fields[0]?.detail || 'Request rejected');
    this.name = 'ApiFieldError';
    this.fields = fields;
    this.status = status;
    this.operationState = operationState;
  }

  /**
   * Раскладывает `errors` по полям КОНКРЕТНОЙ формы: под поле садится только та ошибка, чей
   * суффикс `code` совпал с именем поля этой формы. Ошибка без суффикса (отказ по существу) и
   * ошибка по полю, которого в форме нет, попадают в `global` — их показывают общим сообщением,
   * иначе они пропали бы молча. Правило одно на всех потребителей, поэтому живёт здесь.
   *
   * `global` — уже готовая строка либо undefined, когда глобальных ошибок не было. Пустые `detail`
   * подменяются переводом: собирать строку самим потребителям нельзя, иначе отказ с пустой деталью
   * не показывался бы вовсе — сабмит просто переставал бы крутиться, ничего не объяснив.
   * Под полем такой подмены нет намеренно: поле и без текста подсвечено как невалидное, а общий
   * текст под конкретным полем сбивал бы с толку сильнее, чем его отсутствие.
   *
   * На поле приходится не больше одной записи: несколько причин по одному полю склеиваются в неё.
   * Место под полем одно, и потребитель кладёт туда ровно то, что получил, — отдай мы две записи,
   * вторая затёрла бы первую, и причина исчезла бы молча.
   */
  split(
    fieldNames: ReadonlySet<string>,
    t: TFunction,
  ): { byField: { name: string; detail: string }[]; global?: string } {
    const perField = new Map<string, string[]>();
    const global: string[] = [];
    for (const f of this.fields) {
      const { field } = parseErrorCode(f.code);
      if (field && fieldNames.has(field))
        perField.set(field, [...(perField.get(field) ?? []), f.detail]);
      else global.push(f.detail);
    }
    // Map держит порядок вставки, поэтому поля идут в том же порядке, в каком их прислал сервер.
    const byField = [...perField].map(([name, details]) => ({
      name,
      detail: joinDetails(details),
    }));
    if (!global.length) return { byField };
    return { byField, global: joinDetails(global) || t('common.error.generic') };
  }
}

/**
 * 429. Тело — problem+json, как у остальных не-400 ошибок. `retryAfterSec` необязателен: если сервер
 * не берётся назвать срок, заголовка нет вовсе и задержку выбирает клиент.
 */
export class ApiRateLimitError extends Error {
  readonly status = 429;
  readonly details: ErrorDetailsBody;
  readonly retryAfterSec?: number;
  constructor(details: ErrorDetailsBody, retryAfterSec?: number) {
    super(details.detail || details.title || 'Too many requests');
    this.name = 'ApiRateLimitError';
    this.details = details;
    this.retryAfterSec = retryAfterSec;
  }
}

export class ApiProblemError extends Error {
  readonly status: number;
  readonly details: ErrorDetailsBody;
  constructor(details: ErrorDetailsBody) {
    super(details.title || details.detail || 'Service error');
    this.name = 'ApiProblemError';
    this.status = details.status;
    this.details = details;
  }
}

export class ApiTransportError extends Error {
  constructor(message = 'Network unavailable') {
    super(message);
    this.name = 'ApiTransportError';
  }
}

export type ApiError = ApiFieldError | ApiRateLimitError | ApiProblemError | ApiTransportError;

function isProblemJson(contentType: string | undefined): boolean {
  return !!contentType && contentType.includes('application/problem+json');
}

/** Retry-After в секундах (спека: integer ≥ 1). Всё прочее — как будто заголовка нет. */
function retryAfterSeconds(raw: unknown): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** Приводит любую ошибку axios к типизированному ApiError. 404 → ApiProblemError (общее увед.). */
export function normalizeError(err: unknown): ApiError {
  if (!(err instanceof AxiosError)) {
    return new ApiTransportError(err instanceof Error ? err.message : undefined);
  }
  const res = err.response;
  if (!res) return new ApiTransportError(err.message);

  const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
  const data = res.data as unknown;

  // Плоская/операционная 400: application/json с errors[]
  if (
    res.status === 400 &&
    !isProblemJson(contentType) &&
    data &&
    typeof data === 'object' &&
    Array.isArray((data as OperationError400Body).errors)
  ) {
    const body = data as OperationError400Body;
    return new ApiFieldError(body.errors, 400, body.operation_state);
  }

  const details: ErrorDetailsBody =
    data && typeof data === 'object' && typeof (data as ErrorDetailsBody).status === 'number'
      ? (data as ErrorDetailsBody)
      : {
          // Тела нет или оно не problem+json (прокси, балансировщик). `detail` оставляем пустым:
          // это слот для человекочитаемого текста ОТ СЕРВЕРА, и подставленное сюда сообщение axios
          // («Request failed with status code 429») доехало бы до пользователя вместо перевода —
          // apiErrorText() выбирает свой текст ровно по пустому detail. Статус и адрес ниже.
          title: 'Service error',
          status: res.status,
          detail: '',
          instance: `${err.config?.method?.toUpperCase() ?? ''} ${err.config?.url ?? ''}`,
          time: new Date().toISOString(),
        };

  // 429 — до общей problem-ветки: тело у него такое же, отличает его статус и Retry-After.
  if (res.status === 429) {
    return new ApiRateLimitError(details, retryAfterSeconds(res.headers?.['retry-after']));
  }

  // RFC 9457 problem+json: 401/403/404/422/5xx
  return new ApiProblemError(details);
}

/**
 * Текст ошибки для показа пользователю — одно правило на всех потребителей (формы, плашки страниц).
 *
 * Серверную деталь берём как есть и ничего к ней не дописываем: бэк отдаёт её на языке запроса
 * (`?lang`/Accept-Language), точнее текста у нас нет, а чего в его фразе не хватает — знает он, а
 * не мы. Пустая деталь значит «сервер ничего внятного не сказал» (тела нет или оно не
 * problem+json) — тогда и только тогда показываем свой перевод. Сообщения самих классов сюда не
 * попадают: они английские и служебные (см. шапку файла).
 *
 * Отсюда же и 429: срок повтора из `Retry-After` разобран в `retryAfterSec` и виден в логах, но в
 * текст не превращается — назвать срок словами должна сама деталь.
 *
 * `t` принимаем аргументом, чтобы @core/api не зависел от i18next, — как buildFormSchema(fields, t).
 *
 * У ApiFieldError сюда идут ВСЕ детали, включая полевые, и это не оплошность: apiErrorText —
 * путь для потребителя БЕЗ формы (плашка страницы, хук), где под поля класть нечего и умолчать
 * о полевой причине значило бы не показать её вовсе. У кого форма есть, тот зовёт split(), а не
 * эту функцию, — иначе один и тот же текст встал бы и под полем, и над формой.
 */
export function apiErrorText(e: unknown, t: TFunction): string {
  if (e instanceof ApiFieldError) {
    return joinDetails(e.fields.map((f) => f.detail)) || t('common.error.generic');
  }
  // 429 отличает от прочих problem+json только запасной текст: отказ временный, и «что-то пошло
  // не так» сказало бы о нём меньше, чем «слишком много попыток».
  if (e instanceof ApiRateLimitError) return e.details.detail || t('common.error.rateLimited');
  if (e instanceof ApiProblemError) return e.details.detail || t('common.error.generic');
  // ApiTransportError и всё, что не дошло до сервера вовсе: до бэка запрос не добрался, и «попробуйте
  // позже» тут менее полезно, чем прямое указание на связь.
  if (e instanceof ApiTransportError) return t('common.error.network');
  return t('common.error.generic');
}
