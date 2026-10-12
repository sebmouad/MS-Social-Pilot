import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { checkTargets, keyDateNotFound, keyDateSchema } from '@/lib/key-dates-store';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

/** Change a key date. */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const input = keyDateSchema.partial().parse(await readJson(request));
  const targetIds = input.targetIds ? await checkTargets(auth.workspace.id, input.targetIds) : undefined;
  const { count } = await prisma.keyDate.updateMany({ where: { id, workspaceId: auth.workspace.id }, data: { ...input, targetIds } });
  if (count === 0) throw keyDateNotFound();
  return ok({ ok: true });
});

/** Remove a key date. Posts planned for it stay. */
export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const { count } = await prisma.keyDate.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw keyDateNotFound();
  return ok({ ok: true });
});
