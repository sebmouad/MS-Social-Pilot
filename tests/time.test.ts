import { describe, expect, it } from 'vitest';

import {
  isValidTimeZone,
  localInputToUtc,
  nextAvailableSlot,
  utcToLocalInput,
  type QueueSlotDefinition,
} from '../src/lib/time';

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
