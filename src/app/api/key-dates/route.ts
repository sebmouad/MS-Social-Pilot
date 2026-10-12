import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { checkTargets, keyDateSchema } from '@/lib/key-dates-store';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

/** The team's own key dates (H2). Everybody sees them on the calendar. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ keyDates: await prisma.keyDate.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { date: 'asc' } }) });
});

/** Add a key date. Admins, like the rest of how the workspace plans. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = keyDateSchema.parse(await readJson(request));
  const targetIds = await checkTargets(auth.workspace.id, input.targetIds);
  const keyDate = await prisma.keyDate.create({
    data: { workspaceId: auth.workspace.id, date: input.date, title: input.title, yearly: input.yearly, targetIds, createdById: auth.user.id },
  });
  return ok({ keyDate }, 201);
});
