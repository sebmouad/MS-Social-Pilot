import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { assertPageParam } from '@/lib/page-access';
import { ok, readJson, route } from '@/lib/api';
import { canModerateComments } from '@/lib/constants';
import { EDGE_NAMES, syncWorkspaceEdges } from '@/lib/engagement';
import { errors } from '@/lib/errors';
import { hit } from '@/lib/rate-limit';

const schema = z.object({
  /** Omit to refresh every enabled Page in the workspace. */
  targetId: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
  /** Only what the screen shows; omit for everything. */
  edges: z.array(z.enum(EDGE_NAMES)).min(1).optional(),
});

/**
 * How often one workspace may pull from Facebook by hand.
 *
 * A pass walks every Page's comments, reviews, inbox, posts and videos, and
 * spends the Page's Graph allowance doing it — the allowance the scheduler
 * needs to publish. A few in a minute covers somebody checking for a reply
 * they are expecting; a held-down button, or several colleagues pressing at
 * once, gets told to wait rather than getting the Page rate-limited.
 */
const SYNC_LIMIT = { limit: 3, windowMs: 60_000 };

/**
 * Refresh comments, reviews, inbox threads, videos and unscheduled posts.
 *
 * Returns the per-edge error list rather than a single failure: a Page whose
 * token cannot read the inbox should still report the comments it did fetch,
 * and a Page that fails outright should not take the rest of the pass with it.
 * Both are `syncWorkspaceEdges`' job, so the two cannot come apart here.
 *
 * Editors and above only, the same people who see the Refresh button: the
 * pass is the moderation screens' input, and a viewer who cannot act on a
 * comment has no reason to spend the Page's Graph allowance fetching one.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!canModerateComments(auth.role)) throw errors.refreshNoPermission();

  // Per workspace rather than per person: the allowance being protected
  // belongs to the Pages, which the whole team shares.
  const throttle = hit(`engagement-sync:${auth.workspace.id}`, SYNC_LIMIT);
  if (!throttle.allowed) {
    throw errors.refreshTooSoon(Math.max(1, Math.ceil((throttle.resetAt - Date.now()) / 1000)));
  }

  const input = schema.parse((await readJson(request).catch(() => ({}))) ?? {});
  assertPageParam(auth.pageScope, input.targetId);

  const { results, empty } = await syncWorkspaceEdges({
    workspaceId: auth.workspace.id,
    targetId: input.targetId,
    since: input.since ? new Date(input.since) : undefined,
    edges: input.edges,
  });

  if (empty) throw errors.noPageToRefresh();

  return ok({ results });
});
