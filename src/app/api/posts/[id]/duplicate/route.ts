import { requireAuth } from '@/lib/auth';
import { assertPostInScope } from '@/lib/page-access';
import { duplicatePost } from '@/lib/posts';
import { ok, route } from '@/lib/api';

/** Copy a post into a new draft, keeping its content and destinations. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);

  const postId = await duplicatePost({ workspaceId: auth.workspace.id, userId: auth.user.id }, id);
  return ok({ postId }, 201);
});
