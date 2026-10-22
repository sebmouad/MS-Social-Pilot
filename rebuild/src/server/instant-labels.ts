import { prisma } from '@/server/data';

/**
 * Server-side display labels for instants shown by client components. Browsers can ship different time-zone data
 * than Node and format with the viewer's own zone, which shifts the text and breaks hydration, so client components
 * receive these strings (in the workspace zone and the page locale) instead of formatting dates themselves.
 */
export type InstantKind = 'date' | 'dateTime';
export type InstantFormatter = { timeZone: string; date(value: Date | string): string; dateTime(value: Date | string): string };
export type Labeled<T, K extends string> = T & { labels: Partial<Record<K, string>> };

export function instantFormatter(timeZone: string, locale: string): InstantFormatter {
  const day = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' });
  const full = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  return { timeZone, date: value => day.format(new Date(value)), dateTime: value => full.format(new Date(value)) };
}

export async function workspaceInstantFormatter(workspaceId: string, locale: string): Promise<InstantFormatter> {
  // A display label must never fail the request it decorates: an unreadable zone falls back to UTC (the zone default).
  const workspace = await Promise.resolve().then(() => prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } })).catch(() => null);
  return instantFormatter(workspace?.timezone ?? 'UTC', locale);
}

/** Adds `labels` for the listed instant fields; null, missing and invalid values get no label. */
export function labelInstants<T extends object, K extends string>(row: T, fields: Record<K, InstantKind>, formatter: InstantFormatter): Labeled<T, K> {
  const labels: Partial<Record<K, string>> = {};
  for (const field of Object.keys(fields) as K[]) {
    const value = (row as Record<string, unknown>)[field];
    if (typeof value !== 'string' && !(value instanceof Date)) continue;
    if (Number.isNaN(new Date(value).getTime())) continue;
    labels[field] = fields[field] === 'date' ? formatter.date(value) : formatter.dateTime(value);
  }
  return { ...row, labels };
}

/** The display locale a request asked for (the same Accept-Language rule the screens use). */
export const requestLocale = (request: Request): 'en' | 'fr' => /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en';
