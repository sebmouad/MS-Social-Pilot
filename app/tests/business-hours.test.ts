import { describe, expect, it } from 'vitest';
import { businessMs, calendarMs, parseBusinessHours, businessHoursOrNull, zonedInstant } from '../src/modules/analytics/reports/generation/business-hours';

const wk = { days: [1, 2, 3, 4, 5], start: 9, end: 18 };
const d = (iso: string) => new Date(iso);
const min = (n: number) => n * 60_000;
const hr = (n: number) => n * 3_600_000;
const bm = (a: string, b: string, tz: string, h = wk) => businessMs(d(a), d(b), h, tz);

describe('business-hours validation', () => {
  it('treats no day as not set', () => {
    expect(parseBusinessHours({ days: [], start: 9, end: 18 })).toBeNull();
    expect(businessHoursOrNull({ days: [], start: 9, end: 18 })).toBeNull();
  });
  it('rejects zero-length, reversed and out-of-range hours', () => {
    expect(() => parseBusinessHours({ days: [1], start: 9, end: 9 })).toThrow(RangeError);
    expect(() => parseBusinessHours({ days: [1], start: 18, end: 9 })).toThrow(RangeError);
    expect(() => parseBusinessHours({ days: [1], start: -1, end: 9 })).toThrow(RangeError);
    expect(() => parseBusinessHours({ days: [1], start: 0, end: 25 })).toThrow(RangeError);
    expect(() => parseBusinessHours({ days: [1], start: 9.5, end: 18 })).toThrow(RangeError);
    expect(() => parseBusinessHours({ days: [7], start: 9, end: 18 })).toThrow(RangeError);
    expect(businessHoursOrNull({ days: [1], start: 9, end: 9 })).toBeNull();
  });
  it('normalizes duplicate and unordered days', () => {
    expect(parseBusinessHours({ days: [5, 1, 1], start: 9, end: 18 })).toEqual({ days: [1, 5], start: 9, end: 18 });
  });
  it('businessMs refuses unusable hours instead of guessing', () => {
    expect(() => businessMs(d('2026-10-05T08:00:00Z'), d('2026-10-05T09:00:00Z'), { days: [1], start: 9, end: 9 }, 'UTC')).toThrow(RangeError);
    expect(() => businessMs(d('2026-10-05T08:00:00Z'), d('2026-10-05T09:00:00Z'), { days: [], start: 9, end: 18 }, 'UTC')).toThrow(RangeError);
  });
});

