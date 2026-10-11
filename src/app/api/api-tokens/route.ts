import { requireAuth } from '@/lib/auth';
import { apiTokenSchema, createApiToken } from '@/lib/api-tokens';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';

/** Your own keys; owners and admins see everybody's, to revoke a leaked one. */
export const GET = route(async () => {
  const auth = await requireAuth();
  const tokens = await prisma.apiToken.findMany({
    where: { workspaceId: auth.workspace.id, ...(canManageSettings(auth.role) ? {} : { userId: auth.user.id }) },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, prefix: true, scope: true, lastUsedAt: true, revokedAt: true, createdAt: true, user: { select: { name: true } } },
  });
  return ok({ tokens });
});

/** A key acts as you, so anyone may make one — it can never do more than they can. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = apiTokenSchema.parse(await readJson(request));
  const made = await createApiToken({ workspaceId: auth.workspace.id, userId: auth.user.id, ...input });
  return ok(made, 201);
});
