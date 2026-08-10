import { z } from 'zod';

import { requireAuth, switchWorkspace } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({ workspaceId: z.string().min(1) });

/**
 * Change the active client.
 *
 * `switchWorkspace` verifies membership before switching, so a crafted id
 * cannot move someone into a workspace they do not belong to.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const { workspaceId } = schema.parse(await readJson(request));

  await switchWorkspace(auth.user.id, workspaceId);
  return ok({ ok: true });
});
