import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { disableTwoStep } from '@/lib/two-step';

const schema = z.object({ password: z.string().min(1) });

/** Turn two-step off, with the password; refused when the account must have it. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const { password } = schema.parse(await readJson(request));
  await disableTwoStep(auth.user.id, password);
  return ok({ ok: true });
});
