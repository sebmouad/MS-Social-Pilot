import { requireTwoStepSetupUser } from '@/lib/auth';
import { ok, route } from '@/lib/api';
import { passkeyRegistrationOptions } from '@/lib/passkeys';

/** What the browser needs to create a passkey for this account. */
export const POST = route(async () => {
  const actor = await requireTwoStepSetupUser();
  return ok({ options: await passkeyRegistrationOptions(actor) });
});
