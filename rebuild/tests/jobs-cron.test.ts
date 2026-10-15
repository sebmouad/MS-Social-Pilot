import { describe, expect, it } from 'vitest';
import { cronMatches } from '../src/server/jobs/cron';

describe('cronMatches', () => {
  it('matches lists, ranges, and steps at minute precision', () => {
    expect(cronMatches('*/5 8-10 * * 1-5', new Date(2026, 9, 12, 9, 10))).toBe(true);
    expect(cronMatches('*/5 8-10 * * 1-5', new Date(2026, 9, 12, 9, 11))).toBe(false);
    expect(cronMatches('0 0 1 * *', new Date(2026, 10, 1, 0, 0))).toBe(true);
    expect(cronMatches('0 * * * *', new Date(2026, 10, 1, 12, 5))).toBe(false);
    expect(cronMatches('15-20 * * * *', new Date(2026, 10, 1, 12, 21))).toBe(false);
  });

  it('applies cron day-of-month and day-of-week rules and Sunday aliases', () => {
    expect(cronMatches('0 0 13 * 5', new Date(2026, 10, 13, 0, 0))).toBe(true); // either day field may match
    expect(cronMatches('0 0 * * 7', new Date(2026, 10, 1, 0, 0))).toBe(true);
  });

  it('rejects malformed and out-of-range expressions', () => {
    expect(() => cronMatches('0 1 * *', new Date())).toThrow();
    expect(() => cronMatches('61 * * * *', new Date())).toThrow();
  });
});
