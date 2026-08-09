import { describe, expect, it } from 'vitest';
import { LANGUAGES } from './languages';
import {
  TIME_ZONES,
  buildTimeZoneHeader,
  findTimeZone,
  formatOffset,
  getOsTimeZone,
  getTimeZoneOffset,
  isDstActive,
  parseGmtOffset,
  resolveTimeZone,
  timeZoneLabel,
} from './timeZones';

/**
 * Даты фиксированные: смещения зон меняются от сезона (DST), поэтому «сейчас» в тесте
 * дало бы разный результат зимой и летом. Прогонять стоит и с TZ=Asia/Novosibirsk —
 * ни один ожидаемый результат не должен зависеть от зоны процесса.
 */
const JAN = new Date('2026-01-15T12:00:00Z');
const JUL = new Date('2026-07-15T12:00:00Z');

describe('time zone registry', () => {
  it('139 zones of the server-side list, ids are unique, UTC is in place', () => {
    // Копия серверного списка: явное значение tz бэк проверяет строго по своему списку,
    // поэтому расхождение здесь — это 400 на сохранении у пользователя.
    expect(TIME_ZONES).toHaveLength(139);
    const ids = TIME_ZONES.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findTimeZone('UTC')?.std_offset).toBe('+00:00');
  });

  it('every zone has a label in every app language', () => {
    for (const zone of TIME_ZONES) {
      for (const lang of LANGUAGES) {
        expect(zone.label[lang.code], `${zone.id}: no label for ${lang.code}`).toBeTruthy();
      }
    }
  });

  it('ordered by ascending standard offset, the same order as in the select', () => {
    const minutes = TIME_ZONES.map((z) => {
      const m = /^([+-])(\d{2}):(\d{2})$/.exec(z.std_offset);
      expect(m, `unparsable offset on ${z.id}: ${z.std_offset}`).not.toBeNull();
      const [, sign, hh, mm] = m!;
      return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
    });
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it('zone names are accepted by Intl: otherwise labels and date formatting would throw', () => {
    for (const zone of TIME_ZONES) {
      expect(resolveTimeZone(zone.id), `ICU does not know the zone ${zone.id}`).toBe(zone.id);
    }
  });

  it('the registry std_offset matches the standard offset computed by Intl', () => {
    for (const zone of TIME_ZONES) {
      const std = Math.min(getTimeZoneOffset(zone.id, JAN), getTimeZoneOffset(zone.id, JUL));
      expect(formatOffset(std), `std_offset of ${zone.id} disagrees with ICU`).toBe(
        zone.std_offset,
      );
    }
  });

  it('findTimeZone does not know a foreign name', () => {
    expect(findTimeZone('Foo/Bar')).toBeUndefined();
    expect(findTimeZone(undefined)).toBeUndefined();
  });
});

describe('timeZoneLabel', () => {
  it('the shape of the system list, labels in the interface language', () => {
    // Русскую подпись берём из справочника, а не литералом: предмет проверки — что `ru` уходит
    // в ru-колонку и что префикс смещения на месте, а не текст самой подписи.
    expect(timeZoneLabel('Europe/Moscow', 'ru')).toBe(
      `(UTC+03:00) ${findTimeZone('Europe/Moscow')!.label.ru}`,
    );
    expect(timeZoneLabel('Europe/Moscow', 'en-US')).toBe('(UTC+03:00) Moscow, St. Petersburg');
  });

  it('an unknown language falls back to the English label: the list is written in it', () => {
    expect(timeZoneLabel('Asia/Tokyo', 'de-DE')).toBe('(UTC+09:00) Osaka, Sapporo, Tokyo');
    expect(timeZoneLabel('Asia/Tokyo', undefined)).toBe('(UTC+09:00) Osaka, Sapporo, Tokyo');
  });

  it('a zone outside the registry: the name instead of a city, the offset computed by us', () => {
    // Бэк завёл зону, которой во фронте ещё нет. Профиль и настройки обязаны показать её
    // одинаково и в том же виде, что справочные пункты, а не голым IANA-именем.
    expect(timeZoneLabel('Antarctica/Troll', 'en-US')).toBe('(UTC+00:00) Antarctica/Troll');
  });

  it('the offset of such a zone is the standard one, not the seasonal one', () => {
    // У Troll летом +02:00; если бы смещение считалось «на сейчас», подпись менялась бы дважды
    // в год и расходилась бы со std_offset остальных пунктов списка.
    expect(timeZoneLabel('Antarctica/Troll')).not.toContain('+02:00');
  });

  it('a zone unknown to ICU as well: the bare name, there is nothing to state an offset from', () => {
    expect(timeZoneLabel('Foo/Bar', 'en-US')).toBe('Foo/Bar');
  });
});

describe('resolveTimeZone', () => {
  it('lets a known zone through and rejects an unknown one', () => {
    expect(resolveTimeZone('Europe/Moscow')).toBe('Europe/Moscow');
    expect(resolveTimeZone('Foo/Bar')).toBeUndefined();
    expect(resolveTimeZone(undefined)).toBeUndefined();
  });

  it('rejects the legacy `Local` (ICU throws a RangeError on it)', () => {
    expect(resolveTimeZone('Local')).toBeUndefined();
  });

  it('getOsTimeZone returns a zone Intl can use', () => {
    const tz = getOsTimeZone();
    expect(resolveTimeZone(tz)).toBe(tz);
  });
});

describe('parseGmtOffset', () => {
  it('parses a signed offset, half-hour ones included', () => {
    expect(parseGmtOffset('GMT+03:00')).toBe(3 * 3600);
    expect(parseGmtOffset('GMT-07:00')).toBe(-7 * 3600);
    expect(parseGmtOffset('GMT+05:45')).toBe(5 * 3600 + 45 * 60);
  });

  it('a bare GMT is zero, not NaN: that is how some implementations answer for UTC', () => {
    expect(parseGmtOffset('GMT')).toBe(0);
    expect(parseGmtOffset('GMT+00:00')).toBe(0);
  });

  it('an alien format gives NaN so a failure cannot pass for zero', () => {
    expect(parseGmtOffset('UTC+3')).toBeNaN();
    expect(parseGmtOffset('')).toBeNaN();
  });
});

describe('getTimeZoneOffset', () => {
  it('a zone without DST keeps one offset all year', () => {
    expect(getTimeZoneOffset('Europe/Moscow', JAN)).toBe(3 * 3600);
    expect(getTimeZoneOffset('Europe/Moscow', JUL)).toBe(3 * 3600);
  });

  it('a zone with DST changes its offset', () => {
    expect(getTimeZoneOffset('America/Denver', JAN)).toBe(-7 * 3600);
    expect(getTimeZoneOffset('America/Denver', JUL)).toBe(-6 * 3600);
  });

  it('a half-hour zone and a zero offset', () => {
    expect(getTimeZoneOffset('Asia/Kolkata', JAN)).toBe(5 * 3600 + 30 * 60);
    expect(getTimeZoneOffset('UTC', JAN)).toBe(0);
  });
});

describe('formatOffset', () => {
  it('±HH:MM with leading zeros', () => {
    expect(formatOffset(3 * 3600)).toBe('+03:00');
    expect(formatOffset(-7 * 3600)).toBe('-07:00');
    expect(formatOffset(5 * 3600 + 45 * 60)).toBe('+05:45');
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatOffset(14 * 3600)).toBe('+14:00');
  });
});

