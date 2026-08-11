import { z } from 'zod';

import { getAuthContext } from '@/lib/auth';
import { isFirstRun, maySetUp, readSetupState } from '@/lib/setup';
import { SettingError, writeSetting } from '@/lib/settings';
import { fail, ok, readJson, route } from '@/lib/api';

/**
 * Setup: what is left to do, and the one thing that cannot be done without it.
 *
 * The Facebook app credentials are writable here because of a genuine
 * chicken-and-egg: they live on the owner-only configuration screen, and on a
 * fresh installation there is no owner yet. So this route is open *only* while
 * the database holds no accounts, and is owner-only from the first registration
 * onwards. `maySetUp` is that rule, in one place, with tests on it.
 */
const schema = z.object({
  facebookAppId: z.string().trim().min(1, 'Enter the app ID from your Meta app.'),
  facebookAppSecret: z.string().trim().min(1, 'Enter the app secret from your Meta app.'),
});

export const GET = route(async () => {
  const auth = await getAuthContext();
  const firstRun = await isFirstRun();
  if (!maySetUp(auth, firstRun)) return fail('Only an owner can view setup.', 403);

  return ok(await readSetupState(auth?.workspace.id ?? null));
});

export const POST = route(async (request: Request) => {
  const auth = await getAuthContext();
  const firstRun = await isFirstRun();
  if (!maySetUp(auth, firstRun)) return fail('Only an owner can change setup.', 403);

  const input = schema.parse(await readJson(request));

  try {
    await writeSetting('facebook.appId', input.facebookAppId, auth?.user.id ?? null);
    await writeSetting('facebook.appSecret', input.facebookAppSecret, auth?.user.id ?? null);
  } catch (error) {
    if (error instanceof SettingError) return fail(error.message, 422);
    throw error;
  }

  return ok(await readSetupState(auth?.workspace.id ?? null));
});
