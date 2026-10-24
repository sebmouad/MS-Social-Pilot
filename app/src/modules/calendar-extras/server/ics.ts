export type IcsEvent = { uid: string; start: Date; minutes: number; summary: string; description: string; url: string; updated: Date };
/** RFC 5545 invariants: CRLF, 75-octet lines and escaped text (including lone CR). */
export const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
export function foldLine(line: string) {
 const parts: string[] = [];
 let current = '', size = 0;
 for (const char of line) {
  const width = Buffer.byteLength(char);
  if (size + width > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0; }
  current += char; size += width;
 }
 parts.push(current);
 return parts.join('\r\n ');
}
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function buildCalendar(name: string, events: IcsEvent[], now: Date) {
 const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MS Social Pilot//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`];
 for (const e of events) lines.push('BEGIN:VEVENT', `UID:${escapeText(e.uid)}`, `DTSTAMP:${stamp(now)}`, `LAST-MODIFIED:${stamp(e.updated)}`, `DTSTART:${stamp(e.start)}`, `DURATION:PT${e.minutes}M`, `SUMMARY:${escapeText(e.summary)}`, `DESCRIPTION:${escapeText(e.description)}`, `URL:${e.url}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
 return [...lines, 'END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n';
}
