import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { atLeast } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';
import { mayUsePage } from '@/lib/page-access';

/** Stop sending a report. */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const { id } = await context.params;
  const schedule = await prisma.reportSchedule.findFirst({ where: { id, workspaceId: auth.workspace.id } });
  if (!schedule || !mayUsePage(auth.pageScope, schedule.targetId)) throw errors.notFound();
  await prisma.reportSchedule.delete({ where: { id } });
  return ok({ ok: true });
});