describe('business-hours arithmetic (UTC)', () => {
  // 2026-10-05 is a Monday.
  it('counts a wait fully inside one open window', () => {
    expect(bm('2026-10-05T10:00:00Z', '2026-10-05T10:20:00Z', 'UTC')).toBe(min(20));
  });
  it('start is inclusive and end exclusive of the window', () => {
    expect(bm('2026-10-05T09:00:00Z', '2026-10-05T18:00:00Z', 'UTC')).toBe(hr(9));
    expect(bm('2026-10-05T18:00:00Z', '2026-10-05T19:00:00Z', 'UTC')).toBe(0);
  });
  it('a message arriving before opening starts the clock at opening', () => {
    expect(bm('2026-10-05T05:00:00Z', '2026-10-05T09:30:00Z', 'UTC')).toBe(min(30));
  });
  it('a message arriving after closing waits only from next opening (overnight gap)', () => {
    expect(bm('2026-10-05T23:00:00Z', '2026-10-06T09:05:00Z', 'UTC')).toBe(min(5));
    expect(bm('2026-10-05T17:50:00Z', '2026-10-06T09:10:00Z', 'UTC')).toBe(min(20));
  });
  it('outside hours entirely is zero', () => {
    expect(bm('2026-10-05T19:00:00Z', '2026-10-06T08:00:00Z', 'UTC')).toBe(0);
  });
  it('skips weekends', () => {
    expect(bm('2026-10-09T17:00:00Z', '2026-10-12T10:00:00Z', 'UTC')).toBe(hr(2));
    expect(bm('2026-10-10T10:00:00Z', '2026-10-11T20:00:00Z', 'UTC')).toBe(0);
  });
  it('a reply the next week counts every open day in between', () => {
    expect(bm('2026-10-05T17:00:00Z', '2026-10-12T10:00:00Z', 'UTC')).toBe(hr(1) + 4 * hr(9) + hr(1));
  });
  it('honours closed weekdays other than the weekend', () => {
    const tueThu = { days: [2, 4], start: 9, end: 17 };
    expect(bm('2026-10-05T00:00:00Z', '2026-10-10T00:00:00Z', 'UTC', tueThu)).toBe(2 * hr(8));
  });
  it('supports a window that ends at midnight (end 24) and a seven-day week', () => {
    const all = { days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 24 };
    expect(bm('2026-10-10T20:00:00Z', '2026-10-12T04:00:00Z', 'UTC', all)).toBe(hr(32));
    const late = { days: [1], start: 20, end: 24 };
    expect(bm('2026-10-05T19:00:00Z', '2026-10-06T05:00:00Z', 'UTC', late)).toBe(hr(4));
  });
  it('returns zero for equal or reversed instants', () => {
    expect(bm('2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', 'UTC')).toBe(0);
    expect(bm('2026-10-05T11:00:00Z', '2026-10-05T10:00:00Z', 'UTC')).toBe(0);
    expect(calendarMs(d('2026-10-05T11:00:00Z'), d('2026-10-05T10:00:00Z'))).toBe(0);
    expect(calendarMs(d('2026-10-05T10:00:00Z'), d('2026-10-05T10:20:00Z'))).toBe(min(20));
  });
  it('business time never exceeds calendar time', () => {
    const a = d('2026-10-02T15:30:00Z'); const b = d('2026-10-20T08:00:00Z');
    expect(businessMs(a, b, wk, 'UTC')).toBeLessThanOrEqual(calendarMs(a, b));
  });
  it('a wait longer than the day cap is counted only up to the cap', () => {
    const total = businessMs(d('2024-01-01T00:00:00Z'), d('2027-01-01T00:00:00Z'), wk, 'UTC');
    expect(total).toBeLessThan(hr(9) * 400);
    expect(total).toBeGreaterThan(hr(9) * 250);
  });
});

