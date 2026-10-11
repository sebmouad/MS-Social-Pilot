import { z } from 'zod';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

import { completePendingSession, requireTwoStepSetupUser } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { registerPasskey } from '@/lib/passkeys';
import { newRecoveryCodes, recoveryCodesLeft } from '@/lib/two-step';

const schema = z.object({ response: z.record(z.string(), z.unknown()), name: z.string().trim().min(1).max(60) });

/** Save the new passkey. A first second step also gets recovery codes, shown once. */
export const POST = route(async (request: Request) => {
  const actor = await requireTwoStepSetupUser();
  const { response, name } = schema.parse(await readJson(request));
  await registerPasskey({ ...actor, response: response as unknown as RegistrationResponseJSON, name });
  const recoveryCodes = (await recoveryCodesLeft(actor.userId)) === 0 ? await newRecoveryCodes(actor.userId) : [];
  if (actor.pending === 'enroll') await completePendingSession(actor.sessionId);
  return ok({ recoveryCodes });
});
