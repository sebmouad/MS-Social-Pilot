export type LocalTimeStyle = 'datetime' | 'date' | 'time';

/**
 * Engines disagree on how `dateStyle` and `timeStyle` are joined in one call (WebKit writes "21 Oct 2026 at 10:53:20",
 * Node, Chromium and Firefox write "21 Oct 2026, 10:53:20"), which makes server and browser text differ and breaks
 * hydration. Formatting the two halves separately and joining them ourselves is identical everywhere.
 */
export function formatStableDateTime(value: string | number | Date, options: { locale?: string; timeZone?: string; style?: LocalTimeStyle } = {}): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const { locale = 'en-GB', timeZone, style = 'datetime' } = options;
  const day = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(date);
  const time = new Intl.DateTimeFormat(locale, { timeZone, timeStyle: 'medium' }).format(date);
  return style === 'date' ? day : style === 'time' ? time : `${day}, ${time}`;
}
