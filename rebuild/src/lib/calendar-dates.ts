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
