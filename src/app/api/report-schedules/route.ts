import { WorkspaceRole } from '@prisma/client';

import { requireCapability } from '@/lib/auth';
import { atLeast } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';
import { assertPagesAllowed, mayUsePage } from '@/lib/page-access';
import { createReportSchedule, reportScheduleSchema } from '@/lib/report-schedules';

/** Reports emailed on a rhythm, for the Pages this member may see. */
export const GET = route(async () => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const schedules = await prisma.reportSchedule.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ schedules: schedules.filter((row) => mayUsePage(auth.pageScope, row.targetId)) });
});

/** Mailing figures outside the workspace is an editor's decision, as publishing is. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const input = reportScheduleSchema.parse(await readJson(request));
  assertPagesAllowed(auth.pageScope, [input.targetId]);
  const schedule = await createReportSchedule(auth.workspace.id, input, auth.user.id);
  return ok({ schedule }, 201);
});
