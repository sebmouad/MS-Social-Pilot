import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireAuth } from '@/lib/auth';
import { connectAccount } from '@/lib/accounts';
import { canManageAccounts } from '@/lib/constants';
import { env } from '@/lib/env';
import { errors } from '@/lib/errors';
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  verifyOAuthState,
  OAUTH_NONCE_COOKIE,
} from '@/lib/facebook/oauth';
import { asGraphError } from '@/lib/facebook/graph';

/**
 * Facebook Login callback.
 *
 * Always redirects back to /accounts with a human-readable message rather than
 * rendering JSON — this URL is reached by a browser navigation, not by fetch.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const accounts = new URL('/connections', env.appUrl);

  const store = await cookies();
  const nonce = store.get(OAUTH_NONCE_COOKIE)?.value;
  store.delete(OAUTH_NONCE_COOKIE);

  // The user pressed "Cancel" in the Facebook dialog.
  const errorReason = url.searchParams.get('error');
  if (errorReason) {
    accounts.searchParams.set(
      'error',
      url.searchParams.get('error_description') ?? 'Facebook connection was cancelled.',
    );
    return NextResponse.redirect(accounts);
  }

  try {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      throw new Error('Facebook did not return an authorization code.');
    }
    const binding = nonce ? verifyOAuthState(state, nonce) : null;
    if (!binding) {
      throw new Error('This connection request expired or could not be verified. Please try again.');
    }

    // Resolve the workspace the connection was started in, not whichever one
    // is active now, and then insist it is still the same person with the
    // same right to connect. A membership removed or demoted while the dialog
    // was open must not finish the connection it could no longer start.
    const auth = await requireAuth(binding.workspaceId);
    if (auth.user.id !== binding.userId || auth.workspace.id !== binding.workspaceId) {
      throw new Error('This connection request expired or could not be verified. Please try again.');
    }
    if (!canManageAccounts(auth.role)) throw errors.adminsOnlyConnect();

    // Short-lived token first, then immediately upgrade: page tokens derived
    // from a short-lived user token expire in about an hour, which would break
    // every scheduled post the following day.
    const shortLived = await exchangeCodeForToken(code);
    const longLived = await exchangeForLongLivedToken(shortLived.token);

    const { sync } = await connectAccount({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      token: longLived,
    });

    const parts = [`Connected ${sync.pages} page${sync.pages === 1 ? '' : 's'}`];
    if (env.groupsEnabled) parts.push(`${sync.groups} group${sync.groups === 1 ? '' : 's'}`);
    accounts.searchParams.set('connected', parts.join(' and '));
    accounts.searchParams.set('select', '1');
    if (sync.warnings.length > 0) accounts.searchParams.set('warning', sync.warnings[0]!);

    return NextResponse.redirect(accounts);
  } catch (error) {
    console.error('[facebook/callback]', error);
    accounts.searchParams.set('error', asGraphError(error).displayMessage);
    return NextResponse.redirect(accounts);
  }
}
