import { describe, expect, it } from 'vitest';
import { addDaysToKey, instantToWall, isDateKey, isTimeKey, weekStartKey, wallTimeToInstant } from '@/lib/calendar-dates';

const iso = (result: ReturnType<typeof wallTimeToInstant>) => result.ok ? result.instant.toISOString() : result.reason;

describe('workspace wall-clock conversion', () => {
  it('converts local times with the zone offset in force that day', () => {
    expect(iso(wallTimeToInstant('2026-10-20', '09:00', 'America/New_York'))).toBe('2026-10-20T13:00:00.000Z');
    expect(iso(wallTimeToInstant('2026-12-20', '09:00', 'America/New_York'))).toBe('2026-12-20T14:00:00.000Z');
    expect(iso(wallTimeToInstant('2026-10-15', '12:00', 'Asia/Kolkata'))).toBe('2026-10-15T06:30:00.000Z');
    expect(iso(wallTimeToInstant('2026-10-15', '23:30', 'Pacific/Honolulu'))).toBe('2026-10-16T09:30:00.000Z');
  });

  it('rejects local times that do not exist when clocks jump forward', () => {
    expect(iso(wallTimeToInstant('2026-03-08', '02:30', 'America/New_York'))).toBe('skipped');
    expect(iso(wallTimeToInstant('2026-03-29', '02:30', 'Europe/Paris'))).toBe('skipped');
    expect(iso(wallTimeToInstant('2026-03-08', '03:00', 'America/New_York'))).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(wallTimeToInstant('2026-03-29', '01:59', 'Europe/Paris'))).toBe('2026-03-29T00:59:00.000Z');
  });

  it('uses the first occurrence of a local time repeated when clocks fall back', () => {
    expect(iso(wallTimeToInstant('2026-11-01', '01:30', 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z');
    expect(iso(wallTimeToInstant('2026-10-25', '02:30', 'Europe/Paris'))).toBe('2026-10-25T00:30:00.000Z');
  });

  it('rejects malformed dates and times', () => {
    expect(iso(wallTimeToInstant('2026-02-30', '09:00', 'UTC'))).toBe('invalid');
    expect(iso(wallTimeToInstant('2026-10-20', '24:00', 'UTC'))).toBe('invalid');
    expect(iso(wallTimeToInstant('2026-10-20', '9:00', 'UTC'))).toBe('invalid');
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isTimeKey('23:59')).toBe(true);
  });

  it('round-trips an instant back to the workspace-local date and time', () => {
    expect(instantToWall(new Date('2026-10-20T13:00:00Z'), 'America/New_York')).toEqual({ date: '2026-10-20', time: '09:00' });
    expect(instantToWall(new Date('2026-10-15T00:30:00Z'), 'Pacific/Honolulu')).toEqual({ date: '2026-10-14', time: '14:30' });
    expect(instantToWall(new Date('2026-01-01T00:00:00Z'), 'UTC')).toEqual({ date: '2026-01-01', time: '00:00' });
  });

  it('does arithmetic on dates and finds the Sunday-based week start', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekStartKey('2026-10-15')).toBe('2026-10-11');
    expect(weekStartKey('2026-10-11')).toBe('2026-10-11');
  });
});
