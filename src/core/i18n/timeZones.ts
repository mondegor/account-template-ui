import dictionary from './data/timezones.json';
import { memoByKey } from './intlCache';
import { findLanguage } from './languages';

/**
 * Справочник часовых поясов — **копия серверного списка** (`go-components/tmp/timezones_v2.yaml`,
 * собран из списка часовых поясов Windows). Совпадение обязательно: явно выбранное значение `tz`
 * бэк проверяет строго по своему списку, поэтому чужое имя вернулось бы 400. Меняется список
 * на бэке — пересобирается и этот файл.
 *
 * Имена в списке — те, что существовали в tzdata на 2018 год (`America/Godthab`, а не
 * `America/Nuuk`; `Europe/Kiev`, а не `Europe/Kyiv`): переименование доезжает в ICU браузера
 * с задержкой в годы, а на незнакомом имени конструктор Intl кидает RangeError. Старое имя живёт
 * в разделе `backward` и понятно и старым ICU, и новым. Отсюда же и порядок правки: сначала
 * серверный список, потом этот файл.
 *
 * На сервер уходит только `id`; подпись и смещение — исключительно оформление.
 */

export interface TimeZone {
  /** IANA-имя: `Europe/Moscow`, `UTC`. Единственное, что уходит в API. */
  id: string;
  /** Стандартное (зимнее) смещение от UTC, `±HH:MM` — как в списке Windows. */
  std_offset: string;
  /** Подпись по коду языка: `{ en: 'Moscow, St. Petersburg', ru: 'Москва, Санкт-Петербург' }`. */
  label: Record<string, string>;
}

export const TIME_ZONES: readonly TimeZone[] = dictionary;

// Индекс по id: зовётся на каждый пункт селекта (139 зон), а внутри timeZoneLabel — ещё раз
// на каждую подпись, так что линейный поиск давал бы квадрат на ровном месте.
const BY_ID = new Map(TIME_ZONES.map((z) => [z.id, z]));

/** Зона справочника по IANA-имени; неизвестное имя → undefined. */
export function findTimeZone(id: string | undefined): TimeZone | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

/**
 * Подпись зоны — для пункта списка и для строки профиля: `(UTC+03:00) Москва, Санкт-Петербург`.
 * Принимает ЛЮБОЕ имя, а не только справочное: бэк мог завести зону, которой во фронте ещё нет,
 * и показать её надо так же, как остальные, — иначе один и тот же профиль выглядел бы на двух
 * экранах по-разному.
 *
 * Смещение статичное (зимнее), как в списке Windows: летом у зоны с переходом часы уйдут на час
 * вперёд, а подпись останется прежней — так ведут себя все системные списки, и пересчитывать его
 * живьём на каждую из 139 строк незачем. Язык подписи — интерфейса; незнакомый язык → английский,
 * на нём список и составлен.
 *
 * Зоне вне справочника вместо города подставляем само имя, а смещение считаем — тем же
 * стандартным, что и у справочных, иначе подпись прыгала бы по сезонам. Если её не знает и ICU
 * браузера, смещение брать неоткуда: отдаём голое имя, врать про часовой пояс нельзя.
 */
export function timeZoneLabel(id: string, lang?: string): string {
  const zone = findTimeZone(id);
  if (zone) {
    const code = findLanguage(lang)?.code ?? '';
    return `(UTC${zone.std_offset}) ${zone.label[code] ?? zone.label.en ?? zone.id}`;
  }
  const tz = resolveTimeZone(id);
  return tz ? `(UTC${formatOffset(standardOffset(tz))}) ${id}` : id;
}

/**
 * Пригодна ли зона для Intl. Имя приходит из справочника СЕРВЕРА, а форматирует его ICU БРАУЗЕРА —
 * списки не обязаны совпадать: переименования (Europe/Kyiv, America/Nuuk, Asia/Qostanay) приезжают
 * в ICU с задержкой, и на неизвестном имени конструктор кидает RangeError. Без этой проверки один
 * такой tz уронил бы рендер всей страницы профиля/сессий, а не одну строку с датой.
 *
 * Результат кэшируется по имени: проверка стоит конструктора Intl, а зовут её на каждый рендер.
 */
const supported = new Map<string, boolean>();

export function resolveTimeZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  let ok = supported.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    supported.set(tz, ok);
  }
  return ok ? tz : undefined;
}

/**
 * Зона операционной системы. Легаси-значение `Local` (старые движки) отсеивается той же проверкой
 * Intl, что и всё остальное, — отдельной ветки под него не нужно. Фолбэк `UTC` есть в справочнике,
 * поэтому подобранная им зона показывается в селекте обычным пунктом.
 */
