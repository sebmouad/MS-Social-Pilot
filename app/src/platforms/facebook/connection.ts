import { NextResponse, type NextRequest } from 'next/server';
import { FACEBOOK_CONNECTION_CALLBACK_PATH } from '@/platforms/facebook/protocol';
import { FacebookApiError } from '@/platforms/facebook/publishing';
import { createFacebookOAuthState, FACEBOOK_OAUTH_STATE_COOKIE, openFacebookOAuthState } from '@/platforms/facebook/oauth-state';
import { persistFacebookDiscovery, recordFacebookConnectionFailure } from './discovery';
import { runtimeConfig } from '@/server/config/store';
import { requestOrigin } from '@/server/request-origin';
import { assertWorkspaceNotPurging, withWorkspaceOperation } from '@/server/data-control/guard';
import { configuredFacebookEngine, configuredFacebookOAuth } from './runtime';
import type { ConnectionViewer } from '@/server/platforms/host';
import { configuredInstagramPolicy } from '@/platforms/instagram/runtime';
import { discoverSelectedInstagramAccounts } from '@/platforms/instagram/connection';
import { prisma } from '@/server/data';

/**
 * Facebook's connection flow: start the Meta authorization and finish it on the
 * callback. The generic routes under /api/connections/[platform]/ check the
 * viewer, the role and that the module is on, then hand over to these.
 */
/**
 * Permissions Meta grants only together with others (developers.facebook.com/docs/permissions, 2026-11): asking for one
 * without the ones it depends on leaves the dependent one unusable and fails App Review, so the dependencies are added.
 */
const META_SCOPE_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  pages_read_engagement: ['pages_show_list'], pages_read_user_content: ['pages_show_list'], pages_manage_metadata: ['pages_show_list'],
  pages_manage_posts: ['pages_read_engagement', 'pages_show_list'], read_insights: ['pages_read_engagement', 'pages_show_list'],
  pages_messaging: ['pages_manage_metadata', 'pages_show_list'], pages_manage_engagement: ['pages_read_user_content', 'pages_show_list'],
  instagram_basic: ['pages_read_user_content', 'pages_show_list'], instagram_content_publish: ['instagram_basic', 'pages_read_engagement', 'pages_show_list'],
  instagram_manage_comments: ['instagram_basic', 'pages_read_engagement', 'pages_show_list'], instagram_manage_insights: ['instagram_basic', 'pages_read_engagement', 'pages_show_list'],
  ads_management: ['pages_read_engagement', 'pages_show_list'],
};

/** The requested scopes with every dependency, each once, in a stable order. */
export function withScopeDependencies(scopes: readonly string[]): string[] {
  const out = new Set<string>();
  const add = (scope: string) => { if (out.has(scope)) return; out.add(scope); (META_SCOPE_DEPENDENCIES[scope] ?? []).forEach(add); };
  scopes.map(scope => scope.trim()).filter(Boolean).forEach(add);
  return [...out];
}

