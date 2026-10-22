import { prisma } from '@/server/data';
import { pageLocale } from '../ui/kit/locale';

/**
 * Display strings for instants in the workspace time zone, produced on the server. Browsers can ship different
 * time-zone data than Node (Chromium formats Africa/Casablanca one hour behind), so client components receive
 * these labels instead of formatting zoned dates themselves.
 */
export async function workspaceTimeLabels(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
  return zonedTimeLabels(workspace?.timezone ?? 'UTC');
}

/** The same labels for a zone the caller already knows (for example a service result that carries it). */
export async function zonedTimeLabels(timeZone: string) {
  const locale = await pageLocale();
  const full = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const slot = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { timeZone, zoned: (value: Date | string) => `${full.format(new Date(value))} ${timeZone}`, full: (value: Date | string) => full.format(new Date(value)), slot: (value: Date | string) => slot.format(new Date(value)) };
}
