import { describe, expect, it } from 'vitest';

import { computedDays, computedDaysBetween, customDatesBetween, orthodoxEaster, westernEaster } from '../src/lib/key-dates';
import { adjustDaySlots, adjustmentFor, type Season } from '../src/lib/seasons';
import { nextAvailableSlot } from '../src/lib/time';

/** Key dates and seasonal modes (NEXT_PHASES H2). */

const iso = (date: Date) => date.toISOString().slice(0, 10);
const dateOf = (year: number, calendar: string, key: string) =>
  computedDays(year, [calendar]).filter((day) => day.key === key).map((day) => day.date);

describe('computed key days', () => {
  it('finds Easter by the computus, western and orthodox', () => {
    expect(iso(westernEaster(2026))).toBe('2026-04-05');
    expect(iso(westernEaster(2027))).toBe('2027-03-28');
    expect(iso(orthodoxEaster(2026))).toBe('2026-04-12');
    expect(iso(orthodoxEaster(2027))).toBe('2027-05-02');
  });

  it('reads lunar dates from the calendars built into Intl', () => {
    expect(dateOf(2026, 'islamic', 'eidAlFitr')).toEqual(['2026-03-20']);
    expect(dateOf(2026, 'lunar_new_year', 'lunarNewYear')).toEqual(['2026-02-17']);
    expect(dateOf(2026, 'jewish', 'roshHashanah')).toEqual(['2026-09-12']);
  });

  it('shows only the calendars asked for, and nothing by default', () => {
    expect(computedDays(2026, [])).toEqual([]);
    const keys = computedDays(2026, ['christian_western']).map((day) => day.key);
    expect(keys).toContain('easter');
    expect(keys).not.toContain('eidAlFitr');
    expect(computedDaysBetween('2026-12-20', '2027-01-02', ['international_days']).map((day) => day.date)).toEqual(['2026-12-31', '2027-01-01']);
  });
});

describe('custom key dates', () => {
  it('fall once, or every year from their first date', () => {
    expect(customDatesBetween('2026-05-10', false, '2026-05-01', '2026-05-31')).toEqual(['2026-05-10']);
    expect(customDatesBetween('2026-05-10', false, '2027-05-01', '2027-05-31')).toEqual([]);
    expect(customDatesBetween('2026-05-10', true, '2027-01-01', '2028-12-31')).toEqual(['2027-05-10', '2028-05-10']);
    expect(customDatesBetween('2026-05-10', true, '2025-01-01', '2025-12-31')).toEqual([]);
    expect(customDatesBetween('2024-02-29', true, '2025-01-01', '2028-12-31')).toEqual(['2028-02-29']);
  });
});

describe('seasonal modes', () => {
  const season = (patch: Partial<Season>): Season => ({ startsOn: '2026-08-01', endsOn: '2026-08-31', targetIds: [], rule: 'pause', shiftMinutes: 0, extraTimes: [], ...patch });
  const slots = [
    { hour: 9, minute: 0 },
    { hour: 13, minute: 0 },
    { hour: 18, minute: 0 },
  ];

  it('apply only inside their dates and to their Pages', () => {
    expect(adjustmentFor([season({})], ['p1'], '2026-07-31')).toBeNull();
    expect(adjustmentFor([season({ targetIds: ['p2'] })], ['p1'], '2026-08-05')).toBeNull();
    expect(adjustmentFor([season({ targetIds: ['p2'] })], ['p1', 'p2'], '2026-08-05')?.pause).toBe(true);
  });

  it('pause, shift, keep fewer or add times', () => {
    const on = (patch: Partial<Season>) => adjustDaySlots(slots, adjustmentFor([season(patch)], [], '2026-08-05'));
    expect(on({ rule: 'pause' })).toEqual([]);
    expect(on({ rule: 'shift', shiftMinutes: 90 })).toEqual([
      { hour: 10, minute: 30 },
      { hour: 14, minute: 30 },
      { hour: 19, minute: 30 },
    ]);
    expect(on({ rule: 'shift', shiftMinutes: 360 })).toHaveLength(2);
    expect(on({ rule: 'fewer' })).toEqual([slots[0], slots[2]]);
    expect(on({ rule: 'more', extraTimes: ['20:30', 'bad'] })).toHaveLength(4);
  });

  it('move the next free queue time', () => {
    const every = [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({ dayOfWeek, hour: 9, minute: 0 }));
    const paused = [season({ startsOn: '2026-08-03', endsOn: '2026-08-04' })];
    const slot = nextAvailableSlot({
      slots: every,
      timeZone: 'UTC',
      takenUtc: [],
      now: new Date('2026-08-03T06:00:00Z'),
      adjustDay: (day, daySlots) => adjustDaySlots(daySlots, adjustmentFor(paused, [], day)),
    });
    expect(slot?.toISOString()).toBe('2026-08-05T09:00:00.000Z');
  });
});
