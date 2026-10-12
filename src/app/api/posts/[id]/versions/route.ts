import { requireAuth } from '@/lib/auth';
import { canManageOthersPosts } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { assertPostInScope } from '@/lib/page-access';
import { listVersions } from '@/lib/post-versions';
import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api';

/** Version history (H9): who may edit a post may see its earlier versions. */
export const GET = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);
  const post = await prisma.post.findFirst({ where: { id, workspaceId: auth.workspace.id }, select: { authorId: true } });
  if (!post || (post.authorId !== auth.user.id && !canManageOthersPosts(auth.role))) throw errors.postNotFound();
  return ok({ versions: await listVersions(id, auth.workspace.timezone) });
});
