import { describe, expect, it } from 'vitest';

import { ALL_TIME_DAYS, parseRange, rangeQuery } from '../src/lib/date-range';

// 10 October 2026, 14:30 in Paris (12:30 UTC, summer time).
const now = new Date('2026-10-10T12:30:00Z');
const paris = 'Europe/Paris';

describe('date ranges', () => {
  it('defaults to the last 30 days, today included', () => {
    const range = parseRange({}, paris, now);
    expect(range.key).toBe('30d');
    expect(range.fromDay).toBe('2026-09-11');
    expect(range.toDay).toBe('2026-10-10');
    expect(range.to).toEqual(now);
  });

  it('starts "today" at midnight in the workspace zone, not UTC', () => {
    const range = parseRange({ range: 'today' }, paris, now);
    // Midnight in Paris in October is 22:00 UTC the day before.
    expect(range.from.toISOString()).toBe('2026-10-09T22:00:00.000Z');
    expect(range.to).toEqual(now);
  });

  it('covers the whole of yesterday and nothing of today', () => {
    const range = parseRange({ range: 'yesterday' }, paris, now);
    expect(range.from.toISOString()).toBe('2026-10-08T22:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-09T22:00:00.000Z');
    expect(range.days).toBe(1);
  });

  it('reads this month and the whole of last month', () => {
    expect(parseRange({ range: 'thisMonth' }, paris, now).fromDay).toBe('2026-10-01');
    const last = parseRange({ range: 'lastMonth' }, paris, now);
    expect([last.fromDay, last.toDay]).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('wraps last month back across a new year', () => {
    const january = new Date('2027-01-15T12:00:00Z');
    const last = parseRange({ range: 'lastMonth' }, paris, january);
    expect([last.fromDay, last.toDay]).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('reads this year and all time', () => {
    expect(parseRange({ range: 'thisYear' }, paris, now).fromDay).toBe('2026-01-01');
    expect(parseRange({ range: 'all' }, paris, now).days).toBe(ALL_TIME_DAYS);
  });

  it('takes a custom range in either order, and never past today', () => {
    const range = parseRange({ from: '2026-10-20', to: '2026-09-01' }, paris, now);
    expect(range.key).toBe('custom');
    expect([range.fromDay, range.toDay]).toEqual(['2026-09-01', '2026-10-10']);
    expect(range.to).toEqual(now);
  });

  it('still honours the old days= links', () => {
    expect(parseRange({ days: '7' }, paris, now).key).toBe('7d');
    expect(parseRange({ days: '90' }, paris, now).key).toBe('90d');
    const fourteen = parseRange({ days: '14' }, paris, now);
    expect([fourteen.key, fourteen.fromDay]).toEqual(['custom', '2026-09-27']);
  });

  it('falls back to the default on nonsense', () => {
    expect(parseRange({ range: 'forever', from: 'yesterday' }, paris, now).key).toBe('30d');
  });

  it('writes the range back as the parameters that reproduce it', () => {
    expect(rangeQuery(parseRange({ range: 'lastMonth' }, paris, now))).toBe('range=lastMonth');
    expect(rangeQuery(parseRange({ from: '2026-09-01', to: '2026-09-15' }, paris, now))).toBe(
      'from=2026-09-01&to=2026-09-15',
    );
  });
});
