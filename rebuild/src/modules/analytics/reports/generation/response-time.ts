import { configValueOrDefault } from '@/server/config/config-or-default';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { responseTimeCopyDefaults, responseText, type ResponseTimeCopy } from './response-copy';
const responseCopy = cache(() => configValueOrDefault('analytics.responseTimeCopy'));
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
  /** Who answered, for replies sent through this app (by member) and outside it. Absent on summaries from older callers. */
  members?: MemberResponse[];
  /** Members beyond MEMBER_ROWS_CAP that are not listed. */
  membersOmitted?: number;
  /** First visitor message in the period to the conversation's resolvedAt. Unresolved conversations are counted, never zero. */
  resolve?: ResolveSummary;
};
export type MemberResponse = { memberId: string | null; name: string; answered: number; medianMs: number | null };
export type ResolveSummary = { resolved: number; unresolved: number; medianMs: number | null };

export const OUTSIDE_APP_LABEL = responseTimeCopyDefaults.outside.en;
export const FORMER_MEMBER_LABEL = responseTimeCopyDefaults.former.en;
/** Upper bound on member rows kept in one report. */
export const MEMBER_ROWS_CAP = 25;

/** Upper bound on messages read for one report, so one busy channel cannot make generation unbounded. */
export const RESPONSE_TIME_MESSAGE_CAP = 20_000;

export type ResponseMessage = {
  conversationId: string; createdTime: Date; fromChannel: boolean;
  /** Member who sent this message through the app; null for messages from outside it. */
  sentById?: string | null;
  /** The conversation's resolvedAt (same on every message of a conversation). */
  resolvedAt?: Date | null;
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Pure arithmetic over messages ordered by conversation then time. */
export function summarizeResponseTimes(messages: ResponseMessage[], partial = false, business: { hours: BusinessHoursSetting; timeZone: string } | null = null, memberNames: ReadonlyMap<string, string> = new Map(), copy: ResponseTimeCopy = responseTimeCopyDefaults, locale: 'en' | 'fr' = 'en'): ResponseTimeSummary {
  const waits: number[] = [];
  const byReplier = new Map<string | null, number[]>();
  const resolveWaits: number[] = [];
  let resolved = 0; let unresolved = 0;
  let firstVisitor: Date | null = null; let firstVisitorResolvedAt: Date | null = null;
  const closeConversation = () => {
    if (!firstVisitor) return;
    if (firstVisitorResolvedAt && firstVisitorResolvedAt.getTime() >= firstVisitor.getTime()) { resolved += 1; resolveWaits.push(calendarMs(firstVisitor, firstVisitorResolvedAt)); } else unresolved += 1;
    firstVisitor = null; firstVisitorResolvedAt = null;
  };
  const businessWaits: number[] = [];
  let unanswered = 0;
  let current: string | null = null;
  let waitingSince: Date | null = null;
  for (const m of messages) {
    if (m.conversationId !== current) {
      closeConversation();
      if (waitingSince) unanswered += 1;
      current = m.conversationId; waitingSince = null;
    }
    if (m.fromChannel) {
      if (waitingSince) {
        const wait = calendarMs(waitingSince, m.createdTime);
        waits.push(wait);
        const replier = m.sentById ?? null;
        byReplier.set(replier, [...(byReplier.get(replier) ?? []), wait]);
        if (business) businessWaits.push(businessMs(waitingSince, m.createdTime, business.hours, business.timeZone));
        waitingSince = null;
      }
    } else {
      if (!waitingSince) waitingSince = m.createdTime;
      if (!firstVisitor) { firstVisitor = m.createdTime; firstVisitorResolvedAt = m.resolvedAt ?? null; }
    }
  }
  closeConversation();
  if (waitingSince) unanswered += 1;
  const everyone: MemberResponse[] = [...byReplier].map(([memberId, list]) => ({
    memberId, answered: list.length, medianMs: median(list),
    name: memberId === null ? copy.outside[locale] : memberNames.get(memberId) ?? copy.former[locale],
  })).sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name));
  return {
    members: everyone.slice(0, MEMBER_ROWS_CAP), membersOmitted: Math.max(0, everyone.length - MEMBER_ROWS_CAP),
    resolve: { resolved, unresolved, medianMs: median(resolveWaits) },
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
export async function readResponseTime(workspaceId: string, channelId: string, period: ReportPeriod, locale: 'en' | 'fr' = 'en'): Promise<ResponseTimeSummary> {
  const target = await prisma.target.findFirst({ where: { id: channelId, workspaceId }, select: { providerId: true } });
  if (!target) return { answered: 0, unanswered: 0, medianMs: null, businessMedianMs: null, businessHours: null, partial: false, members: [], membersOmitted: 0, resolve: { resolved: 0, unresolved: 0, medianMs: null } };
  const business = await readBusinessHours(workspaceId);
  const from = new Date(`${period.start}T00:00:00.000Z`);
  const to = new Date(new Date(`${period.end}T00:00:00.000Z`).getTime() + 86_400_000);
  const rows = await prisma.conversationMessage.findMany({
    where: { createdTime: { gte: from, lt: to }, conversation: { targetId: channelId, target: { workspaceId } } },
    select: { conversationId: true, createdTime: true, fromId: true, sentById: true, conversation: { select: { resolvedAt: true } } },
    orderBy: [{ conversationId: 'asc' }, { createdTime: 'asc' }],
    take: RESPONSE_TIME_MESSAGE_CAP + 1,
  });
  const partial = rows.length > RESPONSE_TIME_MESSAGE_CAP;
  const messages = rows.slice(0, RESPONSE_TIME_MESSAGE_CAP).map(r => ({
    conversationId: r.conversationId, createdTime: r.createdTime, fromChannel: r.sentById !== null || (r.fromId !== null && r.fromId === target.providerId),
    sentById: r.sentById, resolvedAt: r.conversation?.resolvedAt ?? null,
  }));
  // Names only, and only for current members of this workspace; anyone else shows as a former member.
  const memberIds = [...new Set(messages.map(m => m.sentById).filter((id): id is string => Boolean(id)))];
  const users = memberIds.length ? await prisma.user.findMany({ where: { id: { in: memberIds }, memberships: { some: { workspaceId } } }, select: { id: true, name: true } }) : [];
  return summarizeResponseTimes(messages, partial, business, new Map(users.map(u => [u.id, u.name])), await responseCopy(), locale);
}

export function formatDuration(ms: number | null, copy: ResponseTimeCopy = responseTimeCopyDefaults, locale: 'en' | 'fr' = 'en'): string {
  const t = (key: keyof ResponseTimeCopy, ...values: Array<string | number>) => responseText(copy, locale, key, ...values);
  if (ms === null) return t('unavailable');
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return t('minutes', minutes);
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  if (hours < 48) return rest ? t('hoursMinutes', hours, rest) : t('hours', hours);
  return t('days', Math.round(hours / 24));
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
/** e.g. "Mon, Tue, Wed 09:00-18:00 (Europe/Paris)". */
export function describeBusinessHours(b: BusinessHoursSetting & { timeZone: string }, copy: ResponseTimeCopy = responseTimeCopyDefaults, locale: 'en' | 'fr' = 'en'): string {
  return `${b.days.map(d => copy[DAY_KEYS[d]!][locale]).join(', ')} ${hh(b.start)}-${hh(b.end)} (${b.timeZone})`;
}
