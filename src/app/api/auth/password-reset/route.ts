import { ok, readJson, route } from '@/lib/api';
import { clientIp } from '@/lib/client-ip';
import { errors } from '@/lib/errors';
import { hit } from '@/lib/rate-limit';
import { requestPasswordReset } from '@/lib/email-tokens';
import { passwordResetRequestSchema } from '@/lib/validation';

const LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };

/**
 * "Forgot your password?" (S3). Always answers the same, whether or not the
 * address has an account. Limited per address (no inbox flooded) and per
 * client (no list of addresses worked through).
 */
export const POST = route(async (request: Request) => {
  const { email } = passwordResetRequestSchema.parse(await readJson(request));
  const client = clientIp(request);
  const attempts = [hit(`reset:address:${email}`, LIMIT), ...(client ? [hit(`reset:client:${client}`, LIMIT)] : [])];
  const blocked = attempts.find((attempt) => !attempt.allowed);
  if (blocked) throw errors.tooManyEmails(Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 60_000)));
  await requestPasswordReset(email);
  return ok({ sent: true });
});
