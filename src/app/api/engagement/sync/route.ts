import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { syncWorkspaceEdges } from '@/lib/engagement';
import { errors } from '@/lib/errors';

const schema = z.object({
  /** Omit to refresh every enabled Page in the workspace. */
  targetId: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
});

/**
 * Refresh comments, reviews, inbox threads, videos and unscheduled posts.
 *
 * Returns the per-edge error list rather than a single failure: a Page whose
 * token cannot read the inbox should still report the comments it did fetch,
 * and a Page that fails outright should not take the rest of the pass with it.
 * Both are `syncWorkspaceEdges`' job, so the two cannot come apart here.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse((await readJson(request).catch(() => ({}))) ?? {});

  const { results, empty } = await syncWorkspaceEdges({
    workspaceId: auth.workspace.id,
    targetId: input.targetId,
    since: input.since ? new Date(input.since) : undefined,
  });

  if (empty) throw errors.noPageToRefresh();

  return ok({ results });
});
