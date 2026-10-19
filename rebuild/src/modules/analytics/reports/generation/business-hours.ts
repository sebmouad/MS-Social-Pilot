/**
 * Business-hours arithmetic for Inbox response time. Pure: no database, no clock.
 *
 * Legacy rule, ported unchanged: the workspace opens on its chosen weekdays (0 Sunday to 6 Saturday) from `start` inclusive to
 * `end` exclusive on the workspace's own clock, and only time inside those windows counts. A message at 23:00 answered at
 * 09:05 the next open morning waited five minutes. No overnight windows exist: `end` must be after `start`. Hours are 0..24.
 *
 * Time zones: each window is converted from wall-clock to real instants, so a 09:00-18:00 window is nine real hours unless a
 * daylight-saving change falls inside it. Where the wall clock does not exist (spring forward) the window edge is the first
 * real instant after the gap; where it happens twice (fall back) an opening edge uses the first occurrence and a closing edge
 * the second, so the window covers everything between.
 */
export type BusinessHoursSetting = { days: number[]; start: number; end: number };

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** A wait is counted over at most this many calendar days, so one forgotten thread cannot make the loop unbounded. */
export const BUSINESS_HOURS_MAX_DAYS = 400;

/** Validates stored settings. Returns null when no hours are set (no day selected); throws when they are set but unusable. */
export function parseBusinessHours(input: { days: readonly number[]; start: number; end: number }): BusinessHoursSetting | null {
  if (input.days.length === 0) return null;
  if (!input.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) throw new RangeError('Business days must be integers from 0 (Sunday) to 6 (Saturday).');
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 0 || input.start > 23 || input.end < 1 || input.end > 24) throw new RangeError('Business hours must be whole hours, start 0-23 and end 1-24.');
  if (input.end <= input.start) throw new RangeError('Business hours must end after they start.');
  return { days: [...new Set(input.days)].sort((a, b) => a - b), start: input.start, end: input.end };
}

/** Like parseBusinessHours but an unusable stored value counts as "not set" (hours are never invented). */
export function businessHoursOrNull(input: { days: readonly number[]; start: number; end: number }): BusinessHoursSetting | null {
  try { return parseBusinessHours(input); } catch { return null; }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); formatters.set(timeZone, f); }
  return f;
}
/** The zone's wall clock at an instant, as UTC-style milliseconds. */
function wallMs(instant: number, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}
function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallMs(whole, timeZone) - whole;
}

/** Real instants whose wall clock reads `wall` (none in a gap, two in a fold). */
function instantsFor(wall: number, timeZone: string): number[] {
  const found = new Set<number>();
  for (const probe of [wall - DAY, wall, wall + DAY]) {
    const candidate = wall - offsetAt(probe, timeZone);
    if (wallMs(candidate, timeZone) === wall) found.add(candidate);
  }
  return [...found].sort((a, b) => a - b);
}

/** Smallest whole-minute instant whose wall clock has reached `wall`: where the clocks land after a gap. */
function firstInstantAtOrAfter(wall: number, timeZone: string): number {
  let lo = wall - 15 * HOUR; let hi = wall + 15 * HOUR;
  lo = Math.floor(lo / MINUTE) * MINUTE; hi = Math.floor(hi / MINUTE) * MINUTE;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / MINUTE / 2) * MINUTE;
    if (wallMs(mid, timeZone) >= wall) hi = mid; else lo = mid;
  }
  return hi;
}

/** The instant a window edge falls on. 'open' takes the first occurrence of a repeated hour, 'close' the last. */
export function zonedInstant(day: string, hour: number, timeZone: string, edge: 'open' | 'close'): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour);
  const found = instantsFor(wall, timeZone);
  if (found.length === 0) return firstInstantAtOrAfter(wall, timeZone);
  return edge === 'open' ? found[0]! : found[found.length - 1]!;
}

const dayOf = (instant: number, timeZone: string) => new Date(wallMs(instant, timeZone)).toISOString().slice(0, 10);
const nextDay = (day: string) => new Date(new Date(`${day}T12:00:00Z`).getTime() + DAY).toISOString().slice(0, 10);

/** Calendar milliseconds between two instants, never negative. */
export const calendarMs = (from: Date, to: Date) => Math.max(0, to.getTime() - from.getTime());

/**
 * Milliseconds between two instants that fall inside business hours on the workspace clock.
 * Throws RangeError when the hours are unusable (no open day, zero or negative length, out of range): callers pass
 * parseBusinessHours output, or use calendarMs when no hours are set.
 */
export function businessMs(from: Date, to: Date, hours: BusinessHoursSetting, timeZone: string): number {
  if (parseBusinessHours(hours) === null) throw new RangeError('Business hours need at least one open day.');
  const a = from.getTime(); const b = to.getTime();
  if (!(b > a)) return 0;
  let total = 0;
  let day = dayOf(a, timeZone);
  for (let step = 0; step < BUSINESS_HOURS_MAX_DAYS; step += 1) {
    const open = zonedInstant(day, hours.start, timeZone, 'open');
    if (open >= b) break;
    if (hours.days.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) {
      const close = hours.end >= 24 ? zonedInstant(nextDay(day), 0, timeZone, 'open') : zonedInstant(day, hours.end, timeZone, 'close');
      const s = Math.max(open, a); const e = Math.min(close, b);
      if (e > s) total += e - s;
    }
    day = nextDay(day);
  }
  return total;
}
