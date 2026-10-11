import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { env } from '@/lib/env';
import { errors } from '@/lib/errors';
import { route } from '@/lib/api';
import { isNetworkKey, networkAvailable } from '@/lib/networks';
import { oauthCookie, startNetworkAuth } from '@/lib/networks/connect';

/**
 * Start signing in to another network. `?instance=` names a Mastodon server;
 * `?organizations=1` asks LinkedIn for company Pages too.
 */
export const GET = route(async (request: Request, context: { params: Promise<{ network: string }> }) => {
  const auth = await requireAuth();
  if (!canManageAccounts(auth.role)) throw errors.adminsOnlyConnect();
  const { network } = await context.params;
  if (!isNetworkKey(network) || network === 'bluesky' || !networkAvailable(network)) throw errors.notFound();
  const url = new URL(request.url);

  let started: { url: string; cookie: string };
  try {
    started = await startNetworkAuth(network, {
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      instance: url.searchParams.get('instance') ?? undefined,
      organizations: url.searchParams.get('organizations') === '1',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start the sign-in.';
    return NextResponse.redirect(`${env.appUrl.replace(/\/$/, '')}/connections?network=${network}&error=${encodeURIComponent(message.slice(0, 200))}`);
  }

  const store = await cookies();
  store.set(oauthCookie(network), started.cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: 10 * 60,
  });
  return NextResponse.redirect(started.url);
});
