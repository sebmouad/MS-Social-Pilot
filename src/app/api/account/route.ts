import { currentSessionTokenHash, requireAuth } from '@/lib/auth';
import { readAccount, updateProfile } from '@/lib/account';
import { profileSchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

/** The signed-in person's own account. Nobody else's is reachable from here. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ account: await readAccount(auth.user.id, await currentSessionTokenHash()) });
});

export const PATCH = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = profileSchema.parse(await readJson(request));

  await updateProfile(auth.user.id, input);
  return ok({ account: await readAccount(auth.user.id, await currentSessionTokenHash()) });
});