describe('isDstActive', () => {
  it('northern hemisphere: yes in summer, no in winter', () => {
    expect(isDstActive('America/Denver', JUL)).toBe(true);
    expect(isDstActive('America/Denver', JAN)).toBe(false);
  });

  it('southern hemisphere: DST is measured from the smaller offset, not from the January one', () => {
    expect(isDstActive('Australia/Sydney', JAN)).toBe(true);
    expect(isDstActive('Australia/Sydney', JUL)).toBe(false);
  });

  it('a zone without DST always answers no, even in summer', () => {
    expect(isDstActive('Europe/Moscow', JUL)).toBe(false);
    expect(isDstActive('UTC', JUL)).toBe(false);
  });
});

describe('buildTimeZoneHeader', () => {
  it('the format from the spec, without spaces', () => {
    expect(buildTimeZoneHeader('Europe/Moscow', JAN)).toBe('Europe/Moscow;offset=+03:00;dst=0');
    expect(buildTimeZoneHeader('America/Denver', JUL)).toBe('America/Denver;offset=-06:00;dst=1');
    expect(buildTimeZoneHeader('Asia/Kathmandu', JAN)).toBe('Asia/Kathmandu;offset=+05:45;dst=0');
    expect(buildTimeZoneHeader('UTC', JUL)).toBe('UTC;offset=+00:00;dst=0');
  });

  it('with no argument it takes the OS zone and stays in the spec format', () => {
    expect(buildTimeZoneHeader()).toMatch(/^[\w/+-]+;offset=[+-]\d{2}:\d{2};dst=[01]$/);
  });
});
