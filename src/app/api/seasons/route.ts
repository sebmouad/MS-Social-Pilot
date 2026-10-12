import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { checkTargets, seasonSchema } from '@/lib/key-dates-store';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

/** Seasonal posting modes (H2). */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ seasons: await prisma.seasonalMode.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { startsOn: 'asc' } }) });
});

/** Add a seasonal mode. Admins only: it changes when every queued post goes out. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = seasonSchema.parse(await readJson(request));
  const targetIds = await checkTargets(auth.workspace.id, input.targetIds);
  const season = await prisma.seasonalMode.create({ data: { workspaceId: auth.workspace.id, ...input, targetIds } });
  return ok({ season }, 201);
});
