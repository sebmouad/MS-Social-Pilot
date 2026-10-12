import { z } from 'zod';

import { GRANTABLE_ROLES, setClientAccess } from '@/lib/agency-access';
import { requireAuth } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';

const schema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(GRANTABLE_ROLES).nullable(),
});

/** Set one team member's role in one of the signed-in owner's clients (null removes it). */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse(await readJson(request));
  await setClientAccess({ ownerId: auth.user.id, ...input });
  return ok({ ok: true });
});
