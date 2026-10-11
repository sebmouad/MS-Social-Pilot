import { WorkspaceRole } from '@prisma/client';

import { requireAuth, requireCapability } from '@/lib/auth';
import { atLeast } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';
import { reportTemplateSchema } from '@/lib/report-schedules';

const SELECT = { id: true, name: true, sections: true, rangeKey: true } as const;

/** Saved report layouts: which sections, over which period. */
export const GET = route(async () => {
  const auth = await requireAuth();
  const templates = await prisma.reportTemplate.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { name: 'asc' },
    select: SELECT,
  });
  return ok({ templates });
});

/**
 * Save the report on screen as a template. Saving under a name that exists
 * replaces it: "Monthly client report" is updated, not duplicated.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability((role) => atLeast(role, WorkspaceRole.editor));
  const input = reportTemplateSchema.parse(await readJson(request));
  const template = await prisma.reportTemplate.upsert({
    where: { workspaceId_name: { workspaceId: auth.workspace.id, name: input.name } },
    create: { workspaceId: auth.workspace.id, ...input },
    update: { sections: input.sections, rangeKey: input.rangeKey },
    select: SELECT,
  });
  return ok({ template }, 201);
});
