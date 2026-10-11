/**
 * The analytics screen's views, in tab order.
 *
 * In a module of its own, with no server imports, because both sides need the
 * list: the tab strip (a client component) to draw it, and the page (a server
 * component) to refuse anything else. An array exported from a client module
 * reaches the server as a reference, not as the array.
 */
export const ANALYTICS_VIEWS = [
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
  'external',
  'instagram',
] as const;

export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** The view a bare /analytics, or an unknown `?view=`, opens on. */
export const DEFAULT_ANALYTICS_VIEW: AnalyticsView = 'analysis';

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
 * The view /analytics opens on with no `?view=`: the total of the selection
 * when it holds several profiles, one profile's analysis otherwise
 * (NEXT_PHASES B1).
 */
export function defaultAnalyticsView(profiles: number): AnalyticsView {
  return profiles > 1 ? 'total' : DEFAULT_ANALYTICS_VIEW;
}

/** Narrow a `?view=` value to a known view, falling back to the default. */
export function parseAnalyticsView(value: string | undefined): AnalyticsView {
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
