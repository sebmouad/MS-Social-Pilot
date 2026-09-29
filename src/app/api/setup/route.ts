import { z } from 'zod';

import { getAuthContext } from '@/lib/auth';
import { isFirstRun, mayChangeSetup, maySetUp, readSetupState } from '@/lib/setup';
import { SettingError, writeSetting } from '@/lib/settings';
import { fail, ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/**
 * Setup: what is left to do, and the one thing that cannot be done without it.
 *
 * The Facebook app credentials are writable here as well as on the
 * configuration screen, because this is where a new installation is walked
 * through. Reading is open while the database holds no accounts — somebody has
 * to see the first step to take it — but writing is the installation owner's
 * alone from the start: the form only appears once that account exists.
 * `maySetUp` and `mayChangeSetup` are those rules, in one place, with tests.
 */
const schema = z.object({
  facebookAppId: z.string().trim().min(1, 'Enter the app ID from your Meta app.'),
  facebookAppSecret: z.string().trim().min(1, 'Enter the app secret from your Meta app.'),
});

export const GET = route(async () => {
  const auth = await getAuthContext();
  const firstRun = await isFirstRun();
  if (!maySetUp(auth, firstRun)) throw errors.ownerOnlyViewSetup();

  return ok(await readSetupState(auth?.workspace.id ?? null));
});

export const POST = route(async (request: Request) => {
  const auth = await getAuthContext();
  if (!auth || !mayChangeSetup(auth)) throw errors.ownerOnlyChangeSetup();

  const input = schema.parse(await readJson(request));

  try {
    await writeSetting('facebook.appId', input.facebookAppId, auth.user.id);
    await writeSetting('facebook.appSecret', input.facebookAppSecret, auth.user.id);
  } catch (error) {
    if (error instanceof SettingError) return fail(error.message, 422);
    throw error;
  }

  return ok(await readSetupState(auth.workspace.id));
});
