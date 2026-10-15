import { NextResponse, type NextRequest } from 'next/server';
import { requireViewer } from '@/server/context';
import { configuredFacebookEngine, configuredFacebookOAuth } from '@/server/platforms/facebook';
import { FACEBOOK_OAUTH_STATE_COOKIE, openFacebookOAuthState } from '@/server/connection-oauth-state';
import { persistFacebookDiscovery, recordFacebookConnectionFailure } from '@/server/connection-mutations';
import { FacebookApiError } from '@/platforms/facebook/publishing';
import { platformFor } from '@/server/platforms/registry';
import { FACEBOOK_CONNECTION_CALLBACK_PATH } from '@/platforms/facebook/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const viewer = await requireViewer({ feature: 'settings/connections' });
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return finish(request, 'connect_failed');

  const params = new URL(request.url).searchParams;
  const cookieState = request.cookies.get(FACEBOOK_OAUTH_STATE_COOKIE)?.value;
  const state = params.get('state');
  const pending = openFacebookOAuthState(cookieState, state, viewer.user.id, viewer.workspaceId);
  if (!pending) return finish(request, 'oauth_invalid_state');
  if (!await platformFor('facebook', 'connection')) return finish(request, 'connect_failed');
  if (params.has('error')) return finish(request, 'oauth_cancelled');
  const code = params.get('code');
  if (!code || code.length > 4096) return finish(request, 'connect_failed');

  let stage = 'configuration';
  try {
    const [oauth, engine] = await Promise.all([configuredFacebookOAuth(), configuredFacebookEngine()]);
    const expectedRedirect = new URL(FACEBOOK_CONNECTION_CALLBACK_PATH, request.url).toString();
    if (new URL(oauth.redirectUri).toString() !== expectedRedirect) return finish(request, 'connect_failed');

    stage = 'exchange';
    const shortLived = await engine.exchangeCode({ appId: oauth.appId, appSecret: oauth.appSecret, redirectUri: oauth.redirectUri, code });
    const longLived = await engine.exchangeForLongLivedToken({ accessToken: shortLived.accessToken, appId: oauth.appId, appSecret: oauth.appSecret });
    stage = 'discovery';
    const [user, pages, adAccounts] = await Promise.all([
      engine.getCurrentUser(longLived.accessToken),
      engine.discoverPages(longLived.accessToken),
      engine.discoverAdAccounts(longLived.accessToken),
    ]);
    const result = await persistFacebookDiscovery({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      user, accessToken: longLived.accessToken, expiresAt: longLived.expiresAt,
      scopes: pending.scopes, pages, adAccounts,
    });
    return finish(request, result.skippedPages || result.skippedAdAccounts ? 'connected_partial' : 'connected', true);
  } catch (error) {
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    await recordFacebookConnectionFailure(actor, stage, error instanceof FacebookApiError ? 'provider_error' : 'internal_error');
    // The audit stores only a stage/category. Provider messages and credentials stay server-side.
    return finish(request, 'connect_failed');
  }
}

function finish(request: NextRequest, notice: string, openSelection = false) {
  const location = new URL(`/settings/connections?notice=${encodeURIComponent(notice)}${openSelection ? '&select=1' : ''}`, request.url);
  const response = NextResponse.redirect(location, { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, '', {
    httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'lax',
    path: FACEBOOK_CONNECTION_CALLBACK_PATH, maxAge: 0,
  });
  return response;
}
