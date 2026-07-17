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
