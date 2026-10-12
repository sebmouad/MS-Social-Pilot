import { NextResponse } from 'next/server';

import { AuthError, getAuthContext } from '@/lib/auth';
import { env } from '@/lib/env';
import { errors } from '@/lib/errors';
import { ok, route } from '@/lib/api';
import { hit } from '@/lib/rate-limit';
import { sendVerificationEmail, verifyEmail } from '@/lib/email-tokens';

/** Links sent per account per hour: enough for "it went to spam", not a mail cannon. */
const RESEND_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };

/** The link in the email (S3): proves the address, then opens the app. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const done = await verifyEmail(token);
  return NextResponse.redirect(new URL(done ? '/dashboard' : '/verify-email?failed=1', env.appUrl), 303);
}

/** "Send the link again", for the signed-in person who has not confirmed yet. */
export const POST = route(async () => {
  const auth = await getAuthContext();
  if (!auth) throw new AuthError('You must be signed in.');
  if (auth.user.emailVerified) return ok({ sent: false });
  const attempt = hit(`verify:user:${auth.user.id}`, RESEND_LIMIT);
  if (!attempt.allowed) throw errors.tooManyEmails(Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 60_000)));
  await sendVerificationEmail(auth.user.id);
  return ok({ sent: true });
});
