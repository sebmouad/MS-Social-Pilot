import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { env } from '@/lib/env';
import { route } from '@/lib/api';
import { logActivity } from '@/lib/scheduler/runner';
import { isNetworkKey, networkOffered } from '@/lib/networks';
import { finishNetworkAuth, oauthCookie, openPendingAuth, saveNetworkAccount } from '@/lib/networks/connect';

/** Back from the network's sign-in: keep the account, then return to Connections saying how it went. */
export const GET = route(async (request: Request, context: { params: Promise<{ network: string }> }) => {
  const auth = await requireAuth();
  const { network } = await context.params;
  const base = `${env.appUrl.replace(/\/$/, '')}/connections`;
  if (!isNetworkKey(network) || network === 'bluesky' || network === 'telegram') return NextResponse.redirect(base);
  const back = (params: Record<string, string>) => NextResponse.redirect(`${base}?${new URLSearchParams({ network, ...params }).toString()}`);

  const url = new URL(request.url);
  const store = await cookies();
  const pending = openPendingAuth(store.get(oauthCookie(network))?.value, url.searchParams.get('state'));
  store.delete(oauthCookie(network));

  const denied = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (denied) return back({ error: denied.slice(0, 200) });
  const code = url.searchParams.get('code');
  // The state has to match the one this browser was sent with, and for this person and workspace.
  if (!pending || !code || pending.userId !== auth.user.id || pending.workspaceId !== auth.workspace.id || !canManageAccounts(auth.role) || !(await networkOffered(auth.workspace.id, network))) {
    return back({ error: 'The sign-in could not be verified. Please try again.' });
  }

  try {
    const connected = await finishNetworkAuth(network, pending, code);
    const saved = await saveNetworkAccount({ workspaceId: auth.workspace.id, key: network, connected });
    await logActivity(auth.workspace.id, 'account.connected', { provider: network, destinations: saved.targets }, auth.user.id);
    return back({ connected: String(saved.targets), select: '1' });
  } catch (error) {
    return back({ error: (error instanceof Error ? error.message : 'The connection failed.').slice(0, 200) });
  }
});
