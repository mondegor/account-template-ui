import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTimeLong } from './dateTime';

const D = new Date('2026-07-15T08:53:00Z');

describe('formatDateTimeLong', () => {
  it('ru: the trailing year abbreviation is stripped', () => {
    // Срезаемый суффикс написан кириллицей потому, что он и есть предмет проверки, — заменить
    // его нечем (второе вхождение ниже, в эталоне, повторяет ту же операцию). `\s`, а не
    // литеральный пробел: ICU может отдавать NBSP/NNBSP.
    expect(formatDateTimeLong(D, 'ru-RU')).not.toMatch(/\sг\./);
  });

  it('en: date in words', () => {
    expect(formatDateTimeLong(D, 'en-US')).toContain('July');
  });
});

describe('formatDate', () => {
  it('matches toLocaleDateString in both app locales', () => {
    expect(formatDate(D, 'ru-RU')).toBe(D.toLocaleDateString('ru-RU'));
    expect(formatDate(D, 'en-US')).toBe(D.toLocaleDateString('en-US'));
  });
});

/**
 * Момент времени один, показания часов — разные: пояс отображения задаёт клиент. Здесь же
 * проверяется, что составной ключ кэша форматтеров разбирается обратно (иначе в конструктор
 * Intl уехало бы `ru-RU|Europe/Moscow` целиком).
 */
describe('display time zone', () => {
  it('the same instant is shown by the clock of the given time zone', () => {
    // 08:53 UTC = 11:53 в Москве и 17:53 в Токио.
    expect(formatDateTimeLong(D, 'ru-RU', 'Europe/Moscow')).toContain('11:53');
    expect(formatDateTimeLong(D, 'ru-RU', 'Asia/Tokyo')).toContain('17:53');
    expect(formatDateTimeLong(D, 'ru-RU', 'UTC')).toContain('8:53');
  });

  it('a time zone can shift the calendar date as well', () => {
    const lateEvening = new Date('2026-07-15T22:30:00Z');
    expect(formatDate(lateEvening, 'ru-RU', 'UTC')).toBe('15.07.2026');
    // В Токио это уже следующие сутки.
    expect(formatDate(lateEvening, 'ru-RU', 'Asia/Tokyo')).toBe('16.07.2026');
  });

  it('with no time zone we format in the browser one', () => {
    expect(formatDate(D, 'ru-RU')).toBe(D.toLocaleDateString('ru-RU'));
    expect(formatDateTimeLong(D, 'ru-RU')).toBe(
      D.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).replace(/\sг\./g, ''),
    );
  });
});
