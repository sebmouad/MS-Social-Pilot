import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decryptSecret } from '@/lib/crypto';
import { stringifyJson } from '@/lib/json';
import { fetchPostInsights } from '@/lib/facebook/insights';
import { asGraphError } from '@/lib/facebook/graph';
import { ok, route } from '@/lib/api';

/** How many published destinations to refresh in one request. */
const BATCH = 25;

/**
 * Pull fresh engagement numbers for recently published posts.
 *
 * Deliberately batched and stale-first: refreshing everything on every page
 * load would burn the app's rate limit for no benefit, since these counters
 * move slowly.
 */
export const POST = route(async () => {
  const auth = await requireAuth();

  const rows = await prisma.postTarget.findMany({
    where: {
      status: 'published',
      remotePostId: { not: null },
      post: { workspaceId: auth.workspace.id },
    },
    include: { target: { include: { socialAccount: true } } },
    orderBy: [{ insightsSyncedAt: { sort: 'asc', nulls: 'first' } }, { publishedAt: 'desc' }],
    take: BATCH,
  });

  let refreshed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const encrypted = row.target.accessToken ?? row.target.socialAccount?.accessToken ?? null;
    if (!encrypted || !row.remotePostId) continue;

    try {
      const insights = await fetchPostInsights(row.remotePostId, decryptSecret(encrypted), {
        // Groups expose no insights edge; skip the call rather than fail it.
        includeInsights: row.target.type === 'page',
      });

      await prisma.postTarget.update({
        where: { id: row.id },
        data: { insights: stringifyJson(insights), insightsSyncedAt: new Date() },
      });
      refreshed += 1;
    } catch (error) {
      errors.push(`${row.target.name}: ${asGraphError(error).displayMessage}`);
    }
  }

  return ok({ refreshed, checked: rows.length, errors });
});
