import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTimeLong } from './dateTime';

const D = new Date('2026-07-15T08:53:00Z');

describe('formatDateTimeLong', () => {
  it('ru: дата словами, «г.» после года вырезано', () => {
    const s = formatDateTimeLong(D, 'ru-RU');
    expect(s).toContain('июля');
    // `\s`, а не литеральный пробел: ICU может отдавать NBSP/NNBSP.
    expect(s).not.toMatch(/\sг\./);
  });

  it('en: дата словами', () => {
    expect(formatDateTimeLong(D, 'en-US')).toContain('July');
  });
});

describe('formatDate', () => {
  it('эквивалентна toLocaleDateString в обеих локалях приложения', () => {
    expect(formatDate(D, 'ru-RU')).toBe(D.toLocaleDateString('ru-RU'));
    expect(formatDate(D, 'en-US')).toBe(D.toLocaleDateString('en-US'));
  });
});

/**
 * Момент времени один, показания часов — разные: пояс отображения задаёт клиент. Здесь же
 * проверяется, что составной ключ кэша форматтеров разбирается обратно (иначе в конструктор
 * Intl уехало бы `ru-RU|Europe/Moscow` целиком).
 */
describe('пояс отображения', () => {
  it('один и тот же момент показывается по часам заданного пояса', () => {
    // 08:53 UTC = 11:53 в Москве и 17:53 в Токио.
    expect(formatDateTimeLong(D, 'ru-RU', 'Europe/Moscow')).toContain('11:53');
    expect(formatDateTimeLong(D, 'ru-RU', 'Asia/Tokyo')).toContain('17:53');
    expect(formatDateTimeLong(D, 'ru-RU', 'UTC')).toContain('8:53');
  });

  it('пояс может сдвинуть и календарную дату', () => {
    const lateEvening = new Date('2026-07-15T22:30:00Z');
    expect(formatDate(lateEvening, 'ru-RU', 'UTC')).toBe('15.07.2026');
    // В Токио это уже следующие сутки.
    expect(formatDate(lateEvening, 'ru-RU', 'Asia/Tokyo')).toBe('16.07.2026');
  });

  it('без пояса форматируем как раньше — в поясе браузера', () => {
    expect(formatDate(D, 'ru-RU')).toBe(D.toLocaleDateString('ru-RU'));
    expect(formatDateTimeLong(D, 'ru-RU')).toBe(
      D.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).replace(/\sг\./g, ''),
    );
  });
});
