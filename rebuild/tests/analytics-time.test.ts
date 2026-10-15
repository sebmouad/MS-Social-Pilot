import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/platforms/registry', () => ({ enabledSocialAccountWhere: async () => ({}) }));
vi.mock('../src/server/data', () => ({ prisma: {} }));

import { addDays, dayEndInstant, dayStartInstant, daysBetween, enumerateDays, isCalendarDay, previousRange, resolveDayRange, safeTimeZone, utcDay, zonedDay } from '../src/server/analytics/time';
import { analyticsRange } from '../src/server/analytics/data';

describe('analytics calendar days', () => {
  it('places an instant on the calendar day of the workspace time zone', () => {
    const instant = new Date('2026-10-02T03:30:00Z');
    expect(zonedDay(instant, 'UTC')).toBe('2026-10-02');
    expect(zonedDay(instant, 'America/New_York')).toBe('2026-10-01');
    expect(zonedDay(instant, 'Asia/Kolkata')).toBe('2026-10-02');
    expect(zonedDay(new Date('2026-10-01T19:00:00Z'), 'Pacific/Auckland')).toBe('2026-10-02');
  });

  it('keeps report days stored at UTC midnight on their own calendar date', () => {
    expect(utcDay(new Date('2026-10-02T00:00:00Z'))).toBe('2026-10-02');
  });

  it('finds the first and last instants of a day, including half-hour zones and short daylight saving days', () => {
    expect(dayStartInstant('2026-10-01', 'Asia/Kolkata').toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(dayStartInstant('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(dayStartInstant('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    // 8 March 2026 is 23 hours long in New York.
    expect(dayEndInstant('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-09T03:59:59.999Z');
    expect(dayEndInstant('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });

  it('does arithmetic on calendar days, not 24-hour blocks', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(enumerateDays({ start: '2026-03-07', end: '2026-03-09' })).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(enumerateDays({ start: '2026-03-09', end: '2026-03-07' })).toEqual([]);
  });

  it('computes the previous period as the same number of days ending the day before', () => {
    expect(previousRange({ start: '2026-10-01', end: '2026-10-30' })).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(previousRange({ start: '2026-10-05', end: '2026-10-05' })).toEqual({ start: '2026-10-04', end: '2026-10-04' });
    expect(previousRange({ start: '2026-03-07', end: '2026-03-09' })).toEqual({ start: '2026-03-04', end: '2026-03-06' });
    const range = { start: '2026-01-15', end: '2026-03-01' };
    expect(enumerateDays(previousRange(range))).toHaveLength(enumerateDays(range).length);
  });

  it('validates dates and falls back to a 30 day range ending today in the zone', () => {
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-10-01')).toBe(true);
    const now = new Date('2026-10-15T01:00:00Z');
    expect(resolveDayRange(undefined, undefined, now, 'UTC')).toEqual({ start: '2026-09-16', end: '2026-10-15' });
    expect(resolveDayRange(undefined, undefined, now, 'America/Los_Angeles')).toEqual({ start: '2026-09-15', end: '2026-10-14' });
    expect(resolveDayRange('2026-10-20', '2026-10-10', now, 'UTC')).toEqual({ start: '2026-09-11', end: '2026-10-10' });
    expect(resolveDayRange('2020-01-01', '2026-10-10', now, 'UTC', { maxDays: 10 })).toEqual({ start: '2026-10-01', end: '2026-10-10' });
    expect(resolveDayRange('nope', 'also-not', now, 'UTC').end).toBe('2026-10-15');
  });

  it('falls back to UTC for unknown time zones', () => {
    expect(safeTimeZone('Mars/Phobos')).toBe('UTC');
    expect(safeTimeZone(null)).toBe('UTC');
    expect(safeTimeZone('Europe/Paris')).toBe('Europe/Paris');
  });

  it('builds the analytics range from whole days in the zone', () => {
    const range = analyticsRange('2026-10-01', '2026-10-02', new Date('2026-10-15T00:00:00Z'), 'Asia/Kolkata');
    expect(range.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-02T18:29:59.999Z');
    expect(range.days).toEqual({ start: '2026-10-01', end: '2026-10-02' });
  });
});
