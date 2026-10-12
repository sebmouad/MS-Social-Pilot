import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { addChartNote, chartNoteSchema } from '@/lib/chart-notes';
import { atLeast } from '@/lib/constants';
import { ok, readJson, route } from '@/lib/api';

/** Add a note to analytics timelines (H13). Editors and up, like report templates. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const note = await addChartNote({
    workspaceId: auth.workspace.id,
    scope: auth.pageScope,
    authorId: auth.user.id,
    input: chartNoteSchema.parse(await readJson(request)),
  });
  return ok({ note }, 201);
});