export function getOsTimeZone(): string {
  return resolveTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC';
}

// Кэш форматтеров смещения — по имени зоны (не по локали, как в датах): локаль здесь фиксированная,
// а зон столько же, сколько в справочнике, так что кэш ограничен.
const offsetFormatter = memoByKey(
  (timeZone) => new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }),
);

/**
 * `GMT+03:00` → секунды. На нулевом смещении реализации расходятся: актуальный ICU отдаёт
 * `GMT+00:00`, но встречается и голое `GMT` — оно означает ровно 0, а не «не смог разобрать»,
 * иначе UTC-пользователь получил бы NaN в заголовке и в подписи селекта.
 */
export function parseGmtOffset(value: string): number {
  const m = /^GMT(?:([+-])(\d{1,2}):(\d{2}))?$/.exec(value.trim());
  if (!m) return Number.NaN;
  if (!m[1]) return 0;
  const [, sign, hh, mm] = m;
  return (sign === '-' ? -1 : 1) * (Number(hh) * 3600 + Number(mm) * 60);
}

/** Смещение зоны от UTC в секундах на момент `at`. Зона должна быть уже проверена (resolveTimeZone). */
export function getTimeZoneOffset(tz: string, at: Date = new Date()): number {
  const name = offsetFormatter(tz)
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return name ? parseGmtOffset(name.value) : Number.NaN;
}

/** Секунды → `±HH:MM` (формат offset в заголовке X-Accept-Time-Zone и подписи зоны). */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * Пробные моменты года — январь и июль. Одного текущего момента не хватает нигде: по нему
 * не отличить стандартное смещение от летнего и не различить две зоны, совпадающие только зимой.
 * Половины года достаточно: зона меняет состояние максимум раз в полгода.
 */
function probes(at: Date): [Date, Date] {
  const year = at.getUTCFullYear();
  return [new Date(Date.UTC(year, 0, 15)), new Date(Date.UTC(year, 6, 15))];
}

/**
 * Стандартное (зимнее) смещение зоны в секундах — меньшее из январского и июльского: так работает
 * и южное полушарие. Это то самое значение, что лежит в `std_offset` справочника, поэтому им же
 * считается подпись зоны, которой в справочнике ещё нет.
 */
function standardOffset(tz: string, at: Date = new Date()): number {
  const [jan, jul] = probes(at);
  return Math.min(getTimeZoneOffset(tz, jan), getTimeZoneOffset(tz, jul));
}

/**
 * Действует ли ЛЕТНЕЕ время в зоне прямо сейчас — именно это просит API в параметре `dst`
 * (не «переходит ли зона вообще»). Считается живьём, поэтому справочнику такое поле не нужно:
 * летнее время — это когда часы ушли вперёд относительно стандартного смещения.
 */
export function isDstActive(tz: string, at: Date = new Date()): boolean {
  return getTimeZoneOffset(tz, at) > standardOffset(tz, at);
}

/**
 * Ведут ли две зоны себя одинаково — то есть показывают ли они одно и то же время круглый год.
 * Нужно там, где сервер мог сохранить не запрошенную зону, а соседнюю: тревожить пользователя
 * стоит по поведению, а не по имени.
 *
 * Сравниваем январь и июль: одного текущего момента мало — `Asia/Novosibirsk` (+07 без перехода)
 * и гипотетическая +07 с переходом зимой неотличимы, а летом разойдутся на час.
 */
export function sameZoneBehaviour(a: string, b: string, at: Date = new Date()): boolean {
  const [jan, jul] = probes(at);
  return (
    getTimeZoneOffset(a, jan) === getTimeZoneOffset(b, jan) &&
    getTimeZoneOffset(a, jul) === getTimeZoneOffset(b, jul)
  );
}

/**
 * Значение заголовка X-Accept-Time-Zone: `Europe/Moscow;offset=+03:00;dst=0`.
 * Пробелы спекой запрещены нигде — ни вокруг сегментов, ни вокруг `=`.
 *
 * Зовётся точечно (регистрация и сохранение настроек в режиме «Авто»), поэтому результат
 * не кэшируем: кэш залипал бы на переходе DST в долгоживущей вкладке.
 * Имя зоны берётся проверенным — по умолчанию зона ОС.
 */
export function buildTimeZoneHeader(tz: string = getOsTimeZone(), at: Date = new Date()): string {
  const offset = formatOffset(getTimeZoneOffset(tz, at));
  return `${tz};offset=${offset};dst=${isDstActive(tz, at) ? 1 : 0}`;
}
