import { requireAuth } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { assertPostInScope } from '@/lib/page-access';
import { deletePostRecord } from '@/lib/posts';
import { z } from 'zod';

type Context = { params: Promise<{ id: string }> };

/** Explicit permanent deletion; the ordinary DELETE still means cancel. */
export const POST = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);
  const { deleteRemote } = z.object({ deleteRemote: z.boolean() }).parse(await readJson(request));
  return ok(await deletePostRecord({ workspaceId: auth.workspace.id, userId: auth.user.id, role: auth.role }, id, deleteRemote));
});
