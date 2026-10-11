import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { atLeast } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';

/** Deleting a shared text takes it away from everybody, so it is an editor's call. */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const { id } = await context.params;
  const { count } = await prisma.snippet.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw new AppError({ key: 'errors.notFound', fallback: 'Not found.', status: 404 });
  return ok({ ok: true });
});
