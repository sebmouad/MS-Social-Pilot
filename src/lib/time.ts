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

      const utc = fromZonedTime(wallClock, timeZone);
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
