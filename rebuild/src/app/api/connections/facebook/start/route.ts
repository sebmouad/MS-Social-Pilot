import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { runtimeConfig } from '@/server/config/store';
import { configuredFacebookEngine, configuredFacebookOAuth } from '@/server/platforms/facebook';
import { createFacebookOAuthState, FACEBOOK_OAUTH_STATE_COOKIE } from '@/server/connection-oauth-state';
import { recordFacebookConnectionFailure } from '@/server/connection-mutations';
import { platformFor } from '@/server/platforms/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const CALLBACK_PATH = '/api/connections/facebook/callback';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/connections' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  if (!await platformFor('facebook', 'connection')) return NextResponse.json({ error: 'This connection is unavailable.' }, { status: 404 });

  try {
    const [oauth, engine, adsReadScopes, adsManageScopes, adsManagementEnabled, stateMinutes] = await Promise.all([
      configuredFacebookOAuth(), configuredFacebookEngine(),
      runtimeConfig('meta.adsReadScopes') as Promise<string[]>,
      runtimeConfig('meta.adsManageScopes') as Promise<string[]>,
      runtimeConfig('ads.managementEnabled') as Promise<boolean>,
      runtimeConfig('meta.oauthStateMinutes') as Promise<number>,
    ]);
    const expectedRedirect = new URL(CALLBACK_PATH, request.url).toString();
    if (new URL(oauth.redirectUri).toString() !== expectedRedirect) {
      await recordFacebookConnectionFailure({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'configuration', 'internal_error');
      return NextResponse.json({ error: 'Connection unavailable. Try again or contact support.' }, { status: 503 });
    }
    const scopes = [...new Set([...oauth.scopes, ...adsReadScopes, ...(adsManagementEnabled ? adsManageScopes : [])])];
    const stateTtlSeconds = stateMinutes * 60;
    const pending = createFacebookOAuthState(viewer.user.id, viewer.workspaceId, scopes, stateTtlSeconds);
    if (pending.cookieValue.length > 3000) {
      await recordFacebookConnectionFailure({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'state', 'internal_error');
      return NextResponse.json({ error: 'Connection unavailable. Try again or contact support.' }, { status: 503 });
    }
    const authorizationUrl = engine.getAuthorizationUrl({ appId: oauth.appId, redirectUri: oauth.redirectUri, state: pending.state, scopes });
    const response = NextResponse.json({ authorizationUrl }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, pending.cookieValue, {
      httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'lax',
      path: CALLBACK_PATH, maxAge: stateTtlSeconds,
    });
    return response;
  } catch {
    await recordFacebookConnectionFailure({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'configuration_or_start', 'internal_error');
    return NextResponse.json({ error: 'Connection unavailable. Try again or contact support.' }, { status: 503 });
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
