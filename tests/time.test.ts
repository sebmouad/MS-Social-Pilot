import { describe, expect, it } from 'vitest';

import { firstRealInstant, isValidTimeZone, localInputToUtc, monthGrid, nextAvailableSlot, type QueueSlotDefinition, utcToLocalInput, wallClockExists } from '../src/lib/time';

describe('timezone conversion', () => {
  it('interprets wall-clock input in the given zone', () => {
    // Paris is UTC+1 in January.
    expect(localInputToUtc('2026-01-15T09:00', 'Europe/Paris').toISOString()).toBe(
      '2026-01-15T08:00:00.000Z',
    );
  });

  it('applies summer time when it is in effect', () => {
    // Paris is UTC+2 in July: the same 09:00 is a different instant.
    expect(localInputToUtc('2026-07-15T09:00', 'Europe/Paris').toISOString()).toBe(
      '2026-07-15T07:00:00.000Z',
    );
  });

  it('round-trips back to the same wall clock', () => {
    const utc = localInputToUtc('2026-07-15T09:00', 'America/New_York');
    expect(utcToLocalInput(utc, 'America/New_York')).toBe('2026-07-15T09:00');
  });

  it('accepts an input that already carries seconds', () => {
    expect(localInputToUtc('2026-01-15T09:00:00', 'UTC').toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('validates IANA names', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('nextAvailableSlot', () => {
  // Monday 09:00 and 15:00, Wednesday 09:00.
  const slots: QueueSlotDefinition[] = [
    { dayOfWeek: 1, hour: 9, minute: 0 },
    { dayOfWeek: 1, hour: 15, minute: 0 },
    { dayOfWeek: 3, hour: 9, minute: 0 },
  ];

  it('returns the next slot later the same day', () => {
    // Monday 2026-01-05, 10:00 UTC — the 15:00 slot is still ahead.
    const slot = nextAvailableSlot({
      slots,
      timeZone: 'UTC',
      takenUtc: [],
      now: new Date('2026-01-05T10:00:00Z'),
    });
    expect(slot?.toISOString()).toBe('2026-01-05T15:00:00.000Z');
  });

  it('skips slots that are already taken', () => {
    const slot = nextAvailableSlot({
      slots,
      timeZone: 'UTC',
      takenUtc: [new Date('2026-01-05T15:00:00Z')],
      now: new Date('2026-01-05T10:00:00Z'),
    });
    // Monday's remaining slot is booked, so it rolls to Wednesday.
    expect(slot?.toISOString()).toBe('2026-01-07T09:00:00.000Z');
  });

  it('rolls into the following week when the current one is exhausted', () => {
    const slot = nextAvailableSlot({
      slots,
      timeZone: 'UTC',
      takenUtc: [],
      now: new Date('2026-01-08T10:00:00Z'), // Thursday
    });
    expect(slot?.toISOString()).toBe('2026-01-12T09:00:00.000Z'); // next Monday
  });

  it('keeps the local wall-clock time across a DST change', () => {
    // Europe/Paris moves to UTC+2 on 2026-03-29. A Monday 09:00 slot must
    // stay at 09:00 local, i.e. 07:00 UTC rather than 08:00.
    const slot = nextAvailableSlot({
      slots: [{ dayOfWeek: 1, hour: 9, minute: 0 }],
      timeZone: 'Europe/Paris',
      takenUtc: [],
      now: new Date('2026-03-27T10:00:00Z'), // Friday before the change
    });
    expect(slot?.toISOString()).toBe('2026-03-30T07:00:00.000Z');
  });

  it('returns null when no slots are configured', () => {
    expect(nextAvailableSlot({ slots: [], timeZone: 'UTC', takenUtc: [], now: new Date() })).toBeNull();
  });

  it('returns null when every slot within the horizon is taken', () => {
    const slot = nextAvailableSlot({
      slots: [{ dayOfWeek: 1, hour: 9, minute: 0 }],
      timeZone: 'UTC',
      takenUtc: [new Date('2026-01-12T09:00:00Z')],
      now: new Date('2026-01-05T10:00:00Z'),
      horizonDays: 8,
    });
    expect(slot).toBeNull();
  });
});

/**
 * The hour that does not happen, and the hour that happens twice.
 *
 * A scheduler is exactly the product where these matter, and they are the two
 * cases nobody writes by hand because they only occur on two mornings a year.
 */
describe('the clocks changing', () => {
  // London, 2026: forward on 29 March, back on 25 October.
  const FORWARD = '2026-03-29';
  const BACK = '2026-10-25';

  it('knows an ordinary time exists', () => {
    expect(wallClockExists('2026-06-15T01:30', 'Europe/London')).toBe(true);
  });

  it('knows the spring-forward hour does not', () => {
    // The clocks read 00:59 and then 02:00, so the whole hour from 01:00 up
    // to 02:00 is missing — 01:00 itself included, which is easy to get wrong.
    expect(wallClockExists(`${FORWARD}T00:59`, 'Europe/London')).toBe(true);
    expect(wallClockExists(`${FORWARD}T01:00`, 'Europe/London')).toBe(false);
    expect(wallClockExists(`${FORWARD}T01:30`, 'Europe/London')).toBe(false);
    expect(wallClockExists(`${FORWARD}T01:59`, 'Europe/London')).toBe(false);
    expect(wallClockExists(`${FORWARD}T02:00`, 'Europe/London')).toBe(true);
  });

  it('does not mistake the repeated autumn hour for a missing one', () => {
    // 01:30 happens twice on this date. Both are real; only one is chosen.
    expect(wallClockExists(`${BACK}T01:30`, 'Europe/London')).toBe(true);
  });

  it('treats the gap as local to the zone', () => {
    // The same wall clock is perfectly ordinary in a zone whose clocks move on
    // a different date, which is why this cannot be a calendar-wide rule.
    expect(wallClockExists(`${FORWARD}T01:30`, 'America/New_York')).toBe(true);
    expect(wallClockExists('2026-03-08T02:30', 'America/New_York')).toBe(false);
  });

  it('rolls a missing time forward to the moment the clocks land', () => {
    const instant = firstRealInstant(`${FORWARD}T01:30`, 'Europe/London');

    // 02:00 BST is 01:00 UTC — the first moment that exists after the gap.
    expect(instant.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(utcToLocalInput(instant, 'Europe/London')).toBe(`${FORWARD}T02:00`);
  });

  it('leaves a time that exists exactly where it is', () => {
    const asked = '2026-06-15T09:30';
    const instant = firstRealInstant(asked, 'Europe/London');

    expect(utcToLocalInput(instant, 'Europe/London')).toBe(asked);
  });

  it('picks one of the two repeated hours and stays with it', () => {
    // Ambiguity cannot be resolved from the input alone, so the requirement is
    // only that it is stable: a post shown at 01:30 must not become 00:30 on
    // the next render.
    const instant = firstRealInstant(`${BACK}T01:30`, 'Europe/London');
    const shown = utcToLocalInput(instant, 'Europe/London');

    expect(shown).toBe(`${BACK}T01:30`);
    expect(utcToLocalInput(localInputToUtc(shown, 'Europe/London'), 'Europe/London')).toBe(shown);
  });
});

describe('a recurring slot on the morning the clocks change', () => {
  /** The next date in this zone where the given wall clock does not exist. */
  function nextGapDate(time: string, timeZone: string, from = new Date()): string {
    for (let day = 1; day < 400; day += 1) {
      const date = new Date(from.getTime() + day * 24 * 60 * 60 * 1000);
      const stamp = date.toISOString().slice(0, 10);
      if (!wallClockExists(`${stamp}T${time}`, timeZone)) return stamp;
    }
    throw new Error('no clock change found');
  }

  it('publishes when the clocks land, not an hour early', () => {
    // A standing weekly instruction, not a time somebody typed — so it moves
    // rather than being refused, which is the opposite of what a one-off
    // scheduled post should do.
    const stamp = nextGapDate('01:30', 'Europe/London');
    const day = new Date(`${stamp}T12:00:00Z`).getUTCDay();

    const slot = nextAvailableSlot({
      slots: [{ dayOfWeek: day, hour: 1, minute: 30 }],
      timeZone: 'Europe/London',
      takenUtc: [],
      now: new Date(`${stamp}T00:00:00Z`),
      horizonDays: 1,
    });

    expect(slot).not.toBeNull();

    // The hour it was meant to be in starts at 02:00; an hour early would be
    // 00:30, which is what converting the wall clock directly returns.
    const shown = utcToLocalInput(slot!, 'Europe/London');
    expect(shown).toBe(`${stamp}T02:00`);
  });

  it('leaves an ordinary week exactly where it was', () => {
    const slot = nextAvailableSlot({
      slots: [{ dayOfWeek: 3, hour: 9, minute: 0 }],
      timeZone: 'Europe/London',
      takenUtc: [],
      now: new Date('2026-06-15T00:00:00Z'),
      horizonDays: 7,
    });

    expect(utcToLocalInput(slot!, 'Europe/London')).toBe('2026-06-17T09:00');
  });
});

/**
 * The calendar grid.
 *
 * Every square is one local day, and the page buckets posts into them by
 * formatting `scheduledAt` in the workspace zone. So a square that is not
 * actually the day it claims to be does not merely look wrong — the posts
 * scheduled for the missing day have nowhere to render and vanish.
 *
 * Four real zones change their clocks at midnight, which is where this bites.
 */
describe('monthGrid', () => {
  /** Zone, month index, and the day that has no midnight in 2026. */
  const MIDNIGHT_GAPS = [
    ['America/Santiago', 8, '2026-09-06'],
    ['America/Havana', 2, '2026-03-08'],
    ['Asia/Beirut', 2, '2026-03-29'],
    ['Africa/Cairo', 3, '2026-04-24'],
  ] as const;

  const localDays = (year: number, month: number, zone: string) =>
    monthGrid(year, month, zone).map((cell) => utcToLocalInput(cell, zone).slice(0, 10));

  it('always returns six weeks', () => {
    expect(monthGrid(2026, 7, 'Europe/Paris')).toHaveLength(42);
  });

  it('starts on a Monday and runs without a break', () => {
    const days = localDays(2026, 7, 'Europe/Paris');
    for (let index = 1; index < days.length; index += 1) {
      const previous = new Date(`${days[index - 1]}T00:00:00Z`);
      const current = new Date(`${days[index]}T00:00:00Z`);
      expect(current.getTime() - previous.getTime(), `${days[index - 1]} to ${days[index]}`).toBe(
        24 * 60 * 60 * 1000,
      );
    }
  });

  it.each(MIDNIGHT_GAPS)('gives %s a square for the day that loses its midnight', (zone, month, gap) => {
    const days = localDays(2026, month, zone);

    // `fromZonedTime` answered 23:00 the day before for this cell, so the grid
    // held the previous day twice and never showed this one.
    expect(days).toContain(gap);
    expect(days.filter((day) => day === gap)).toHaveLength(1);
  });

  it.each(MIDNIGHT_GAPS)('never repeats a day in %s', (zone, month) => {
    const days = localDays(2026, month, zone);
    expect(new Set(days).size).toBe(days.length);
  });

  it('handles a month that begins on the day with no midnight', () => {
    // Asuncion, 1 October 2023 — the only month start in a fifteen-year sweep
    // of every zone that lands on a midnight gap. Getting the first of the
    // month wrong shifts which weekday the grid opens on, so every square
    // after it is a day out.
    const days = localDays(2023, 9, 'America/Asuncion');

    expect(days).toContain('2023-10-01');
    expect(new Set(days).size).toBe(days.length);
    // 1 October 2023 was a Sunday, so a Monday-first grid opens on 25
    // September and the target day is the last square of the first row.
    expect(days[0]).toBe('2023-09-25');
    expect(days[6]).toBe('2023-10-01');
  });

  it('puts every square at the first real moment of its day', () => {
    for (const [zone, month] of MIDNIGHT_GAPS) {
      for (const cell of monthGrid(2026, month, zone)) {
        const local = utcToLocalInput(cell, zone);
        // Midnight everywhere it exists; the first minute that does where it
        // does not. Never the day before.
        expect(wallClockExists(local, zone), `${zone} ${local}`).toBe(true);
        expect(firstRealInstant(`${local.slice(0, 10)}T00:00`, zone).getTime(), local).toBe(
          cell.getTime(),
        );
      }
    }
  });
});

describe('dates in the reader’s language', () => {
  it('writes French month and day names for a French reader', async () => {
    const { formatInZone } = await import('../src/lib/time');
    const when = new Date('2026-09-29T18:30:00Z');
    expect(formatInZone(when, 'Europe/Paris', 'EEEE d MMMM yyyy, HH:mm', 'fr')).toBe('mardi 29 septembre 2026, 20:30');
    expect(formatInZone(when, 'Europe/Paris', 'EEEE d MMMM yyyy, HH:mm', 'en')).toBe('Tuesday 29 September 2026, 20:30');
  });

  it('keeps English, unchanged, outside a signed-in request', async () => {
    // The worker and email have no request: dates there must not move.
    const { formatInZone } = await import('../src/lib/time');
    expect(formatInZone(new Date('2026-09-29T18:30:00Z'), 'UTC', 'd MMM yyyy')).toBe('29 Sep 2026');
  });

  it('says "in 2 hours" in the reader’s language too', async () => {
    const { relativeTime } = await import('../src/lib/time');
    const now = new Date('2026-09-29T10:00:00Z');
    expect(relativeTime(new Date('2026-09-29T12:00:00Z'), now, 'fr')).toBe('dans 2 heures');
    expect(relativeTime(new Date('2026-09-29T12:00:00Z'), now)).toBe('in 2 hours');
  });
});
