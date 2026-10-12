import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { resetPassword } from '@/lib/email-tokens';
import { passwordResetSchema } from '@/lib/validation';

/** The new password from the emailed link (S3); every session ends, so sign in again. */
export const POST = route(async (request: Request) => {
  const { token, password } = passwordResetSchema.parse(await readJson(request));
  if (!(await resetPassword(token, password))) throw errors.resetLinkInvalid();
  return ok({ reset: true });
});
