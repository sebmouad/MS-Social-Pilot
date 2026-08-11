import { prisma } from '../prisma';

/**
 * Walking every workspace, or every destination, a page at a time.
 *
 * Five jobs used to open with `findMany({ select: { id: true } })` and hold the
 * whole list in memory. At today's scale that is a handful of rows; at an
 * agency with a few thousand clients it is a growing allocation held for the
 * entire pass, and the pass is already the longest-running thing in the
 * process.
 *
 * Cursor paging rather than offset: `skip` re-scans everything it skips, so the
 * last page of a long list costs the most, and rows inserted mid-pass shift the
 * window. A cursor on the primary key is stable under concurrent inserts and
 * costs the same on every page.
 *
 * The handler runs one workspace at a time on purpose. These jobs call Graph,
 * and Facebook throttles per app — running tenants in parallel would spend the
 * rate limit faster without finishing sooner.
 */

/** How many ids are held at once. Small: the work per row dwarfs the query. */
const PAGE_SIZE = 100;

export interface IterationResult {
  /** How many rows the handler was called for. */
  visited: number;
  /** Rows whose handler threw, with the reason. */
  failures: Array<{ id: string; message: string }>;
}

async function paged(
  fetchPage: (cursor: string | undefined) => Promise<Array<{ id: string }>>,
  handle: (id: string) => Promise<void>,
): Promise<IterationResult> {
  const result: IterationResult = { visited: 0, failures: [] };
  let cursor: string | undefined;

  for (;;) {
    const page = await fetchPage(cursor);
    if (page.length === 0) break;

    for (const row of page) {
      result.visited += 1;
      try {
        await handle(row.id);
      } catch (error) {
        // One tenant's broken connection must not end the pass for everyone
        // behind it in the list.
        result.failures.push({
          id: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1]!.id;
  }

  return result;
}

/** Run `handle` for every workspace, a page at a time. */
export function forEachWorkspace(
  handle: (workspaceId: string) => Promise<void>,
): Promise<IterationResult> {
  return paged(
    (cursor) =>
      prisma.workspace.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    handle,
  );
}

/** Run `handle` for every enabled Page across every workspace. */
export function forEachEnabledPage(
  handle: (targetId: string) => Promise<void>,
): Promise<IterationResult> {
  return paged(
    (cursor) =>
      prisma.target.findMany({
        where: { type: 'page', enabled: true },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    handle,
  );
}
