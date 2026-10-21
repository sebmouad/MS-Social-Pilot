export function formatValue(amount: number | null | undefined, unit: string, displayTotal?: string): string {
  if (displayTotal) return displayTotal;
  if (amount === null || amount === undefined) return 'Unknown';
  const text = new Intl.NumberFormat('en', { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(amount);
  return unit === 'percent' ? `${text}%` : unit === 'multiple' ? `${text}×` : text;
}
export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return 'Date unavailable';
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : value;
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
export function formatWhen(value: Date | null | undefined): string {
  return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value) + ' UTC' : 'Never';
}
export const searchOf = (params: Record<string, string | string[] | undefined>): Record<string, unknown> => params as Record<string, unknown>;
/**
 * A date and time in a named zone, e.g. "Dec 3, 2026, 8:54 AM". Format on the server and pass the text to client
 * components: Node and browsers can carry different time-zone data, so formatting the same instant twice can disagree.
 */
export function formatInZone(iso: string, timeZone: string, locale: 'en' | 'fr' = 'en'): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return locale === 'fr' ? 'Heure indisponible' : 'Time unavailable';
  try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date); } catch { return locale === 'fr' ? 'Heure indisponible' : 'Time unavailable'; }
}
