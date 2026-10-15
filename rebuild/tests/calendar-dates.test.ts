import { describe, expect, it } from 'vitest';
import { adjacentCalendarMonth, calendarMonth, postCalendarDate, workspaceDateKey } from '@/lib/calendar-dates';

describe('workspace calendar dates', () => {
  it('assigns a post to the workspace day across the date line', () => {
    const date = new Date('2026-10-15T00:30:00Z');
    expect(workspaceDateKey(date, 'Pacific/Honolulu')).toBe('2026-10-14');
    expect(workspaceDateKey(date, 'Africa/Casablanca')).toBe('2026-10-15');
  });

  it('selects the workspace month and navigates across year boundaries', () => {
    const now = new Date('2026-01-01T00:30:00Z');
    expect(calendarMonth(undefined, now, 'Pacific/Honolulu')).toEqual({ key: '2025-12', year: 2025, month: 12 });
    expect(calendarMonth('2026-02', now, 'Pacific/Honolulu')).toEqual({ key: '2026-02', year: 2026, month: 2 });
    expect(calendarMonth('2026-13', now, 'Pacific/Honolulu').key).toBe('2025-12');
    expect(adjacentCalendarMonth(2026, 1, -1)).toBe('2025-12');
    expect(adjacentCalendarMonth(2026, 12, 1)).toBe('2027-01');
  });
  it('uses the actual publish date for a published post', () => {
    const scheduledAt = new Date('2026-09-30T12:00:00Z');
    const publishedAt = new Date('2026-10-01T13:00:00Z');
    expect(postCalendarDate({ status: 'published', scheduledAt, publishedAt })).toBe(publishedAt);
    expect(postCalendarDate({ status: 'scheduled', scheduledAt, publishedAt })).toBe(scheduledAt);
  });
});
