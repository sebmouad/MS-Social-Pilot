import { requireAuth } from '@/lib/auth';
import { assertPostInScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { assertMayAct } from '@/lib/posts';
import { retryFirstComments } from '@/lib/first-comment';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/**
 * Try the first comment again wherever Facebook refused it. The post itself
 * is already out; only the comment is sent.
 */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);

  const post = await prisma.post.findFirst({ where: { id, workspaceId: auth.workspace.id } });
  if (!post) throw errors.postNotFound();
  assertMayAct(post, { userId: auth.user.id, role: auth.role });

  return ok(await retryFirstComments(post.id));
});
