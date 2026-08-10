import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireAuth, canManageAccounts } from '@/lib/auth';
import { authorizationUrl, createOAuthState, OAUTH_NONCE_COOKIE } from '@/lib/facebook/oauth';
import { env } from '@/lib/env';
import { fail, route } from '@/lib/api';

/**
 * Start Facebook Login.
 *
 * The CSRF nonce is stored in a short-lived, httpOnly cookie and echoed back
 * inside the signed `state`. A callback that cannot produce both is rejected,
 * so an attacker cannot trick a signed-in user into attaching *their* Facebook
 * account to the victim's workspace.
 */
export const GET = route(async () => {
  const auth = await requireAuth();
  if (!canManageAccounts(auth.role)) {
    return fail('Only workspace owners and admins can connect accounts.', 403);
  }

  const { state, nonce } = createOAuthState();

  const store = await cookies();
  store.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(authorizationUrl(state));
});