export async function startFacebookConnection(request: Request, viewer: ConnectionViewer): Promise<NextResponse> {
  try {
    await assertWorkspaceNotPurging(viewer.workspaceId);
    const [oauth, engine, postReadScopes, insightReadScopes, adsReadScopes, adsManageScopes, adsManagementEnabled, stateMinutes, featureScopes, instagramScopes, configId] = await Promise.all([
      configuredFacebookOAuth(), configuredFacebookEngine(),
      runtimeConfig('meta.postReadScopes') as Promise<string[]>,
      runtimeConfig('meta.pageInsightReadScopes') as Promise<string[]>,
      runtimeConfig('meta.adsReadScopes') as Promise<string[]>,
      runtimeConfig('meta.adsManageScopes') as Promise<string[]>,
      runtimeConfig('ads.managementEnabled') as Promise<boolean>,
      runtimeConfig('meta.oauthStateMinutes') as Promise<number>,
      // Every scope a Facebook feature checks before it runs is asked for here, or the feature reports a missing permission on a fresh connection.
      Promise.all((['meta.postPublishScopes', 'meta.postDeleteScopes', 'meta.firstCommentScopes', 'meta.inboxReadScopes', 'meta.inboxWriteScopes'] as const).map(key => runtimeConfig(key) as Promise<string[]>)).then(lists => lists.flat()),
      // Instagram professional accounts are reached through these Pages, so their scopes come with this authorization when Instagram is on.
      (runtimeConfig('platforms.instagram.enabled') as Promise<boolean>).then(async enabled => {
        if (!enabled) return [];
        const policy = await configuredInstagramPolicy();
        return [...policy.readScopes, ...policy.publishScopes, ...policy.commentScopes, ...policy.insightScopes];
      }),
      runtimeConfig('meta.loginConfigId') as Promise<string>,
    ]);
    const expectedRedirect = new URL(FACEBOOK_CONNECTION_CALLBACK_PATH, requestOrigin(request)).toString();
    if (new URL(oauth.redirectUri).toString() !== expectedRedirect) {
      await recordFacebookConnectionFailure({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'configuration', 'internal_error');
      return NextResponse.json({ error: 'Connection unavailable. Try again or contact support.' }, { status: 503 });
    }
    const scopes = withScopeDependencies([...oauth.scopes, ...postReadScopes, ...insightReadScopes, ...featureScopes, ...instagramScopes, ...adsReadScopes, ...(adsManagementEnabled ? adsManageScopes : [])]);
    const stateTtlSeconds = stateMinutes * 60;
    const pending = createFacebookOAuthState(viewer.user.id, viewer.workspaceId, scopes, stateTtlSeconds);
    if (pending.cookieValue.length > 3000) {
      await recordFacebookConnectionFailure({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'state', 'internal_error');
      return NextResponse.json({ error: 'Connection unavailable. Try again or contact support.' }, { status: 503 });
    }
    const authorizationUrl = engine.getAuthorizationUrl({ appId: oauth.appId, redirectUri: oauth.redirectUri, state: pending.state, scopes, ...(configId ? { configId } : {}) });
    const response = NextResponse.json({ authorizationUrl }, { headers: { 'cache-control': 'no-store' } });
    response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, pending.cookieValue, {
      httpOnly: true, secure: new URL(requestOrigin(request)).protocol === 'https:', sameSite: 'lax',
      path: FACEBOOK_CONNECTION_CALLBACK_PATH, maxAge: stateTtlSeconds,
    });
    return response;
  } catch {
    await recordFacebookConnectionFailure({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'configuration_or_start', 'internal_error');
    return NextResponse.json({ error: 'Connection unavailable. Try again or contact support.' }, { status: 503 });
  }
}

export async function finishFacebookConnection(request: NextRequest, viewer: ConnectionViewer): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const cookieState = request.cookies.get(FACEBOOK_OAUTH_STATE_COOKIE)?.value;
  const state = params.get('state');
  const pending = openFacebookOAuthState(cookieState, state, viewer.user.id, viewer.workspaceId);
  if (!pending) return finish(request, 'oauth_invalid_state');
  if (params.has('error')) return finish(request, 'oauth_cancelled');
  const code = params.get('code');
  if (!code || code.length > 4096) { console.warn('[facebook-connect] callback refused: missing_code'); return finish(request, 'connect_failed'); }

  let stage = 'configuration';
  try {
    return await withWorkspaceOperation(viewer.workspaceId, async () => {
      const [oauth, engine] = await Promise.all([configuredFacebookOAuth(), configuredFacebookEngine()]);
      const expectedRedirect = new URL(FACEBOOK_CONNECTION_CALLBACK_PATH, requestOrigin(request)).toString();
      if (new URL(oauth.redirectUri).toString() !== expectedRedirect) { console.warn('[facebook-connect] callback refused: redirect_mismatch', { expectedOrigin: new URL(expectedRedirect).origin }); return finish(request, 'connect_failed'); }

      stage = 'exchange';
      const shortLived = await engine.exchangeCode({ appId: oauth.appId, appSecret: oauth.appSecret, redirectUri: oauth.redirectUri, code });
      const longLived = await engine.exchangeForLongLivedToken({ accessToken: shortLived.accessToken, appId: oauth.appId, appSecret: oauth.appSecret });
      stage = 'discovery';
      const [user, grantedScopes, pages, adAccounts] = await Promise.all([
        engine.getCurrentUser(longLived.accessToken),
        engine.getGrantedPermissions(longLived.accessToken),
        engine.discoverPages(longLived.accessToken),
        engine.discoverAdAccounts(longLived.accessToken),
      ]);
      const result = await persistFacebookDiscovery({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
        user, accessToken: longLived.accessToken, expiresAt: longLived.expiresAt,
        scopes: grantedScopes, pages, adAccounts,
      });
      // New comments, posts and messages reach the Inbox through the Page's webhooks; Meta delivers them only once the app is
      // subscribed to each Page, which pages_manage_metadata allows. Polling still covers a Page whose subscription fails.
      stage = 'webhooks';
      if (await runtimeConfig('meta.webhooksEnabled') && grantedScopes.includes('pages_manage_metadata')) {
        const fields = ['feed', ...(grantedScopes.includes('pages_messaging') ? ['messages'] : [])];
        const outcomes = await Promise.allSettled(pages.map(page => engine.subscribePageWebhooks(page, fields)));
        const failed = outcomes.filter(outcome => outcome.status === 'rejected').length;
        if (failed) console.warn('[facebook-connect] page webhook subscription failed', { pages: pages.length, failed });
      }
      // The Instagram accounts linked to these Pages are offered in the same selection, without a second « Connect » step.
      stage = 'instagram';
      if (await runtimeConfig('platforms.instagram.enabled')) {
        const source = await prisma.socialAccount.findUnique({ where: { workspaceId_provider_providerUserId: { workspaceId: viewer.workspaceId, provider: 'facebook', providerUserId: user.id } }, select: { id: true } });
        if (source) await discoverSelectedInstagramAccounts(viewer, { sourceId: source.id }).catch(error => console.warn('[facebook-connect] instagram discovery skipped', { name: error instanceof Error ? error.name : 'unknown' }));
      }
      return finish(request, result.skippedPages || result.skippedAdAccounts ? 'connected_partial' : 'connected', true);
    });
  } catch (error) {
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    console.warn('[facebook-connect] callback failed', { stage, category: error instanceof FacebookApiError ? 'provider_error' : 'internal_error', name: error instanceof Error ? error.name : 'unknown', code: error instanceof FacebookApiError ? error.code : undefined, status: error instanceof FacebookApiError ? error.status : undefined, subcode: error instanceof FacebookApiError ? error.subcode : undefined, message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[url]').replace(/(secret|token|code)=\S+/gi, '$1=[redacted]').slice(0, 300) : undefined, cause: error instanceof Error && error.cause instanceof Error ? error.cause.message.slice(0, 200) : undefined });
    try { await recordFacebookConnectionFailure(actor, stage, error instanceof FacebookApiError ? 'provider_error' : 'internal_error'); } catch { /* audit is best effort */ }
    // The audit stores only a stage/category. Provider messages and credentials stay server-side.
    return finish(request, 'connect_failed');
  }
}

function finish(request: NextRequest, notice: string, openSelection = false) {
  const location = new URL(`/settings/channels?notice=${encodeURIComponent(notice)}${openSelection ? '&select=1' : ''}`, requestOrigin(request));
  const response = NextResponse.redirect(location, { status: 303, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, '', {
    httpOnly: true, secure: new URL(requestOrigin(request)).protocol === 'https:', sameSite: 'lax',
    path: FACEBOOK_CONNECTION_CALLBACK_PATH, maxAge: 0,
  });
  return response;
}
