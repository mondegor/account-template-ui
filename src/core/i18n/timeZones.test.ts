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

describe('справочник часовых поясов', () => {
  it('139 зон серверного списка, id уникальны, UTC на месте', () => {
    // Копия go-components/tmp/timezones.yaml: явное значение tz бэк проверяет строго по своему
    // списку, поэтому расхождение здесь — это 400 на сохранении у пользователя.
    expect(TIME_ZONES).toHaveLength(139);
    const ids = TIME_ZONES.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findTimeZone('UTC')?.std_offset).toBe('+00:00');
  });

  it('у каждой зоны есть подпись на всех языках приложения', () => {
    for (const zone of TIME_ZONES) {
      for (const lang of LANGUAGES) {
        expect(zone.label[lang.code], `${zone.id}: нет подписи ${lang.code}`).toBeTruthy();
      }
    }
  });

  it('порядок — по возрастанию стандартного смещения (он же порядок в селекте)', () => {
    const minutes = TIME_ZONES.map((z) => {
      const m = /^([+-])(\d{2}):(\d{2})$/.exec(z.std_offset);
      expect(m, `непонятное смещение у ${z.id}: ${z.std_offset}`).not.toBeNull();
      const [, sign, hh, mm] = m!;
      return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
    });
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it('имена зон принимаются Intl — иначе подпись и форматирование дат упадут', () => {
    for (const zone of TIME_ZONES) {
      expect(resolveTimeZone(zone.id), `ICU не знает зону ${zone.id}`).toBe(zone.id);
    }
  });

  it('std_offset справочника совпадает со стандартным смещением по Intl', () => {
    for (const zone of TIME_ZONES) {
      const std = Math.min(getTimeZoneOffset(zone.id, JAN), getTimeZoneOffset(zone.id, JUL));
      expect(formatOffset(std), `у ${zone.id} std_offset разошёлся с ICU`).toBe(zone.std_offset);
    }
  });

  it('findTimeZone не знает чужого имени', () => {
    expect(findTimeZone('Foo/Bar')).toBeUndefined();
    expect(findTimeZone(undefined)).toBeUndefined();
  });
});

describe('timeZoneLabel', () => {
  it('вид системного списка, подпись — на языке интерфейса', () => {
    expect(timeZoneLabel('Europe/Moscow', 'ru')).toBe('(UTC+03:00) Москва, Санкт-Петербург');
    expect(timeZoneLabel('Europe/Moscow', 'en-US')).toBe('(UTC+03:00) Moscow, St. Petersburg');
  });

  it('незнакомый язык → английская подпись: на ней список и составлен', () => {
    expect(timeZoneLabel('Asia/Tokyo', 'de-DE')).toBe('(UTC+09:00) Osaka, Sapporo, Tokyo');
    expect(timeZoneLabel('Asia/Tokyo', undefined)).toBe('(UTC+09:00) Osaka, Sapporo, Tokyo');
  });

  it('зона вне справочника: вместо города имя, смещение считаем сами', () => {
    // Бэк завёл зону, которой во фронте ещё нет. Профиль и настройки обязаны показать её
    // одинаково и в том же виде, что справочные пункты, а не голым IANA-именем.
    expect(timeZoneLabel('Antarctica/Troll', 'ru')).toBe('(UTC+00:00) Antarctica/Troll');
  });

  it('смещение у такой зоны стандартное, а не сезонное', () => {
    // У Troll летом +02:00; если бы смещение считалось «на сейчас», подпись менялась бы дважды
    // в год и расходилась бы со std_offset остальных пунктов списка.
    expect(timeZoneLabel('Antarctica/Troll')).not.toContain('+02:00');
  });

  it('зона, неизвестная и ICU: голое имя — врать про смещение нечем', () => {
    expect(timeZoneLabel('Foo/Bar', 'ru')).toBe('Foo/Bar');
  });
});

describe('resolveTimeZone', () => {
  it('пропускает известную зону и отбраковывает неизвестную', () => {
    expect(resolveTimeZone('Europe/Moscow')).toBe('Europe/Moscow');
    expect(resolveTimeZone('Foo/Bar')).toBeUndefined();
    expect(resolveTimeZone(undefined)).toBeUndefined();
  });

  it('отбраковывает легаси-`Local` (ICU кидает на нём RangeError)', () => {
    expect(resolveTimeZone('Local')).toBeUndefined();
  });

  it('getOsTimeZone возвращает зону, пригодную для Intl', () => {
    const tz = getOsTimeZone();
    expect(resolveTimeZone(tz)).toBe(tz);
  });
});

describe('parseGmtOffset', () => {
  it('разбирает смещение со знаком и с получасом', () => {
    expect(parseGmtOffset('GMT+03:00')).toBe(3 * 3600);
    expect(parseGmtOffset('GMT-07:00')).toBe(-7 * 3600);
    expect(parseGmtOffset('GMT+05:45')).toBe(5 * 3600 + 45 * 60);
  });

  it('голое GMT — это ноль, а не NaN (так отвечают часть реализаций на UTC)', () => {
    expect(parseGmtOffset('GMT')).toBe(0);
    expect(parseGmtOffset('GMT+00:00')).toBe(0);
  });

  it('чужой формат — NaN, чтобы ошибка не притворилась нулём', () => {
    expect(parseGmtOffset('UTC+3')).toBeNaN();
    expect(parseGmtOffset('')).toBeNaN();
  });
});

describe('getTimeZoneOffset', () => {
  it('зона без перехода — одно смещение круглый год', () => {
    expect(getTimeZoneOffset('Europe/Moscow', JAN)).toBe(3 * 3600);
    expect(getTimeZoneOffset('Europe/Moscow', JUL)).toBe(3 * 3600);
  });

  it('зона с переходом — смещение меняется', () => {
    expect(getTimeZoneOffset('America/Denver', JAN)).toBe(-7 * 3600);
    expect(getTimeZoneOffset('America/Denver', JUL)).toBe(-6 * 3600);
  });

  it('получасовая зона и нулевое смещение', () => {
    expect(getTimeZoneOffset('Asia/Kolkata', JAN)).toBe(5 * 3600 + 30 * 60);
    expect(getTimeZoneOffset('UTC', JAN)).toBe(0);
  });
});

describe('formatOffset', () => {
  it('±HH:MM с ведущими нулями', () => {
    expect(formatOffset(3 * 3600)).toBe('+03:00');
    expect(formatOffset(-7 * 3600)).toBe('-07:00');
    expect(formatOffset(5 * 3600 + 45 * 60)).toBe('+05:45');
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatOffset(14 * 3600)).toBe('+14:00');
  });
});

