/**
 * Page numbers for the screens that list things.
 *
 * Offset paging rather than a cursor, which is the opposite of what the worker
 * does and right for a different reason. The worker walks an entire table, and
 * `skip` re-scans everything it skips, so the last page costs the most. A
 * person browsing a list does not walk it — they look at the first page or two
 * and then filter — so the cost never arrives, and page numbers let them see
 * how much there is and jump back to where they were.
 *
 * The ordering has to carry a unique tiebreaker for any of this to be true. A
 * sort on a timestamp alone leaves rows with equal values in an order the
 * database may choose differently on each query, and then page two can repeat
 * a row page one already showed while another is never shown at all.
 */

export interface Page {
  /** 1-based, clamped into range. */
  number: number;
  size: number;
  total: number;
  pages: number;
  skip: number;
  take: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** 1-based index of the first and last row on this page, for "1–20 of 96". */
  from: number;
  to: number;
}

export const DEFAULT_PAGE_SIZE = 25;

/** Read `?page=` from a query value that may be absent, repeated, or nonsense. */
export function pageNumber(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

/**
 * Work out the page, given how many rows there turned out to be.
 *
 * A page number past the end is clamped to the last page rather than showing
 * an empty list: it happens when somebody bookmarks page nine and posts are
 * later deleted, and an empty screen reads as "your posts are gone".
 */
export function paginate(options: {
  total: number;
  requested: number;
  size?: number;
}): Page {
  const size = Math.max(1, options.size ?? DEFAULT_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(options.total / size));
  const number = Math.min(Math.max(1, options.requested), pages);
  const skip = (number - 1) * size;

  return {
    number,
    size,
    total: options.total,
    pages,
    skip,
    take: size,
    hasPrevious: number > 1,
    hasNext: number < pages,
    from: options.total === 0 ? 0 : skip + 1,
    to: Math.min(skip + size, options.total),
  };
}

/**
 * The same URL with a different page.
 *
 * Every filter on the screen lives in the query string, so paging has to carry
 * them: a Next button that dropped `?status=failed` would look like it had
 * jumped somewhere else entirely.
 */
export function pageHref(
  path: string,
  params: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first) query.set(key, first);
  }

  if (page > 1) query.set('page', String(page));

  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