describe('business-hours arithmetic across time zones', () => {
  it('uses the workspace clock, not UTC', () => {
    expect(bm('2026-10-05T06:30:00Z', '2026-10-05T07:30:00Z', 'Europe/Paris')).toBe(min(30));
    expect(bm('2026-10-05T23:00:00Z', '2026-10-05T23:45:00Z', 'Australia/Sydney')).toBe(min(45));
  });
  it('uses the workspace weekday, which can differ from UTC weekday', () => {
    expect(bm('2026-10-10T20:00:00Z', '2026-10-11T04:00:00Z', 'Pacific/Auckland')).toBe(0);
  });

  describe('Europe/Paris', () => {
    it('spring forward (Sun 2026-03-29): Friday to Monday and the Monday window', () => {
      expect(bm('2026-03-27T16:00:00Z', '2026-03-30T08:00:00Z', 'Europe/Paris')).toBe(hr(2)); // Fri 17-18 CET, Mon 09-10 CEST
      expect(bm('2026-03-30T07:00:00Z', '2026-03-30T16:00:00Z', 'Europe/Paris')).toBe(hr(9));
    });
    it('a window containing the spring-forward gap loses an hour of real time', () => {
      const sunday = { days: [0], start: 0, end: 6 };
      expect(bm('2026-03-28T22:00:00Z', '2026-03-29T05:00:00Z', 'Europe/Paris', sunday)).toBe(hr(5));
    });
    it('a window containing the fall-back repeat gains an hour of real time', () => {
      const sunday = { days: [0], start: 0, end: 6 };
      expect(bm('2026-10-24T22:00:00Z', '2026-10-25T06:00:00Z', 'Europe/Paris', sunday)).toBe(hr(7));
    });
    it('a window opening inside the gap opens at the first real instant after it', () => {
      const early = { days: [0], start: 2, end: 5 };
      expect(bm('2026-03-29T00:00:00Z', '2026-03-29T04:00:00Z', 'Europe/Paris', early)).toBe(hr(2));
    });
    it('a close inside the repeated hour closes at its last occurrence', () => {
      const h = { days: [0], start: 1, end: 2 };
      expect(bm('2026-10-24T22:00:00Z', '2026-10-25T04:00:00Z', 'Europe/Paris', h)).toBe(hr(2));
    });
    it('the days either side of DST are plain nine-hour days', () => {
      expect(bm('2026-10-23T07:00:00Z', '2026-10-23T16:00:00Z', 'Europe/Paris')).toBe(hr(9));
      expect(bm('2026-10-26T08:00:00Z', '2026-10-26T17:00:00Z', 'Europe/Paris')).toBe(hr(9));
    });
  });

  describe('America/New_York', () => {
    it('spring forward Sun 2026-03-08: Friday evening to Monday morning', () => {
      expect(bm('2026-03-06T22:00:00Z', '2026-03-09T14:00:00Z', 'America/New_York')).toBe(hr(2));
    });
    it('fall back Sun 2026-11-01: Friday evening to Monday morning', () => {
      expect(bm('2026-10-30T21:00:00Z', '2026-11-02T15:00:00Z', 'America/New_York')).toBe(hr(2));
    });
    it('weekday windows shift in UTC across the change', () => {
      expect(bm('2026-11-02T14:00:00Z', '2026-11-02T23:00:00Z', 'America/New_York')).toBe(hr(9));
      expect(bm('2026-10-30T13:00:00Z', '2026-10-30T22:00:00Z', 'America/New_York')).toBe(hr(9));
    });
    it('a window straddling fall back gains the extra hour', () => {
      const sunday = { days: [0], start: 0, end: 4 };
      expect(bm('2026-11-01T03:00:00Z', '2026-11-01T10:00:00Z', 'America/New_York', sunday)).toBe(hr(5));
    });
  });

  describe('Africa/Casablanca (offset moves for Ramadan)', () => {
    it('is a plain nine-hour day whatever the current offset', () => {
      for (const day of ['2026-01-05', '2026-03-02', '2026-03-23', '2026-06-01']) {
        const open = zonedInstant(day, 9, 'Africa/Casablanca', 'open');
        const close = zonedInstant(day, 18, 'Africa/Casablanca', 'close');
        expect(close - open).toBe(hr(9));
        expect(businessMs(new Date(open - hr(3)), new Date(close + hr(3)), wk, 'Africa/Casablanca')).toBe(hr(9));
      }
    });
    it('honours the offset change in the wall clock', () => {
      expect(new Date(zonedInstant('2026-03-02', 10, 'Africa/Casablanca', 'open')).toISOString()).toBe('2026-03-02T10:00:00.000Z');
      expect(new Date(zonedInstant('2026-04-06', 10, 'Africa/Casablanca', 'open')).toISOString()).toBe('2026-04-06T09:00:00.000Z');
    });
    it('a Friday-evening to Monday wait spans the weekend', () => {
      const mon = zonedInstant('2026-03-23', 10, 'Africa/Casablanca', 'open');
      expect(businessMs(d('2026-03-20T17:00:00Z'), new Date(mon), wk, 'Africa/Casablanca')).toBe(hr(2));
    });
  });

  describe('zonedInstant', () => {
    it('resolves ordinary, ambiguous and nonexistent wall times', () => {
      expect(new Date(zonedInstant('2026-07-01', 9, 'Europe/Paris', 'open')).toISOString()).toBe('2026-07-01T07:00:00.000Z');
      expect(new Date(zonedInstant('2026-10-25', 2, 'Europe/Paris', 'open')).toISOString()).toBe('2026-10-25T00:00:00.000Z');
      expect(new Date(zonedInstant('2026-10-25', 2, 'Europe/Paris', 'close')).toISOString()).toBe('2026-10-25T01:00:00.000Z');
      expect(new Date(zonedInstant('2026-03-29', 2, 'Europe/Paris', 'open')).toISOString()).toBe('2026-03-29T01:00:00.000Z');
      expect(new Date(zonedInstant('2026-03-29', 2, 'Europe/Paris', 'close')).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    });
  });
});
