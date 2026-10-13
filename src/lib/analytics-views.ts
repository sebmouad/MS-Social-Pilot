/**
 * The analytics screen's views, in tab order.
 *
 * In a module of its own, with no server imports, because both sides need the
 * list: the tab strip (a client component) to draw it, and the page (a server
 * component) to refuse anything else. An array exported from a client module
 * reaches the server as a reference, not as the array.
 */
export const ANALYTICS_VIEWS = [
  'summary',
  'total',
  'analysis',
  'compare',
  'overview',
  'posts',
  'interactions',
  'audience',
  'videos',
  'comments',
  'reviews',
  'inbox',
  'responseTime',
  'external',
  'networks',
] as const;

export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** The view a bare /analytics, or an unknown `?view=`, opens on. */
export const DEFAULT_ANALYTICS_VIEW: AnalyticsView = 'summary';

/**
 * Views that read everything stored rather than a date window.
 *
 * The header's "1 Sep – 1 Oct" would claim a scope these do not have.
 */
export const UNWINDOWED_VIEWS: ReadonlySet<AnalyticsView> = new Set([
  'videos',
  'comments',
  'reviews',
  'inbox',
]);

/**
 * The view /analytics opens on with no `?view=`: the Summary, which reads one
 * profile or the whole selection alike.
 */
export function defaultAnalyticsView(_profiles?: number): AnalyticsView {
  return DEFAULT_ANALYTICS_VIEW;
}

/**
 * Views the Summary replaced; their bookmarks open it. Instagram's figures
 * are now part of the four primary views.
 */
const MERGED_INTO_SUMMARY: ReadonlySet<string> = new Set(['analysis', 'total', 'instagram']);

/** Narrow a `?view=` value to a known view, falling back to the default. */
export function parseAnalyticsView(value: string | undefined): AnalyticsView {
  if (MERGED_INTO_SUMMARY.has(value ?? '')) return 'summary';
  return (ANALYTICS_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as AnalyticsView)
    : DEFAULT_ANALYTICS_VIEW;
}

/**
 * Query parameters that belong to one view and mean nothing — or the wrong
 * thing — in another: the comments search, its visibility filter, the
 * comparison's sort, and the page number, which would open the next view on a
 * page that may not exist.
 */
export const VIEW_SCOPED_PARAMS = ['page', 'q', 'shown', 'sort', 'order'] as const;

/**
 * The four views the menu lists (Simplified keeps four). The others still
 * open from a link or a bookmark, but are not offered.
 */
export const PRIMARY_ANALYTICS_VIEWS: readonly AnalyticsView[] = ['summary', 'posts', 'audience', 'compare'];

/**
 * Engagement views that belong to the Inbox module and open there, from its
 * sidebar, rather than as analytics tabs.
 */
export const INBOX_VIEW_PATHS: Partial<Record<AnalyticsView, string>> = {
  comments: '/inbox/comments',
  reviews: '/inbox/reviews',
  responseTime: '/inbox/response-time',
  inbox: '/inbox/messages',
};
