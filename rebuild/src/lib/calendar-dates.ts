/** Stable YYYY-MM-DD key in the workspace timezone, independent of ICU punctuation. */
export function workspaceDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function calendarMonth(value: string | undefined, now: Date, timeZone: string) {
  const current = workspaceDateKey(now, timeZone).slice(0, 7);
  const key = value && /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value) ? value : current;
  const [year, month] = key.split('-').map(Number);
  return { key, year, month };
}

export function adjacentCalendarMonth(year: number, month: number, offset: -1 | 1) {
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function postCalendarDate(post: { status: string; scheduledAt: Date | null; publishedAt: Date | null }) {
  return ['published', 'partially_failed'].includes(post.status)
    ? post.publishedAt ?? post.scheduledAt
    : post.scheduledAt ?? post.publishedAt;
}

/* ---- Wall-clock helpers: workspace-local dates and times, DST-aware ---- */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isDateKey(value: string | null | undefined): value is string {
  const match = value ? DATE_KEY.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export function isTimeKey(value: string | null | undefined): value is string {
  return Boolean(value && TIME_KEY.test(value));
}

/** Add whole days to a YYYY-MM-DD key (calendar arithmetic, no time zone involved). */
export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD key. */
export function weekdayOfKey(key: string): number {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The Sunday that starts the week containing `key`. */
export function weekStartKey(key: string): string {
  return addDaysToKey(key, -weekdayOfKey(key));
}

function wallFields(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour') % 24, minute: value('minute'), second: value('second') };
}

/** Milliseconds the workspace clock is ahead of UTC at this instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const f = wallFields(instant, timeZone);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The workspace-local date (YYYY-MM-DD) and time (HH:MM) of an instant. */
export function instantToWall(instant: Date, timeZone: string): { date: string; time: string } {
  const f = wallFields(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${String(f.year).padStart(4, '0')}-${pad(f.month)}-${pad(f.day)}`, time: `${pad(f.hour)}:${pad(f.minute)}` };
}

export type WallTimeResult = { ok: true; instant: Date } | { ok: false; reason: 'invalid' | 'skipped' };

/**
 * Convert a workspace-local date and time to an instant. A local time that does
 * not exist (clocks jump forward) is rejected as `skipped`; a local time that
 * occurs twice (clocks fall back) resolves to its first occurrence.
 */
export function wallTimeToInstant(date: string, time: string, timeZone: string): WallTimeResult {
  if (!isDateKey(date) || !isTimeKey(time)) return { ok: false, reason: 'invalid' };
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([zoneOffsetMs(new Date(naive - DAY_MS), timeZone), zoneOffsetMs(new Date(naive + DAY_MS), timeZone)]);
  const matches = [...offsets].map(offset => naive - offset).filter(candidate => {
    const wall = instantToWall(new Date(candidate), timeZone);
    return wall.date === date && wall.time === time;
  });
  if (!matches.length) return { ok: false, reason: 'skipped' };
  return { ok: true, instant: new Date(Math.min(...matches)) };
}

export function isValidTimeZone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone }); return true; } catch { return false; }
}
