import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  probeAllLevels,
  probeTarget,
  readAvailability,
  readCoverage,
  readStoredAnalytics,
  syncTargetAnalytics,
} from '@/lib/analytics';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';

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
  if (!target) throw errors.destinationNotFound();

  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();
  const from = url.searchParams.get('from')
    ? new Date(url.searchParams.get('from')!)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw errors.dateRange();
  }

  const [series, availability, coverage] = await Promise.all([
    readStoredAnalytics({
      targetId,
      from,
      to,
      period: url.searchParams.get('period') ?? undefined,
    }),
    readAvailability(targetId),
    readCoverage(targetId),
  ]);

  return ok({
    coverage,
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
  action: z.enum(['sync', 'probe', 'probeAll']).default('sync'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  period: z.enum(['day', 'week', 'days_28', 'lifetime']).optional(),
  level: z.enum(['page', 'post', 'video', 'ig_account', 'ig_media']).optional(),
});

/** Pull fresh data from Graph, or probe which metrics it will serve. */
export const POST = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { targetId } = await context.params;

  const target = await loadTarget(targetId, auth.workspace.id);
  if (!target) throw errors.destinationNotFound();

  const body = await readJson(request).catch(() => ({}));
  const input = postSchema.parse(body ?? {});

  // A full probe walks every level against a real Page, post, video and — when
  // linked — a real Instagram account and media item.
  if (input.action === 'probeAll') {
    return ok({ levels: await probeAllLevels(targetId) });
  }

  if (input.action === 'probe') {
    return ok({ metrics: await probeTarget(targetId, input.period, input.level) });
  }

  const result = await syncTargetAnalytics({
    targetId,
    since: input.from ? new Date(input.from) : undefined,
    until: input.to ? new Date(input.to) : undefined,
  });

  return ok(result);
});
