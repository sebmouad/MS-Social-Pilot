import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { atLeast } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { deleteLabel, labelUpdateSchema, updateLabel } from '@/lib/page-groups';
import { ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

const notFound = () => new AppError({ key: 'errors.labelNotFound', fallback: 'Label not found.', status: 404 });

/**
 * Renaming or deleting a label changes it on every post that carries it, so
 * it is an editor's call, not a contributor's.
 */
const canEditLabels = (role: WorkspaceRole) => atLeast(role, WorkspaceRole.editor);

export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canEditLabels);
  const { id } = await context.params;
  const input = labelUpdateSchema.parse(await readJson(request));
  if (!(await updateLabel(auth.workspace.id, id, input))) throw notFound();
  return ok({ ok: true });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canEditLabels);
  const { id } = await context.params;
  if (!(await deleteLabel(auth.workspace.id, id))) throw notFound();
  return ok({ ok: true });
});
