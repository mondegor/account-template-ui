import { describe, expect, it } from 'vitest';
import { dayGroup } from './format';

/** «Сейчас» — 00:30 11 октября по Москве; в UTC это ещё 10 октября. */
const NOW = Date.parse('2026-10-10T21:30:00Z');
const OPTS = {
  locale: 'en-US',
  timeZone: 'Europe/Moscow',
  now: NOW,
  today: 'Today',
  yesterday: 'Yesterday',
};

describe('dayGroup', () => {
  it('today and yesterday are counted by the profile time zone, not by UTC', () => {
    expect(dayGroup('2026-10-10T21:10:00Z', OPTS)).toEqual({ key: '2026-10-11', label: 'Today' });
    expect(dayGroup('2026-10-10T20:50:00Z', OPTS)).toEqual({
      key: '2026-10-10',
      label: 'Yesterday',
    });
  });

  it('older days are named by date, with the year only when it is not the current one', () => {
    expect(dayGroup('2026-10-08T09:00:00Z', OPTS).label).toBe('October 8');
    expect(dayGroup('2025-12-31T09:00:00Z', OPTS).label).toBe('December 31, 2025');
  });

  it('yesterday crosses a month boundary', () => {
    const opts = { ...OPTS, now: Date.parse('2026-11-01T09:00:00Z') };
    expect(dayGroup('2026-10-31T09:00:00Z', opts).label).toBe('Yesterday');
  });

  it('an unparsable value is a group of its own, shown as is', () => {
    expect(dayGroup('not-a-date', OPTS)).toEqual({ key: 'not-a-date', label: 'not-a-date' });
  });
});
