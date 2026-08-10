import { requireAuth } from '@/lib/auth';
import { retryPost } from '@/lib/posts';
import { ok, route } from '@/lib/api';

/** Queue failed destinations for another attempt. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const retried = await retryPost({ workspaceId: auth.workspace.id, userId: auth.user.id }, id);
  return ok({ retried });
});
