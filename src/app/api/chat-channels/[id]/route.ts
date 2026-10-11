import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { CHAT_EVENTS } from '@/lib/chat';
import { canManageSettings } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  events: z.array(z.enum(CHAT_EVENTS)).min(1).optional(),
});

export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const input = updateSchema.parse(await readJson(request));
  const { count } = await prisma.chatChannel.updateMany({ where: { id, workspaceId: auth.workspace.id }, data: input });
  if (count === 0) throw errors.notFound();
  return ok({ ok: true });
});

export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const { count } = await prisma.chatChannel.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw errors.notFound();
  return ok({ ok: true });
});
