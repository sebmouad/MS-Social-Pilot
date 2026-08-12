import { describe, expect, it } from 'vitest';

import { firstRealInstant, isValidTimeZone, localInputToUtc, nextAvailableSlot, type QueueSlotDefinition, utcToLocalInput, wallClockExists } from '../src/lib/time';

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
