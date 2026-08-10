import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, ok, readJson, route } from '@/lib/api';
import { syncTargetEdges } from '@/lib/engagement';

const schema = z.object({
  /** Omit to refresh every enabled Page in the workspace. */
  targetId: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
});

/**
 * Refresh comments, reviews, inbox threads, videos and unscheduled posts.
 *
 * Returns the per-edge error list rather than a single failure: a Page whose
 * token cannot read the inbox should still report the comments it did fetch.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse((await readJson(request).catch(() => ({}))) ?? {});

  const targets = await prisma.target.findMany({
    where: {
      workspaceId: auth.workspace.id,
      type: 'page',
      enabled: true,
      ...(input.targetId ? { id: input.targetId } : {}),
    },
    select: { id: true },
  });

  if (targets.length === 0) return fail('No Facebook Page to refresh.', 404);

  const results = [];
  for (const target of targets) {
    results.push(
      await syncTargetEdges({
        targetId: target.id,
        since: input.since ? new Date(input.since) : undefined,
      }),
    );
  }

  return ok({ results });
});
