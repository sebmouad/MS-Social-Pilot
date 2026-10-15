/** Wall-clock times in a named time zone, without a date library. */

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function partsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour') % 24, minute: value('minute'), second: value('second') };
}

/** Offset of a zone from UTC at an instant, in minutes (positive east of UTC). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Convert a `YYYY-MM-DDTHH:mm` wall-clock value in `timeZone` to the instant it
 * names. Returns null for malformed or non-existent values (e.g. 30 February).
 * A time skipped by a clock change resolves to the instant just after the gap.
 */
export function zonedLocalToDate(local: string, timeZone: string): Date | null {
  const match = LOCAL_PATTERN.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour) return null;
  try {
    let guess = wall - zoneOffsetMinutes(new Date(wall), timeZone) * 60000;
    guess = wall - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
    return new Date(guess);
  } catch { return null; }
}

/** Format an instant as `YYYY-MM-DDTHH:mm` on the wall clock of `timeZone`. */
export function dateToZonedLocal(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${String(p.year).padStart(4, '0')}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** Zone label such as `Europe/Paris (GMT+2)`, for text next to a time field. */
export function zoneLabel(timeZone: string, date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value;
    return `${timeZone.replaceAll('_', ' ')}${name ? ` (${name})` : ''}`;
  } catch { return timeZone; }
}
