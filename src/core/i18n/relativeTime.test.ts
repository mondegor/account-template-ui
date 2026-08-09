import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTime';

const BASE = '2026-07-11T12:00:00Z';
// Ожидаемый полный формат выражен независимо от formatDateTimeLong: словесная дата + короткое
// время.
const longEn = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
const base = new Date(BASE).getTime();
const at = (ms: number) => base + ms; // «now» = базовый момент + смещение

const en = (iso: string, now: number) =>
  formatRelativeTime(iso, { locale: 'en-US', now, justNow: 'just now' });

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime: the approximation table', () => {
  it('20 seconds becomes «just now»', () => {
    expect(en(BASE, at(20 * SEC))?.label).toBe('just now');
  });
  it('1 minute becomes «1 minute ago»', () => {
    expect(en(BASE, at(MIN))?.label).toBe('1 minute ago');
  });
  it('5 minutes become «5 minutes ago»', () => {
    expect(en(BASE, at(5 * MIN))?.label).toBe('5 minutes ago');
  });
  it('59 minutes become «59 minutes ago»', () => {
    expect(en(BASE, at(59 * MIN))?.label).toBe('59 minutes ago');
  });
  it('exactly an hour becomes «1 hour ago»', () => {
    expect(en(BASE, at(HOUR))?.label).toBe('1 hour ago');
  });
  it('90 minutes become «1 hour ago» (rounded down)', () => {
    expect(en(BASE, at(90 * MIN))?.label).toBe('1 hour ago');
  });
  it('23 hours become «23 hours ago»', () => {
    expect(en(BASE, at(23 * HOUR))?.label).toBe('23 hours ago');
  });
  it('25 hours become «1 day ago» (rounded down)', () => {
    expect(en(BASE, at(25 * HOUR))?.label).toBe('1 day ago');
  });
  it('6 days become «6 days ago»', () => {
    expect(en(BASE, at(6 * DAY))?.label).toBe('6 days ago');
  });
  it('40 days become an absolute date-time in words', () => {
    const res = en(BASE, at(40 * DAY));
    expect(res?.label).toBe(longEn(BASE));
    expect(res?.label).toBe(res?.title);
  });
});

describe('formatRelativeTime: the rest', () => {
  it('the title is always the full date-time in words', () => {
    expect(en(BASE, at(5 * MIN))?.title).toBe(longEn(BASE));
  });
  it('a broken date gives null', () => {
    expect(en('not-a-date', at(0))).toBeNull();
  });
  it('an empty value gives null', () => {
    expect(formatRelativeTime(undefined, { locale: 'en-US', now: base, justNow: '—' })).toBeNull();
  });
  it('a future timestamp within the clock-skew tolerance reads as «just now»', () => {
    expect(en(BASE, at(-10 * SEC))?.label).toBe('just now');
    // Клиент без NTP запросто отстаёт на пару минут — свежие серверные метки не должны
    // разом превращаться в абсолютные даты.
    expect(en(BASE, at(-3 * MIN))?.label).toBe('just now');
  });
  it('a future timestamp beyond the tolerance gives an absolute date, not an eternal «just now»', () => {
    // Больше, чем терпимый рассинхрон часов, — относительное время врало бы; TZ-баг бэка
    // (метка на день вперёд) висел бы «только что», пока now её не догонит.
    const res = en(BASE, at(-3 * DAY));
    expect(res?.label).toBe(longEn(BASE));
    expect(res?.label).toBe(res?.title);
  });
});

/**
 * Пояс отображения. Он обязан доезжать не только до `title`, но и до `label`: старше порога
 * и «из будущего» подпись сама становится абсолютной датой — именно этой веткой рисуются даты
 * регистрации. Сама арифметика «N назад» считается на абсолютных дельтах и от пояса не зависит.
 */
describe('formatRelativeTime: display time zone', () => {
  const tokyo = (iso: string, now: number) =>
    formatRelativeTime(iso, {
      locale: 'en-US',
      now,
      justNow: 'just now',
      timeZone: 'Asia/Tokyo',
    });

  it('the title is computed in the given time zone', () => {
    // 12:00 UTC = 21:00 в Токио (в английском формате — 9:00 PM).
    expect(tokyo(BASE, at(5 * MIN))?.title).toContain('9:00 PM');
    expect(en(BASE, at(5 * MIN))?.title).not.toContain('9:00 PM');
  });

  it('an absolute label (past the threshold) is in the given time zone too', () => {
    const res = tokyo(BASE, at(40 * DAY));
    expect(res?.label).toContain('9:00 PM');
    expect(res?.label).toBe(res?.title);
  });

  it('the absolute label of a future timestamp is in the given time zone too', () => {
    expect(tokyo(BASE, at(-3 * DAY))?.label).toContain('9:00 PM');
  });

  it('the relative label does not depend on the time zone', () => {
    expect(tokyo(BASE, at(5 * MIN))?.label).toBe(en(BASE, at(5 * MIN))?.label);
  });
});
