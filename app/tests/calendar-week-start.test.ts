import { describe, expect, it } from 'vitest';
import { weekOffsetOfKey, weekStartKey } from '@/lib/calendar-dates';

// 2026-10-21 is a Wednesday.
describe('calendar week start', () => {
  it('keeps Sunday as the default first day', () => {
    expect(weekStartKey('2026-10-21')).toBe('2026-10-18');
    expect(weekOffsetOfKey('2026-10-18')).toBe(0);
  });

  it('starts the week on the workspace first weekday', () => {
    expect(weekStartKey('2026-10-21', 1)).toBe('2026-10-19');
    expect(weekStartKey('2026-10-19', 1)).toBe('2026-10-19');
    expect(weekStartKey('2026-10-18', 1)).toBe('2026-10-12');
    expect(weekStartKey('2026-10-21', 6)).toBe('2026-10-17');
    expect(weekOffsetOfKey('2026-10-18', 1)).toBe(6);
  });

  it('sizes a Monday-first month grid in whole weeks', () => {
    // October 2026 starts on Thursday: 3 leading days + 31 days = 5 weeks Monday-first.
    expect(Math.ceil((weekOffsetOfKey('2026-10-01', 1) + 31) / 7) * 7).toBe(35);
    // Sunday-first leaves 4 leading days: still 5 weeks.
    expect(Math.ceil((weekOffsetOfKey('2026-10-01', 0) + 31) / 7) * 7).toBe(35);
    // November 2026 starts on Sunday: Monday-first needs 6 leading days -> 6 weeks.
    expect(Math.ceil((weekOffsetOfKey('2026-11-01', 1) + 30) / 7) * 7).toBe(42);
  });
});
