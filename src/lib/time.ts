import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addDays, startOfDay } from 'date-fns';

/**
 * Timezone handling.
 *
 * Rule for the whole codebase: every Date crossing a boundary (database,
 * Graph API, JSON) is UTC. A timezone is only applied when interpreting what a
 * human typed, or when rendering back to them. Scheduled publishing is exactly
 * where getting this wrong is expensive — "9am" must survive a DST change.
 */

export const DEFAULT_TIMEZONE = 'UTC';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a wall-clock string the user typed ("2026-03-14T09:00") in a given
 * timezone into the correct UTC instant.
 */
export function localInputToUtc(localInput: string, timeZone: string): Date {
  const normalized = localInput.length === 16 ? `${localInput}:00` : localInput;
  const instant = fromZonedTime(normalized, timeZone);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Could not interpret "${localInput}" as a date and time.`);
  }
  return instant;
}

/**
 * Whether a wall-clock time exists at all in a zone.
 *
 * Once a year an hour does not happen. In London the clocks go from 01:00
 * straight to 02:00 on the last Sunday in March, so 01:30 that morning is not
 * a time — and `fromZonedTime` does not refuse it, it quietly returns the
 * instant half an hour *before* the gap. Somebody asks for 01:30, the app
 * stores 00:30, and the calendar afterwards shows 00:30: their post goes out
 * early on the one morning of the year nobody is watching for it.
 *
 * The round trip is the test. Convert to an instant and back, and if the wall
 * clock that comes out is not the one that went in, the one that went in never
 * existed.
 */
export function wallClockExists(localInput: string, timeZone: string): boolean {
  const normalized = localInput.length === 16 ? localInput : localInput.slice(0, 16);

  try {
    return utcToLocalInput(localInputToUtc(normalized, timeZone), timeZone) === normalized;
  } catch {
    return false;
  }
}

/**
 * The first real instant at or after a wall-clock time.
 *
 * For a time that exists this is simply that time. For one inside the
 * spring-forward gap it is the moment the clocks land — 02:00 where 01:30 was
 * asked for. Recurring queue slots use this rather than refusing: a weekly slot
 * at 01:30 on a Sunday must not break one Sunday a year, and going out at the
 * start of the hour it was meant to be in is the closest thing to what was
 * asked.
 */
export function firstRealInstant(localInput: string, timeZone: string): Date {
  const instant = localInputToUtc(localInput, timeZone);
  if (wallClockExists(localInput, timeZone)) return instant;

  const wanted = localInput.length === 16 ? localInput : localInput.slice(0, 16);

  // The smallest instant whose wall clock has reached the one that was asked
  // for. Adding a fixed hour would be wrong twice over: it lands an hour after
  // the *requested* time rather than at the start of the hour that replaced
  // it — 02:30 for a 01:30 request — and not every shift is an hour, since
  // Lord Howe Island moves by thirty minutes.
  //
  // Searched rather than derived, because the offset either side of a
  // transition is the only thing that decides it and both are the zone's own
  // business. Minute resolution, which is all a scheduler has anyway.
  const MINUTE = 60_000;
  let low = instant.getTime();
  let high = low + 3 * 60 * MINUTE;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
    if (middle === low) break;

    // Lexicographic on `yyyy-MM-ddTHH:mm` is chronological.
    if (utcToLocalInput(new Date(middle), timeZone) < wanted) low = middle;
    else high = middle;
  }

  return new Date(high);
}

/** Render a UTC instant as a `datetime-local` input value in the given zone. */
export function utcToLocalInput(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd'T'HH:mm");
}

export function formatInZone(date: Date, timeZone: string, pattern = 'd MMM yyyy, HH:mm'): string {
  return formatInTimeZone(date, timeZone, pattern);
}

/** Short UTC-offset label for the UI, e.g. "GMT+02:00". */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export interface QueueSlotDefinition {
  dayOfWeek: number; // 0 = Sunday
  hour: number;
  minute: number;
}

/**
 * Find the next queue slot that is both in the future and not already taken.
 *
 * This is the "add to queue" behaviour: rather than picking a time, a post
 * drops into the next free publishing slot. Slots are defined in workspace
 * local time, so the computation walks days in that zone and converts each
 * candidate to UTC — which keeps "Tuesday 09:00" at 09:00 across DST.
 */
export function nextAvailableSlot(options: {
  slots: QueueSlotDefinition[];
  timeZone: string;
  takenUtc: Date[];
  now?: Date;
  /** How far ahead to search before giving up. */
  horizonDays?: number;
}): Date | null {
  const { slots, timeZone } = options;
  if (slots.length === 0) return null;

  const now = options.now ?? new Date();
  const horizonDays = options.horizonDays ?? 90;
  const taken = new Set(options.takenUtc.map((date) => date.getTime()));

  // Start from "today" as seen in the workspace timezone.
  const localNow = toZonedTime(now, timeZone);
  const cursor = startOfDay(localNow);

  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
    const day = addDays(cursor, dayOffset);
    const dayOfWeek = day.getDay();

    const candidates = slots
      .filter((slot) => slot.dayOfWeek === dayOfWeek)
      .sort((a, b) => a.hour - b.hour || a.minute - b.minute);

    for (const slot of candidates) {
      const stamp = [
        `${day.getFullYear()}`,
        String(day.getMonth() + 1).padStart(2, '0'),
        String(day.getDate()).padStart(2, '0'),
      ].join('-');
      const wallClock = `${stamp}T${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}:00`;

      // `firstRealInstant`, not `fromZonedTime`: one Sunday a year the slot's
      // wall clock is inside the hour the clocks skip, and converting it
      // directly returns the instant an hour *before* the gap. The queue would
      // publish an hour early, once, silently. A recurring slot must not be
      // refused for that — it is a standing instruction, not a typed-in time —
      // so it moves to the moment the clocks land instead.
      const utc = firstRealInstant(wallClock, timeZone);
      if (utc.getTime() <= now.getTime()) continue;
      if (taken.has(utc.getTime())) continue;
      return utc;
    }
  }

  return null;
}

/** Sensible default queue: weekday mornings and early afternoons. */
export const DEFAULT_QUEUE_SLOTS: QueueSlotDefinition[] = [
  { dayOfWeek: 1, hour: 9, minute: 0 },
  { dayOfWeek: 1, hour: 15, minute: 0 },
  { dayOfWeek: 2, hour: 9, minute: 0 },
  { dayOfWeek: 3, hour: 9, minute: 0 },
  { dayOfWeek: 3, hour: 15, minute: 0 },
  { dayOfWeek: 4, hour: 9, minute: 0 },
  { dayOfWeek: 5, hour: 9, minute: 0 },
];

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Days of a calendar month grid (Monday-first), as UTC day boundaries. */
export function monthGrid(year: number, month: number, timeZone: string): Date[] {
  const first = fromZonedTime(`${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00`, timeZone);
  const localFirst = toZonedTime(first, timeZone);

  // Monday-first: Sunday (0) becomes the 7th column.
  const offset = (localFirst.getDay() + 6) % 7;
  const gridStart = addDays(localFirst, -offset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(gridStart, index);
    const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(
      day.getDate(),
    ).padStart(2, '0')}T00:00:00`;
    return fromZonedTime(stamp, timeZone);
  });
}

export function relativeTime(date: Date, now: Date = new Date()): string {
  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let value = deltaSeconds;
  let magnitude = absolute;

  for (const [unit, step] of units) {
    if (magnitude < step) return formatter.format(Math.round(value), unit);
    value /= step;
    magnitude /= step;
  }
  return formatter.format(Math.round(value), 'year');
}
