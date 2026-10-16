/** Explicit operator timezone keeps server/browser rendering consistent. UI is currently English. */
export function formatRootTimestamp(value: string, timeZone: string) {
  return `${new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))} (${timeZone})`;
}
