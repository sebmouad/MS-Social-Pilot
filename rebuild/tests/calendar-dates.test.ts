import { describe, expect, it } from 'vitest';
import { workspaceDateKey } from '@/lib/calendar-dates';

describe('workspace calendar dates', () => {
  it('assigns a post to the workspace day across the date line', () => {
    const date = new Date('2026-10-15T00:30:00Z');
    expect(workspaceDateKey(date, 'Pacific/Honolulu')).toBe('2026-10-14');
    expect(workspaceDateKey(date, 'Africa/Casablanca')).toBe('2026-10-15');
  });
});
