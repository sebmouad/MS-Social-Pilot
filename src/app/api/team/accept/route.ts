import { z } from 'zod';

import { requireAuth, setActiveWorkspaceCookie } from '@/lib/auth';
import { acceptInvitation } from '@/lib/team';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({ token: z.string().min(1) });

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const { token } = schema.parse(await readJson(request));

  const workspaceId = await acceptInvitation(token, auth.user.id);
  // Land the user in the workspace they just joined, not their previous one.
  await setActiveWorkspaceCookie(workspaceId);

  return ok({ workspaceId });
});
