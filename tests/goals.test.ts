import { describe, expect, it } from 'vitest';

import { goalPace, goalPercent, monthElapsed } from '../src/lib/goals';

describe('goal pace', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-12-01T00:00:00Z');

  it('measures how far into the month a moment is', () => {
    expect(monthElapsed(start, end, start)).toBe(0);
    expect(monthElapsed(start, end, new Date('2026-11-16T00:00:00Z'))).toBe(0.5);
    expect(monthElapsed(start, end, new Date('2027-01-01T00:00:00Z'))).toBe(1);
  });

  it('is on track within 10% of the straight line, behind below it, reached at the target', () => {
    expect(goalPace(100, 46, 0.5)).toBe('onTrack');
    expect(goalPace(100, 44, 0.5)).toBe('behind');
    expect(goalPace(100, 100, 0.2)).toBe('met');
    expect(goalPace(100, null, 0.5)).toBe('noData');
    expect(goalPace(100, 0, 0)).toBe('onTrack');
  });

  it('caps the bar between 0 and 100', () => {
    expect(goalPercent(200, 50)).toBe(25);
    expect(goalPercent(10, 30)).toBe(100);
    expect(goalPercent(10, -3)).toBe(0);
    expect(goalPercent(10, null)).toBe(0);
  });
});
