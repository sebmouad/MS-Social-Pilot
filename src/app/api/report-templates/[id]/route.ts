import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { atLeast } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';

/** Schedules built on it keep running, with every section. */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const { id } = await context.params;
  const { count } = await prisma.reportTemplate.deleteMany({ where: { id, workspaceId: auth.workspace.id } });
  if (count === 0) throw errors.notFound();
  return ok({ ok: true });
});
