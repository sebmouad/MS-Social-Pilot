import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { deleteChartNote } from '@/lib/chart-notes';
import { atLeast } from '@/lib/constants';
import { ok, route } from '@/lib/api';

export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const { id } = await context.params;
  await deleteChartNote({ workspaceId: auth.workspace.id, scope: auth.pageScope, noteId: id });
  return ok({ ok: true });
});
