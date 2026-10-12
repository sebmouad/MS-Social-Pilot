import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { pollSource } from '@/lib/rss/poll';
import { toJson } from '@/lib/json';
import { errors } from '@/lib/errors';
import { assertFeedDestinations } from '@/lib/feeds';
import { ok, readJson, route } from '@/lib/api';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  messageTemplate: z.string().trim().min(1).max(2000).optional(),
  targetIds: z.array(z.string().min(1)).min(1).optional(),
  autoApprove: z.boolean().optional(),
  hashtags: z.string().trim().max(500).optional(),
  spreadMinutes: z.number().int().min(0).max(720).optional(),
});

type Context = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const input = patchSchema.parse(await readJson(request));

  const source = await prisma.feedSource.findFirst({
    where: { id, workspaceId: auth.workspace.id },
  });
  if (!source) throw errors.feedNotFound();

  let targetIds: string[] | undefined;
  if (input.targetIds) {
    const valid = await prisma.target.findMany({
      where: { id: { in: input.targetIds }, workspaceId: auth.workspace.id },
      select: { id: true, name: true, type: true },
    });
    if (valid.length !== input.targetIds.length) throw errors.targetsUnavailable();
    assertFeedDestinations(valid);
    targetIds = valid.map((target) => target.id);
  }

  await prisma.feedSource.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.messageTemplate !== undefined ? { messageTemplate: input.messageTemplate } : {}),
      ...(input.autoApprove !== undefined ? { autoApprove: input.autoApprove } : {}),
      ...(input.hashtags !== undefined ? { hashtags: input.hashtags } : {}),
      ...(input.spreadMinutes !== undefined ? { spreadMinutes: input.spreadMinutes } : {}),
      ...(targetIds ? { targetIds: toJson(targetIds) } : {}),
      ...(input.enabled !== undefined
        ? {
            enabled: input.enabled,
            // Re-enabling a source that auto-disabled itself must clear the
            // error count, or it disables again on the next hiccup.
            ...(input.enabled ? { pollErrorCount: 0, lastError: null } : {}),
          }
        : {}),
    },
  });

  return ok({ ok: true });
});

/** Poll this feed now, rather than waiting for the worker's interval. */
export const POST = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;

  const source = await prisma.feedSource.findFirst({
    where: { id, workspaceId: auth.workspace.id },
  });
  if (!source) throw errors.feedNotFound();

  return ok(await pollSource(source));
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;

  // Posts already created keep their sourceFeedItemId relation nulled by the
  // schema, so removing a feed does not delete published history.
  const { count } = await prisma.feedSource.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  // Another workspace's feed (or none at all) answers like any missing row.
  if (count === 0) throw errors.feedNotFound();
  return ok({ ok: true });
});
