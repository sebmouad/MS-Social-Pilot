import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { inviteClient } from '@/lib/root';

const schema = z.object({
  email: z.string().trim().email().max(254),
  workspaceName: z.string().trim().max(100).optional(),
});

/** Invite a client to create their own workspace. Root only (404 for everyone else). */
export const POST = route(async (request: Request) => {
  const auth = await requireRootApi();
  const input = schema.parse(await readJson(request));
  return ok(await inviteClient({ actorId: auth.user.id, email: input.email, workspaceName: input.workspaceName ?? null }), 201);
});
