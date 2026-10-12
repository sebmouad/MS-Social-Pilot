import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { checkTargets, seasonNotFound, seasonSchema } from '@/lib/key-dates-store';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

/** Replace a seasonal mode (the form sends all of it). */
export const PUT = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const input = seasonSchema.parse(await readJson(request));
  const targetIds = await checkTargets(auth.workspace.id, input.targetIds);
  const { count } = await prisma.seasonalMode.updateMany({ where: { id, workspaceId: auth.workspace.id }, data: { ...input, targetIds } });
  if (count === 0) throw seasonNotFound();
  return ok({ ok: true });
});

/** End a seasonal mode now. Posts already given a time keep it. */
export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const { count } = await prisma.seasonalMode.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw seasonNotFound();
  return ok({ ok: true });
});
