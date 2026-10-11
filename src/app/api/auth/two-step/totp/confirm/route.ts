import { z } from 'zod';

import { completePendingSession, requireTwoStepSetupUser } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { confirmTotp } from '@/lib/two-step';

const schema = z.object({ code: z.string().trim().min(6).max(8) });

/**
 * The first code from the newly scanned app turns two-step on and returns the
 * recovery codes, once. Setting it up right after a password completes that
 * sign-in.
 */
export const POST = route(async (request: Request) => {
  const actor = await requireTwoStepSetupUser();
  const { code } = schema.parse(await readJson(request));
  const recoveryCodes = await confirmTotp(actor.userId, code);
  if (actor.pending === 'enroll') await completePendingSession(actor.sessionId);
  return ok({ recoveryCodes });
});
