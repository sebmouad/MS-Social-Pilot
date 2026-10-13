import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { mixUpdateSchema, saveMix } from '@/lib/content-mix';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/scheduler/runner';

/** Replace the weekly mix of one Page or group. */
export const PUT = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = mixUpdateSchema.parse(await readJson(request));
  await saveMix(auth.workspace.id, input);
  await logActivity(auth.workspace.id, 'queue.mixUpdated', { ...input.scope, rules: input.rules.length }, auth.user.id);
  return ok({ saved: true });
});

/** Let the worker schedule drafts to meet the mix, or only warn. */
export const PATCH = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const { autoFill } = z.object({ autoFill: z.boolean() }).parse(await readJson(request));
  await prisma.workspace.update({ where: { id: auth.workspace.id }, data: { mixAutoFill: autoFill } });
  await logActivity(auth.workspace.id, 'queue.mixUpdated', { autoFill }, auth.user.id);
  return ok({ autoFill });
});
