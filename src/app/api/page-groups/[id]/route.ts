import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { deletePageGroup, pageGroupUpdateSchema, updatePageGroup } from '@/lib/page-groups';
import { ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

const notFound = () => new AppError({ key: 'errors.groupNotFound', fallback: 'Group not found.', status: 404 });

/** Rename, recolour or change the Pages of a group. */
export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const input = pageGroupUpdateSchema.parse(await readJson(request));
  if (!(await updatePageGroup(auth.workspace.id, id, input))) throw notFound();
  return ok({ ok: true });
});

/** Delete a group. Its Pages, and their posts, are untouched. */
export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  if (!(await deletePageGroup(auth.workspace.id, id))) throw notFound();
  return ok({ ok: true });
});
