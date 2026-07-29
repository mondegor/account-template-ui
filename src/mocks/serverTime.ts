import { TIME_ZONES, findTimeZone, resolveTimeZone } from '@core/i18n';

/**
 * Работа со временем на стороне «сервера»: арифметика смещений, разбор X-Accept-Time-Zone
 * и рендер дат в поясе ответа.
 *
 * Реализация здесь СВОЯ, хотя те же вычисления есть в `@core/i18n/timeZones`. Так и задумано
 * по двум причинам:
 *  - мок изображает бэк, и проверять клиент его же кодом — тавтология: разъехавшийся форматтер
 *    смещений сошёлся бы сам с собой и тест бы этого не увидел;
 *  - рабочему коду незачем держать в публичном API функции, нужные только мокам.
 * Справочник зон при этом общий (`TIME_ZONES`) — он и есть копия серверного списка, дублировать
 * данные смысла нет, дублируется только арифметика.
 */

/** Секунды → `±HH:MM` — формат смещения в RFC3339-датах ответа. */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * `GMT+03:00` → секунды. Голое `GMT` означает ровно 0, а не «не разобрал»: часть реализаций ICU
 * отдаёт на нуле именно его, и UTC-пользователь получил бы NaN вместо смещения.
 */
export function parseGmtOffset(value: string): number {
  const m = /^GMT(?:([+-])(\d{1,2}):(\d{2}))?$/.exec(value.trim());
  if (!m) return Number.NaN;
  if (!m[1]) return 0;
  const [, sign, hh, mm] = m;
  return (sign === '-' ? -1 : 1) * (Number(hh) * 3600 + Number(mm) * 60);
}

// Кэш форматтеров по имени зоны: конструктор Intl дорогой, а зон столько же, сколько
// в справочнике, — кэш ограничен.
const formatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Смещение зоны от UTC в секундах на момент `at`. Зона должна быть уже проверена. */
export function getTimeZoneOffset(tz: string, at: Date = new Date()): number {
  const name = offsetFormatter(tz)
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return name ? parseGmtOffset(name.value) : Number.NaN;
}

/**
 * Пробные моменты года — январь и июль. По одному моменту не отличить стандартное смещение
 * от летнего; половины года хватает — зона меняет состояние максимум раз в полгода.
 */
function probes(at: Date): [Date, Date] {
  const year = at.getUTCFullYear();
  return [new Date(Date.UTC(year, 0, 15, 12)), new Date(Date.UTC(year, 6, 15, 12))];
}

/** Стандартное (зимнее) смещение — меньшее из январского и июльского: так верно и для юга. */
function standardOffset(tz: string, at: Date = new Date()): number {
  const [jan, jul] = probes(at);
  return Math.min(getTimeZoneOffset(tz, jan), getTimeZoneOffset(tz, jul));
}

/** Действует ли ЛЕТНЕЕ время в зоне на момент `at` — это и просит параметр `dst` заголовка. */
export function isDstActive(tz: string, at: Date = new Date()): boolean {
  return getTimeZoneOffset(tz, at) > standardOffset(tz, at);
}

/**
 * Индекс подбора зоны по паре (смещение, летнее время действует) — как на сервере. Ключ —
 * СОСТОЯНИЕ зоны, а не её описание: у зоны с переходом состояний два, и оба лежат в индексе.
 * Поэтому летний Стамбул (`+03:00`, dst=0) не путается с Каиром: у того в июле состояние
 * (`+03:00`, dst=1), а в январе (`+02:00`, dst=0).
 *
 * Отличия от бэка, осознанные для мока: он сканирует каждый день года вперёд (ловит редкие
 * состояния вроде рамадана в Africa/Casablanca), а нам хватает января и июля — все зоны
 * справочника меняют состояние максимум раз в полгода. Правило коллизий то же: побеждает зона,
 * встреченная в списке ПОЗЖЕ (последняя запись перетирает раннюю), а UTC регистрируется после
 * всех и всегда забирает (+00:00, dst=0).
 */
const zoneStateIndex = new Map<string, string>();

function stateKey(offsetSec: number, isDst: boolean): string {
  return `${offsetSec}|${isDst ? 1 : 0}`;
}

function buildZoneStateIndex(): Map<string, string> {
  if (zoneStateIndex.size > 0) return zoneStateIndex;

  for (const zone of TIME_ZONES) {
    // Зона справочника, неизвестная ICU браузера, состояния не даёт: getTimeZoneOffset кинул бы
    // RangeError и оставил бы без индекса ВСЕ зоны, а с ним — и все хендлеры, читающие настройки.
    if (!resolveTimeZone(zone.id)) continue;
    for (const at of probes(new Date())) {
      zoneStateIndex.set(
        stateKey(getTimeZoneOffset(zone.id, at), isDstActive(zone.id, at)),
        zone.id,
      );
    }
  }
  zoneStateIndex.set(stateKey(0, false), 'UTC');
  return zoneStateIndex;
}

/**
 * Зона из заголовка X-Accept-Time-Zone (`Europe/Moscow;offset=+03:00;dst=0`). Разбирается
 * терпимо, как требует спека: знакомое имя берём как есть, незнакомое — подбираем по состоянию
 * (offset + dst). Именно эта ветка даёт «сервер сохранил не то, что вы просили».
 *
 * Смещение принимается, только когда годны ОБА параметра: по одному лишь offset подбор дал бы
 * зону наугад (так же у бэка — см. ParseAcceptTimeZone).
 */
export function matchHeaderTz(header: string | null): string | undefined {
  if (!header) return undefined;
  const [name, ...params] = header.split(';');
  if (name && findTimeZone(name)) return name;

  const param = (key: string) =>
    params.map((p) => new RegExp(`^${key}=(.+)$`).exec(p)?.[1]).find((v) => v !== undefined);

  const offset = param('offset');
  const dst = param('dst');
  if (!offset || (dst !== '0' && dst !== '1')) return undefined;

  const seconds = parseGmtOffset(`GMT${offset}`);
  if (Number.isNaN(seconds)) return undefined;

  return buildZoneStateIndex().get(stateKey(seconds, dst === '1'));
}

/**
 * Момент времени в RFC3339 со смещением заданной зоны (`2020-01-01T15:00:00+03:00`) — так же,
 * как отдаёт бэк. Даты хранятся в моке абсолютными (ISO с Z), а в поясе ответа рендерятся здесь:
 * фронт всё равно переформатирует их в пояс профиля, но мок обязан быть достоверным.
 */
export function isoIn(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const offsetSec = getTimeZoneOffset(tz, d);
  const shifted = new Date(d.getTime() + offsetSec * 1000);
  return `${shifted.toISOString().slice(0, 19)}${formatOffset(offsetSec)}`;
}
