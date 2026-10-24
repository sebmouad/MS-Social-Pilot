import type { ReportFrequency } from './contracts';

/** Offset (ms) of a zone from UTC at an instant. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(instant / 1000) * 1000;
}
export function validTimeZone(timeZone: string): boolean { try { new Intl.DateTimeFormat('en', { timeZone }); return true; } catch { return false; } }
export function dayIn(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return parts;
}
export function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}
/** Wall-clock `day` + `HH:MM` in a zone to a UTC instant. */
export function zonedToUtc(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - zoneOffset(naive, timeZone);
  return new Date(naive - zoneOffset(first, timeZone));
}
function weekdayIndex(day: string, weekStartsOn: number): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() - weekStartsOn + 7) % 7;
}
/** First run strictly after `after`: the workspace's week start (weekly) or the 1st (monthly), at `time` local. */
export function nextReportRun(frequency: ReportFrequency, after: Date, timeZone: string, weekStartsOn: number, time: string): Date {
  let day = dayIn(after, timeZone);
  for (let guard = 0; guard < 45; guard += 1) {
    const due = frequency === 'weekly' ? weekdayIndex(day, weekStartsOn) === 0 : day.endsWith('-01');
    if (due) { const at = zonedToUtc(day, time, timeZone); if (at.getTime() > after.getTime()) return at; }
    day = shiftDay(day, 1);
  }
  throw new Error('No report run found.');
}
/** Whole previous week or month, as inclusive local calendar days, relative to a run. */
export function reportPeriod(frequency: ReportFrequency, runAt: Date, timeZone: string, weekStartsOn: number): { start: string; end: string } {
  const today = dayIn(runAt, timeZone);
  if (frequency === 'weekly') {
    const boundary = shiftDay(today, -weekdayIndex(today, weekStartsOn));
    return { start: shiftDay(boundary, -7), end: shiftDay(boundary, -1) };
  }
  const first = `${today.slice(0, 7)}-01`;
  const [y, m] = first.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), end: shiftDay(first, -1) };
}
