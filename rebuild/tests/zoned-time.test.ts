import { describe, expect, it } from 'vitest';
import { dateToZonedLocal, zonedLocalToDate, zoneOffsetMinutes } from '@/lib/publishing/zoned-time';

describe('workspace time zone conversion', () => {
  it('reads a wall-clock time in a named zone as the right instant', () => {
    expect(zonedLocalToDate('2026-07-01T09:30', 'UTC')?.toISOString()).toBe('2026-07-01T09:30:00.000Z');
    expect(zonedLocalToDate('2026-07-01T09:30', 'Europe/Paris')?.toISOString()).toBe('2026-07-01T07:30:00.000Z');
    expect(zonedLocalToDate('2026-01-15T09:30', 'Europe/Paris')?.toISOString()).toBe('2026-01-15T08:30:00.000Z');
    expect(zonedLocalToDate('2026-01-15T09:30', 'America/New_York')?.toISOString()).toBe('2026-01-15T14:30:00.000Z');
    expect(zonedLocalToDate('2026-03-01T08:00', 'Asia/Kolkata')?.toISOString()).toBe('2026-03-01T02:30:00.000Z');
  });

  it('rejects malformed and impossible values', () => {
    expect(zonedLocalToDate('', 'UTC')).toBeNull();
    expect(zonedLocalToDate('2026-02-30T10:00', 'UTC')).toBeNull();
    expect(zonedLocalToDate('2026-02-10 10:00', 'UTC')).toBeNull();
    expect(zonedLocalToDate('2026-02-10T25:00', 'UTC')).toBeNull();
    expect(zonedLocalToDate('2026-02-10T10:00', 'Not/AZone')).toBeNull();
  });

  it('round-trips through the zone wall clock', () => {
    const instant = new Date('2026-10-20T18:45:00.000Z');
    for (const zone of ['UTC', 'Europe/Paris', 'America/Los_Angeles', 'Pacific/Auckland']) {
      expect(zonedLocalToDate(dateToZonedLocal(instant, zone), zone)?.toISOString()).toBe(instant.toISOString());
    }
  });

  it('follows daylight-saving offsets', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Europe/Paris')).toBe(120);
    expect(zoneOffsetMinutes(new Date('2026-12-01T12:00:00Z'), 'Europe/Paris')).toBe(60);
  });
});