describe('isDstActive', () => {
  it('северное полушарие: лето — да, зима — нет', () => {
    expect(isDstActive('America/Denver', JUL)).toBe(true);
    expect(isDstActive('America/Denver', JAN)).toBe(false);
  });

  it('южное полушарие: переход считается от меньшего смещения, а не от январского', () => {
    expect(isDstActive('Australia/Sydney', JAN)).toBe(true);
    expect(isDstActive('Australia/Sydney', JUL)).toBe(false);
  });

  it('зона без перехода — всегда нет, даже летом', () => {
    expect(isDstActive('Europe/Moscow', JUL)).toBe(false);
    expect(isDstActive('UTC', JUL)).toBe(false);
  });
});

describe('buildTimeZoneHeader', () => {
  it('формат спеки, без пробелов', () => {
    expect(buildTimeZoneHeader('Europe/Moscow', JAN)).toBe('Europe/Moscow;offset=+03:00;dst=0');
    expect(buildTimeZoneHeader('America/Denver', JUL)).toBe('America/Denver;offset=-06:00;dst=1');
    expect(buildTimeZoneHeader('Asia/Kathmandu', JAN)).toBe('Asia/Kathmandu;offset=+05:45;dst=0');
    expect(buildTimeZoneHeader('UTC', JUL)).toBe('UTC;offset=+00:00;dst=0');
  });

  it('без аргумента берёт зону ОС и остаётся в формате спеки', () => {
    expect(buildTimeZoneHeader()).toMatch(/^[\w/+-]+;offset=[+-]\d{2}:\d{2};dst=[01]$/);
  });
});
