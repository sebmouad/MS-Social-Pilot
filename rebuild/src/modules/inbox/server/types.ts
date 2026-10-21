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
};
/** One-click narrowing of the activity list. Several may be combined; each must hold. Items a filter cannot judge (for example unclassified comments for negative) are left out, never guessed. */
export const INBOX_QUICK_FILTERS = ['unread', 'unanswered', 'negative', 'mentions'] as const;
export type InboxQuickFilter = typeof INBOX_QUICK_FILTERS[number];
export type InboxFilters ={ channelId: string | null; kind: 'all' | 'message' | 'comment' | 'review'; state: 'open' | 'resolved' | 'all'; hidden: 'visible' | 'all'; q: string };
export type InboxPageCursors = { olderCursor: string | null; newerCursor: string | null };
export type InboxLimits = { listPageSize: number; threadPageSize: number; searchMaxCharacters: number; cursorMaxCharacters: number; /** Items one bulk action may include; screens use it to explain the limit before a request is made. */ bulkMaxItems?: number };
export type InboxListPage = InboxPageCursors & { /** Present only when quick filters are applied. */ quick?: InboxQuickFilter[]; items: InboxListItem[]; total: number; limit: number; cursor: string | null; filters: InboxFilters; channels: { id: string; name: string }[]; lastSynced: Date | null; timeZone: string; limits: InboxLimits };
/** Comment threads nest: parentId is the entry a reply answers (the opening comment when its parent is not on this page); depth is 0 for the opening comment. */
export type ThreadEntry = { id: string; author: string; text: string; time: Date; fromChannel: boolean; sentBy: string | null; parentId: string | null; depth: number; hidden: boolean };
export type OpenThread = {
  kind: 'message' | 'comment' | 'review'; id: string; rating: number | null; recommendation: 'positive' | 'negative' | null; target: { id: string; name: string; providerId: string; provider: string | null };
  resolved: boolean; hidden: boolean; postText: string | null; entries: ThreadEntry[];
  lastInbound: { fromId: string | null; createdTime: Date } | null;
};
/** For comments, history counts/pages replies; the original comment stays visible on every page. */
export type InboxThreadPage = { thread: OpenThread; history: InboxPageCursors & { total: number; shown: number; limit: number; cursor: string | null } };
