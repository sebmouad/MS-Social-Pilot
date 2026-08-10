import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { probeTarget, readAvailability, readStoredAnalytics, syncTargetAnalytics } from '@/lib/analytics';
import { fail, ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ targetId: string }> };

/**
 * Confirm the destination belongs to the caller's workspace.
 *
 * Analytics is per destination, and target ids come from the client, so this
 * is the cross-tenant boundary for the whole module.
 */
async function loadTarget(targetId: string, workspaceId: string) {
  return prisma.target.findFirst({ where: { id: targetId, workspaceId } });
}

/** Stored snapshots for a date range, plus what Graph will and will not serve. */
export const GET = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { targetId } = await context.params;
  const url = new URL(request.url);

  const target = await loadTarget(targetId, auth.workspace.id);
  if (!target) return fail('Destination not found.', 404);

  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();
  const from = url.searchParams.get('from')
    ? new Date(url.searchParams.get('from')!)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return fail('Enter a valid date range.', 400);
  }

  const [series, availability] = await Promise.all([
    readStoredAnalytics({
      targetId,
      from,
      to,
      period: url.searchParams.get('period') ?? undefined,
    }),
    readAvailability(targetId),
  ]);

  return ok({
    target: {
      id: target.id,
      name: target.name,
      type: target.type,
      fanCount: target.fanCount,
      followersCount: target.followersCount,
      talkingAboutCount: target.talkingAboutCount,
      profileSyncedAt: target.profileSyncedAt,
    },
    series,
    availability,
  });
});

const postSchema = z.object({
  action: z.enum(['sync', 'probe']).default('sync'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  period: z.enum(['day', 'week', 'days_28', 'lifetime']).optional(),
});

/** Pull fresh data from Graph, or probe which metrics it will serve. */
export const POST = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { targetId } = await context.params;

  const target = await loadTarget(targetId, auth.workspace.id);
  if (!target) return fail('Destination not found.', 404);

  const body = await readJson(request).catch(() => ({}));
  const input = postSchema.parse(body ?? {});

  if (input.action === 'probe') {
    return ok({ metrics: await probeTarget(targetId, input.period) });
  }

  const result = await syncTargetAnalytics({
    targetId,
    since: input.from ? new Date(input.from) : undefined,
    until: input.to ? new Date(input.to) : undefined,
  });

  return ok(result);
});
