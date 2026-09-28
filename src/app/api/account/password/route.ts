import { currentSessionTokenHash, requireAuth } from '@/lib/auth';
import { changePassword } from '@/lib/account';
import { env } from '@/lib/env';
import { passwordChangeSchema } from '@/lib/validation';
import { ok, readJson, route } from '@/lib/api';

/** Change your own password. Signs out every other browser; see `changePassword`. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = passwordChangeSchema.parse(await readJson(request));

  const result = await changePassword({
    userId: auth.user.id,
    currentTokenHash: await currentSessionTokenHash(),
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    limit: { limit: env.loginAttempts, windowMs: env.loginWindowMs },
  });

  return ok(result);
});
