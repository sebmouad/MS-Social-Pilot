import { requireCapability } from '@/lib/auth';
import { canManageTemplates } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { templateSchema, updateTemplate } from '@/lib/post-templates-store';
import { ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export const PUT = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageTemplates);
  const { id } = await context.params;
  await updateTemplate(auth.workspace.id, id, templateSchema.parse(await readJson(request)));
  return ok({ updated: true });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageTemplates);
  const { id } = await context.params;
  const { count } = await prisma.postTemplate.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw errors.notFound();
  return ok({ deleted: true });
});
