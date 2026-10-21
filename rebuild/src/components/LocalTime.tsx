'use client';
import { useEffect, useState } from 'react';

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

/**
 * A timestamp in the visitor's own locale and time zone. The server (and the first client render) shows the
 * stable UTC form, so hydration always matches; the visitor's formatting replaces it right after mount.
 */
export function LocalTime({ value, style = 'datetime', className }: { value: string | number | Date; style?: LocalTimeStyle; className?: string }) {
  const parsed = new Date(value);
  const iso = Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  const [text, setText] = useState(() => formatStableDateTime(iso, { timeZone: 'UTC', style }));
  useEffect(() => {
    if (!iso) return;
    const date = new Date(iso);
    setText(style === 'date' ? date.toLocaleDateString() : style === 'time' ? date.toLocaleTimeString() : date.toLocaleString());
  }, [iso, style]);
  return iso ? <time dateTime={iso} className={className}>{text}</time> : null;
}
