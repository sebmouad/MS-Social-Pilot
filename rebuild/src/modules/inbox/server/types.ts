import type { InboxMetadata } from '@/platforms/types';
/** allowedChannelIds is an optional credential ceiling; it narrows, never widens, current membership grants. */
export type InboxReadActor = { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] };
export type InboxReadConstraints = { allowedChannelIds?: readonly string[]; maxItems?: number };
export type InboxSentiment = 'positive' | 'neutral' | 'negative';
export type InboxListItem = {
  key: string; kind: 'message' | 'comment' | 'review'; id: string; author: string; preview: string; time: Date;
  /** Reviews only; null when the provider gave none. Never defaulted to 0. */
  rating: number | null; recommendation: 'positive' | 'negative' | null;
  target: { id: string; name: string; provider: string | null }; unread: number; needsReply: boolean; resolved: boolean; hidden: boolean; context: string | null;
  /** Stored classification of a comment; null (unknown) for messages, reviews and unclassified comments. Never defaulted to neutral. */
  sentiment: InboxSentiment | null;
  metadata?: InboxMetadata;
};
/** One-click narrowing of the activity list. Several may be combined; each must hold. Items a filter cannot judge (for example unclassified comments for negative) are left out, never guessed. */
export const INBOX_QUICK_FILTERS = ['unread', 'unanswered', 'negative', 'mentions'] as const;
export type InboxQuickFilter = typeof INBOX_QUICK_FILTERS[number];
export type InboxFilters ={ channelId: string | null; kind: 'all' | 'message' | 'comment' | 'review'; state: 'open' | 'resolved' | 'all'; hidden: 'visible' | 'all'; q: string };
/** Stored-match counts broken out by kind, across the current channel/state/hidden/search/quick scope but ignoring the kind filter, so the three lists can show what each one holds. Unread is tracked for messages only; comments and reviews report 0. */
export type InboxKindCounts = { message: number; comment: number; review: number };
/** Fold grouped count rows into per-kind totals; unknown kinds are ignored, missing kinds stay 0. */
export function inboxKindCounts(rows: ReadonlyArray<{ kind: string; count: number | bigint }>): InboxKindCounts {
  const totals: InboxKindCounts = { message: 0, comment: 0, review: 0 };
  for (const row of rows) if (row.kind === 'message' || row.kind === 'comment' || row.kind === 'review') totals[row.kind] = Number(row.count);
  return totals;
}
export type InboxPageCursors = { olderCursor: string | null; newerCursor: string | null };
export type InboxLimits = { listPageSize: number; threadPageSize: number; searchMaxCharacters: number; cursorMaxCharacters: number; /** Items one bulk action may include; screens use it to explain the limit before a request is made. */ bulkMaxItems?: number };
export type InboxListPage = InboxPageCursors & { /** Present only when quick filters are applied. */ quick?: InboxQuickFilter[]; items: InboxListItem[]; total: number; limit: number; cursor: string | null; filters: InboxFilters; channels: { id: string; name: string }[]; lastSynced: Date | null; timeZone: string; limits: InboxLimits; /** Per-kind totals and unread over the current scope, ignoring the kind filter. Always set by readInboxList; optional so older callers keep working. */ totals?: InboxKindCounts; unread?: InboxKindCounts };
/** Comment threads nest: parentId is the entry a reply answers (the opening comment when its parent is not on this page); depth is 0 for the opening comment. */
export type ThreadEntry = { id: string; author: string; text: string; time: Date; fromChannel: boolean; sentBy: string | null; parentId: string | null; depth: number; hidden: boolean; remoteId?: string; authorId?: string | null; parentRemoteId?: string | null; metadata?: InboxMetadata };
export type OpenThread = {
  kind: 'message' | 'comment' | 'review'; id: string; rating: number | null; recommendation: 'positive' | 'negative' | null; target: { id: string; name: string; providerId: string; provider: string | null };
  resolved: boolean; hidden: boolean; postText: string | null;
  /** Local id of the commented post; null for messages, reviews and unlinked threads. */
  postId: string | null;
  entries: ThreadEntry[];
  lastInbound: { fromId: string | null; createdTime: Date } | null;
  remoteId?: string;
  metadata?: InboxMetadata;
};
/** For comments, history counts/pages replies; the original comment stays visible on every page. */
export type InboxThreadPage = { thread: OpenThread; history: InboxPageCursors & { total: number; shown: number; limit: number; cursor: string | null } };
