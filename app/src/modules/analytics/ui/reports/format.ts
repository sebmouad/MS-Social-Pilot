import { reportCopyDefaults } from './copy';
import { workspaceCopyDefaults, workspaceText, type WorkspaceCopy } from '../../workspace-copy';
export function formatValue(amount: number | null | undefined, unit: string, displayTotal?: string, locale: 'en' | 'fr' = 'en', copy: WorkspaceCopy = workspaceCopyDefaults): string {
  if (displayTotal) return displayTotal;
  if (amount === null || amount === undefined) return workspaceText(copy, locale)('Unknown');
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(amount);
  return unit === 'percent' ? `${text}%` : unit === 'multiple' ? `${text}×` : text;
}
export function formatDay(value: string | Date | null | undefined, locale: 'en' | 'fr' = 'en', copy: WorkspaceCopy = workspaceCopyDefaults): string {
  if (!value) return workspaceText(copy, locale)('Date unavailable');
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
export function formatWhen(value: Date | null | undefined, locale: 'en' | 'fr' = 'en', copy: WorkspaceCopy = workspaceCopyDefaults): string {
  return value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value) + ' UTC' : workspaceText(copy, locale)('Never');
}
export const searchOf = (params: Record<string, string | string[] | undefined>): Record<string, unknown> => params as Record<string, unknown>;
/**
 * A date and time in a named zone, e.g. "Dec 3, 2026, 8:54 AM". Format on the server and pass the text to client
 * components: Node and browsers can carry different time-zone data, so formatting the same instant twice can disagree.
 */
export function formatInZone(iso: string, timeZone: string, locale: 'en' | 'fr' = 'en', unavailable = reportCopyDefaults['Time unavailable']![locale]): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return unavailable;
  try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date); } catch { return unavailable; }
}
