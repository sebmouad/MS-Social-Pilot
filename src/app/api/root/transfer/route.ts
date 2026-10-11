import { z } from 'zod';

import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { transferRoot } from '@/lib/root';

const schema = z.object({ userId: z.string().min(1), password: z.string().min(1) });

/** Hand root to another account, confirmed with root's password. Root only (404 for everyone else). */
export const POST = route(async (request: Request) => {
  const auth = await requireRootApi();
  const { userId, password } = schema.parse(await readJson(request));
  await transferRoot({ actorId: auth.user.id, toUserId: userId, password });
  return ok({ ok: true });
});
