import { z } from 'zod';
import { PublishMode } from '@prisma/client';

import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { parseTargetIds, toJson } from '@/lib/json';
import { errors } from '@/lib/errors';
import { ok, readJson, route } from '@/lib/api';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this feed a name.').max(120),
  url: z.string().trim().url('Enter the feed URL.'),
  messageTemplate: z.string().trim().min(1).max(2000).default('{{title}}\n\n{{link}}'),
  targetIds: z.array(z.string().min(1)).min(1, 'Choose at least one destination.'),
  publishMode: z.nativeEnum(PublishMode).default(PublishMode.worker),
  autoApprove: z.boolean().default(true),
});

export const GET = route(async () => {
  const auth = await requireAuth();

  const sources = await prisma.feedSource.findMany({
    where: { workspaceId: auth.workspace.id },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return ok({
    feeds: sources.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      enabled: source.enabled,
      messageTemplate: source.messageTemplate,
      targetIds: parseTargetIds(source.targetIds),
      autoApprove: source.autoApprove,
      lastPolledAt: source.lastPolledAt,
      lastError: source.lastError,
      pollErrorCount: source.pollErrorCount,
      itemCount: source._count.items,
    })),
  });
});

export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = createSchema.parse(await readJson(request));

  // Destination ids come from the client, so confirm they belong here.
  const valid = await prisma.target.findMany({
    where: { id: { in: input.targetIds }, workspaceId: auth.workspace.id },
    select: { id: true },
  });
  if (valid.length !== input.targetIds.length) throw errors.targetsUnavailable();

  const source = await prisma.feedSource.create({
    data: {
      workspaceId: auth.workspace.id,
      name: input.name,
      url: input.url,
      messageTemplate: input.messageTemplate,
      targetIds: toJson(valid.map((target) => target.id)),
      publishMode: input.publishMode,
      autoApprove: input.autoApprove,
      // Nothing published before now: subscribing must not queue the archive.
      ingestFrom: new Date(),
    },
  });

  return ok({ id: source.id }, 201);
});
