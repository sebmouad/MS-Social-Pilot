import { requireAuth } from '@/lib/auth';
import { assertPostInScope } from '@/lib/page-access';
import { removePublishedPost } from '@/lib/posts';
import { ok, route } from '@/lib/api';

/** Take a published post down from the Facebook Pages it went to. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);
  return ok(await removePublishedPost({ workspaceId: auth.workspace.id, userId: auth.user.id, role: auth.role }, id));
});
