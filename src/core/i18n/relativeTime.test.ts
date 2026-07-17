import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTime';

const BASE = '2026-07-11T12:00:00Z';
// Ожидаемый полный формат выражен независимо от formatDateTimeLong: словесная дата + короткое
// время, в русском «г.» после года вырезано (`\s` — потому что вид пробела зависит от ICU).
const longRu = (iso: string) =>
  new Date(iso)
    .toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })
    .replace(/\sг\./, '');
const base = new Date(BASE).getTime();
const at = (ms: number) => base + ms; // «now» = базовый момент + смещение

const ru = (iso: string, now: number) =>
  formatRelativeTime(iso, { locale: 'ru-RU', now, justNow: 'только что' });
const en = (iso: string, now: number) =>
  formatRelativeTime(iso, { locale: 'en-US', now, justNow: 'just now' });

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime (ru) — таблица апроксимации', () => {
  it('20 секунд → «только что»', () => {
    expect(ru(BASE, at(20 * SEC))?.label).toBe('только что');
  });
  it('1 минута → «1 минуту назад» (склонение)', () => {
    expect(ru(BASE, at(MIN))?.label).toBe('1 минуту назад');
  });
  it('5 минут → «5 минут назад»', () => {
    expect(ru(BASE, at(5 * MIN))?.label).toBe('5 минут назад');
  });
  it('59 минут → «59 минут назад»', () => {
    expect(ru(BASE, at(59 * MIN))?.label).toBe('59 минут назад');
  });
  it('90 минут → «1 час назад» (округление вниз)', () => {
    expect(ru(BASE, at(90 * MIN))?.label).toBe('1 час назад');
  });
  it('23 часа → «23 часа назад»', () => {
    expect(ru(BASE, at(23 * HOUR))?.label).toBe('23 часа назад');
  });
  it('25 часов → «1 день назад» (округление вниз)', () => {
    expect(ru(BASE, at(25 * HOUR))?.label).toBe('1 день назад');
  });
  it('6 дней → «6 дней назад»', () => {
    expect(ru(BASE, at(6 * DAY))?.label).toBe('6 дней назад');
  });
  it('40 дней → абсолютная дата-время словами, без «г.»', () => {
    const res = ru(BASE, at(40 * DAY));
    expect(res?.label).toBe(longRu(BASE));
    expect(res?.label).not.toContain(' г.');
    expect(res?.label).toBe(res?.title);
  });
});

describe('formatRelativeTime (en)', () => {
  it('5 минут → «5 minutes ago»', () => {
    expect(en(BASE, at(5 * MIN))?.label).toBe('5 minutes ago');
  });
  it('1 час → «1 hour ago»', () => {
    expect(en(BASE, at(HOUR))?.label).toBe('1 hour ago');
  });
  it('20 секунд → «just now»', () => {
    expect(en(BASE, at(20 * SEC))?.label).toBe('just now');
  });
});

describe('formatRelativeTime — прочее', () => {
  it('title всегда = полная дата-время словами', () => {
    expect(ru(BASE, at(5 * MIN))?.title).toBe(longRu(BASE));
  });
  it('битая дата → null', () => {
    expect(ru('не-дата', at(0))).toBeNull();
  });
  it('пустое значение → null', () => {
    expect(formatRelativeTime(undefined, { locale: 'ru-RU', now: base, justNow: '—' })).toBeNull();
  });
  it('время в будущем в пределах допуска на рассинхрон часов → «только что»', () => {
    expect(ru(BASE, at(-10 * SEC))?.label).toBe('только что');
    // Клиент без NTP запросто отстаёт на пару минут — свежие серверные метки не должны
    // разом превращаться в абсолютные даты.
    expect(ru(BASE, at(-3 * MIN))?.label).toBe('только что');
  });
  it('время в будущем дальше допуска → абсолютная дата, а не вечное «только что»', () => {
    // Больше, чем терпимый рассинхрон часов, — относительное время врало бы; TZ-баг бэка
    // (метка на день вперёд) висел бы «только что», пока now её не догонит.
    const res = ru(BASE, at(-3 * DAY));
    expect(res?.label).toBe(longRu(BASE));
    expect(res?.label).toBe(res?.title);
  });
});
