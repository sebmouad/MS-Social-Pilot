/**
 * Inbox response time, the arithmetic. Plain module: no
 * database, so it is tested on its own.
 *
 * A *wait* starts when someone other than the Page writes (a top-level
 * comment, or the first of a run of messages) and ends at the Page's first
 * answer. Business hours, when the workspace sets them, are the only time
 * that counts: a message at 23:00 answered at 09:05 waited five minutes.
 */
import { localInputToUtc, formatInZone } from './time';

export interface BusinessHours {
  /** 0 Sunday … 6 Saturday; empty means every hour counts. */
  days: number[];
  /** Hours on the workspace's clock, start inclusive, end exclusive. */
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;
/** A wait longer than this is counted as this, so one forgotten thread cannot hang the loop. */
const MAX_DAYS = 400;

const pad = (value: number) => String(value).padStart(2, '0');

/** Milliseconds between two moments that fall inside business hours. */
export function businessMs(from: Date, to: Date, hours: BusinessHours | null, timeZone: string): number {
  const span = to.getTime() - from.getTime();
  if (span <= 0) return 0;
  if (!hours || hours.days.length === 0 || hours.end <= hours.start) return span;

  let total = 0;
  // Walk the workspace's calendar days from the one holding `from`.
  let day = formatInZone(from, timeZone, 'yyyy-MM-dd');
  for (let step = 0; step < MAX_DAYS; step += 1) {
    const open = localInputToUtc(`${day}T${pad(hours.start)}:00`, timeZone);
    if (open.getTime() >= to.getTime()) break;
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (hours.days.includes(weekday)) {
      const close = hours.end >= 24 ? localInputToUtc(`${nextDay(day)}T00:00`, timeZone) : localInputToUtc(`${day}T${pad(hours.end)}:00`, timeZone);
      const start = Math.max(open.getTime(), from.getTime());
      const end = Math.min(close.getTime(), to.getTime());
      if (end > start) total += end - start;
    }
    day = nextDay(day);
  }
  return total;
}

function nextDay(day: string): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export interface Wait {
  startedAt: Date;
  answeredAt: Date | null;
  /** The member who answered from the app; null when answered on Facebook or not at all. */
  answeredBy: string | null;
  resolvedAt: Date | null;
}

interface CommentRow {
  remoteId: string;
  parentRemoteId: string | null;
  fromId: string | null;
  createdTime: Date;
  resolvedAt: Date | null;
  sentById: string | null;
}

/** Each top-level comment from someone else, with the Page's first reply under it. */
export function commentWaits(comments: CommentRow[], pageId: string): Wait[] {
  const replies = new Map<string, CommentRow[]>();
  for (const comment of comments) {
    if (comment.parentRemoteId && comment.fromId === pageId) {
      replies.set(comment.parentRemoteId, [...(replies.get(comment.parentRemoteId) ?? []), comment]);
    }
  }
  return comments
    .filter((comment) => !comment.parentRemoteId && comment.fromId !== pageId)
    .map((comment) => {
      const first = (replies.get(comment.remoteId) ?? [])
        .filter((reply) => reply.createdTime >= comment.createdTime)
        .sort((a, b) => a.createdTime.getTime() - b.createdTime.getTime())[0];
      return { startedAt: comment.createdTime, answeredAt: first?.createdTime ?? null, answeredBy: first?.sentById ?? null, resolvedAt: comment.resolvedAt };
    });
}

interface MessageRow {
  fromId: string | null;
  createdTime: Date;
  sentById: string | null;
}

/** Each run of messages from the other person, with the Page's first answer after it starts. */
export function messageWaits(messages: MessageRow[], pageId: string, resolvedAt: Date | null): Wait[] {
  const sorted = [...messages].sort((a, b) => a.createdTime.getTime() - b.createdTime.getTime());
  const waits: Wait[] = [];
  let open: Wait | null = null;
  for (const message of sorted) {
    if (message.fromId === pageId) {
      if (open) {
        open.answeredAt = message.createdTime;
        open.answeredBy = message.sentById;
        open = null;
      }
    } else if (!open) {
      open = { startedAt: message.createdTime, answeredAt: null, answeredBy: null, resolvedAt: null };
      waits.push(open);
    }
  }
  // Marking a thread done closes the run it followed.
  if (resolvedAt) {
    const closed = [...waits].reverse().find((wait) => wait.startedAt <= resolvedAt);
    if (closed) closed.resolvedAt = resolvedAt;
  }
  return waits;
}

export interface ResponseSummary {
  /** Waits that started in the window. */
  total: number;
  answered: number;
  medianFirstMs: number | null;
  slowestFirstMs: number | null;
  resolved: number;
  medianResolveMs: number | null;
}

export function summariseWaits(waits: Wait[], hours: BusinessHours | null, timeZone: string): ResponseSummary {
  const first = waits.filter((wait) => wait.answeredAt).map((wait) => businessMs(wait.startedAt, wait.answeredAt!, hours, timeZone));
  const resolve = waits.filter((wait) => wait.resolvedAt).map((wait) => businessMs(wait.startedAt, wait.resolvedAt!, hours, timeZone));
  return {
    total: waits.length,
    answered: first.length,
    medianFirstMs: median(first),
    slowestFirstMs: first.length > 0 ? Math.max(...first) : null,
    resolved: resolve.length,
    medianResolveMs: median(resolve),
  };
}

/** A duration as the two largest units worth saying: days and hours, hours and minutes, or minutes. */
export function durationParts(ms: number): { unit: 'minutes' | 'hours' | 'days'; major: number; minor: number } {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return { unit: 'minutes', major: minutes, minor: 0 };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', major: hours, minor: minutes % 60 };
  return { unit: 'days', major: Math.floor(hours / 24), minor: hours % 24 };
}
