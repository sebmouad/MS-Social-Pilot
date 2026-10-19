import { prisma } from '@/server/data';
import type { ReportPeriod } from '../contracts';
import { businessHoursOrNull, businessMs, calendarMs, type BusinessHoursSetting } from './business-hours';

/**
 * Inbox response time for one channel, from stored conversation messages only (no provider call).
 * A wait starts at the first message from someone other than the channel after the channel last wrote, and ends at the
 * channel's next message. A message counts as the channel's when it was sent through this app or its sender is the
 * channel's own remote identity. Two medians are reported: calendar time (always) and, when the workspace has set business
 * hours, the same waits counting only time inside those hours on the workspace clock. Without business hours the business
 * figure is absent (`businessHours` null) and nothing is invented.
 */
export type ResponseTimeSummary = {
  answered: number; unanswered: number; medianMs: number | null;
  /** Median counting only business hours; null when no business hours are set or nothing was answered. */
  businessMedianMs: number | null;
  /** The hours and zone applied, or null when the workspace has no business hours. */
  businessHours: (BusinessHoursSetting & { timeZone: string }) | null;
  /** True when the message read hit its safety bound; figures then cover only the earliest messages read. */
  partial: boolean;
};

/** Upper bound on messages read for one report, so one busy channel cannot make generation unbounded. */
export const RESPONSE_TIME_MESSAGE_CAP = 20_000;

export type ResponseMessage = { conversationId: string; createdTime: Date; fromChannel: boolean };

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Pure arithmetic over messages ordered by conversation then time. */
export function summarizeResponseTimes(messages: ResponseMessage[], partial = false, business: { hours: BusinessHoursSetting; timeZone: string } | null = null): ResponseTimeSummary {
  const waits: number[] = [];
  const businessWaits: number[] = [];
  let unanswered = 0;
  let current: string | null = null;
  let waitingSince: Date | null = null;
  for (const m of messages) {
    if (m.conversationId !== current) {
      if (waitingSince) unanswered += 1;
      current = m.conversationId; waitingSince = null;
    }
    if (m.fromChannel) {
      if (waitingSince) {
        waits.push(calendarMs(waitingSince, m.createdTime));
        if (business) businessWaits.push(businessMs(waitingSince, m.createdTime, business.hours, business.timeZone));
        waitingSince = null;
      }
    } else if (!waitingSince) waitingSince = m.createdTime;
  }
  if (waitingSince) unanswered += 1;
  return {
    answered: waits.length, unanswered, medianMs: median(waits), partial,
    businessMedianMs: business ? median(businessWaits) : null,
    businessHours: business ? { ...business.hours, timeZone: business.timeZone } : null,
  };
}

/** The workspace's business hours and zone, or null when none are set (or the stored value is unusable). */
async function readBusinessHours(workspaceId: string): Promise<{ hours: BusinessHoursSetting; timeZone: string } | null> {
  const rows = await prisma.$queryRaw<{ timezone: string | null; businessDays: number[] | null; businessStart: number | null; businessEnd: number | null }[]>`SELECT timezone, "businessDays", "businessStart", "businessEnd" FROM workspaces WHERE id = ${workspaceId}`;
  const row = rows[0];
  if (!row) return null;
  const hours = businessHoursOrNull({ days: row.businessDays ?? [], start: row.businessStart ?? 9, end: row.businessEnd ?? 18 });
  if (!hours) return null;
  const timeZone = row.timezone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { return null; }
  return { hours, timeZone };
}

/** Inclusive UTC dates → [start, end + 1 day). The caller has already authorized the channel. */
export async function readResponseTime(workspaceId: string, channelId: string, period: ReportPeriod): Promise<ResponseTimeSummary> {
  const target = await prisma.target.findFirst({ where: { id: channelId, workspaceId }, select: { providerId: true } });
  if (!target) return { answered: 0, unanswered: 0, medianMs: null, businessMedianMs: null, businessHours: null, partial: false };
  const business = await readBusinessHours(workspaceId);
  const from = new Date(`${period.start}T00:00:00.000Z`);
  const to = new Date(new Date(`${period.end}T00:00:00.000Z`).getTime() + 86_400_000);
  const rows = await prisma.conversationMessage.findMany({
    where: { createdTime: { gte: from, lt: to }, conversation: { targetId: channelId, target: { workspaceId } } },
    select: { conversationId: true, createdTime: true, fromId: true, sentById: true },
    orderBy: [{ conversationId: 'asc' }, { createdTime: 'asc' }],
    take: RESPONSE_TIME_MESSAGE_CAP + 1,
  });
  const partial = rows.length > RESPONSE_TIME_MESSAGE_CAP;
  const messages = rows.slice(0, RESPONSE_TIME_MESSAGE_CAP).map(r => ({
    conversationId: r.conversationId, createdTime: r.createdTime, fromChannel: r.sentById !== null || (r.fromId !== null && r.fromId === target.providerId),
  }));
  return summarizeResponseTimes(messages, partial, business);
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'Not available';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
/** e.g. "Mon, Tue, Wed 09:00-18:00 (Europe/Paris)". */
export function describeBusinessHours(b: BusinessHoursSetting & { timeZone: string }): string {
  return `${b.days.map(d => DAY_NAMES[d]).join(', ')} ${hh(b.start)}-${hh(b.end)} (${b.timeZone})`;
}
