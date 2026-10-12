import { requireCapability } from '@/lib/auth';
import { canModerateComments } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { errors } from '@/lib/errors';
import { savedReplySchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canModerateComments);
  const { id } = await context.params;
  const input = savedReplySchema.partial().parse(await readJson(request));
  const updated = await prisma.savedReply.updateMany({ where: { id, workspaceId: auth.workspace.id }, data: input });
  if (updated.count === 0) throw errors.notFound();
  return ok({ updated: true });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canModerateComments);
  const { id } = await context.params;
  const deleted = await prisma.savedReply.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (deleted.count === 0) throw errors.notFound();
  return ok({ deleted: true });
});
