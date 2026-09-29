import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { authorizationUrl, createOAuthState, OAUTH_NONCE_COOKIE } from '@/lib/facebook/oauth';
import { env } from '@/lib/env';
import { route } from '@/lib/api';
import { errors } from '@/lib/errors';

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
    throw errors.adminsOnlyConnect();
  }

  const { state, nonce } = createOAuthState({ workspaceId: auth.workspace.id, userId: auth.user.id });

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
