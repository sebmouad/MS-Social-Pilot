import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { createShareLink, shareLinkSchema } from '@/lib/share-links';
import { ok, readJson, route } from '@/lib/api';

export const GET = route(async () => {
  const auth = await requireCapability(canManageSettings);
  const links = await prisma.shareLink.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, title: true, revokedAt: true, createdAt: true },
  });
  return ok({ links });
});

/**
 * Make a link. Admins only: it opens the workspace's posts to somebody with no
 * account, which is the same kind of decision as inviting them.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const input = shareLinkSchema.parse(await readJson(request));
  return ok(await createShareLink(auth.workspace.id, auth.user.id, input), 201);
});
