/**
 * Calendar-day arithmetic for analytics. A "day" is a YYYY-MM-DD string in the
 * workspace time zone, so ranges, buckets and the previous period all agree no
 * matter where the server runs or whether a daylight saving change falls inside.
 */

export type DayRange = { start: string; end: string };

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDay(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** A usable IANA zone, or UTC when the stored value is not one. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone }); return timeZone; } catch { return 'UTC'; }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(instant: Date, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) if (part.type !== 'literal') parts[part.type] = Number(part.value);
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Milliseconds the zone is ahead of UTC at this instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The calendar day an instant falls on in the zone. */
export function zonedDay(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The calendar day of a date-only value stored at UTC midnight (for example an ad report day). */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (to − from). */
export function daysBetween(from: string, to: string): number {
  const parse = (day: string) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Every day from start to end inclusive. */
export function enumerateDays(range: DayRange): string[] {
  const count = daysBetween(range.start, range.end);
  if (count < 0) return [];
  return Array.from({ length: count + 1 }, (_, index) => addDays(range.start, index));
}

/** The first instant of a calendar day in the zone. */
export function dayStartInstant(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wallClock = Date.UTC(y, m - 1, d);
  let guess = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  const corrected = wallClock - zoneOffsetMs(new Date(guess), timeZone);
  if (corrected !== guess) guess = corrected;
  return new Date(guess);
}

/** The last millisecond of a calendar day in the zone. */
export function dayEndInstant(day: string, timeZone: string): Date {
  return new Date(dayStartInstant(addDays(day, 1), timeZone).getTime() - 1);
}

/** The equal-length period that ends the day before `range` starts. */
export function previousRange(range: DayRange): DayRange {
  const length = daysBetween(range.start, range.end) + 1;
  return { start: addDays(range.start, -length), end: addDays(range.start, -1) };
}

/**
 * Resolves the requested dates. Missing or invalid dates fall back to the last
 * `defaultDays` days ending today in the zone; a reversed range falls back the
 * same way; ranges longer than `maxDays` keep their end and lose their start.
 */
export function resolveDayRange(start: string | undefined, end: string | undefined, now: Date, timeZone: string, options: { defaultDays?: number; maxDays?: number } = {}): DayRange {
  const defaultDays = options.defaultDays ?? 30;
  const maxDays = options.maxDays ?? 400;
  const today = zonedDay(now, timeZone);
  const last = isCalendarDay(end) ? end : today;
  let first = isCalendarDay(start) ? start : addDays(last, -(defaultDays - 1));
  if (first > last) first = addDays(last, -(defaultDays - 1));
  if (daysBetween(first, last) + 1 > maxDays) first = addDays(last, -(maxDays - 1));
  return { start: first, end: last };
}
