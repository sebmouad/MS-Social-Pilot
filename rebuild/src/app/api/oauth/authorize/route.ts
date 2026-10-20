import { OperationError } from '@/lib/operation-error';
import { oauthFailure, oauthJson } from '@/modules/integrations/oauth/http';
import { authorizeParamsSchema, OAuthError, redirectRegistered, sameOrigin } from '@/modules/integrations/oauth/protocol';
import { createAuthorizationCode, findClient, recordDenied, requireOAuth, type OAuthResourceScope } from '@/modules/integrations/oauth/server';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { workspaceMcpFeatureIds } from '@/server/mcp/server';
import { canAccessFeature } from '@/server/permissions';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FORM_BYTES = 65536;
const NO_REFERRER = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

function back(redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, value);
  return new Response(null, { status: 303, headers: { ...NO_REFERRER, location: url.toString() } });
}

/**
 * The consent screen's answer. Everything is decided here, not in the form: same origin, a signed-in owner/admin who may
 * manage MCP keys, the form's workspace being the viewer's current one, an exact registered redirect, and a feature and
 * channel choice that cannot exceed the person's own access. No redirect happens to an address that is not registered.
 */
export async function POST(request: Request) {
  try {
    const rt = await requireOAuth();
    // CSRF: a cross-site form post carries a foreign (or null) Origin; browsers always send Origin on POST.
    if (!sameOrigin(request.headers, request.url, rt.issuer)) return oauthJson({ error: 'access_denied', error_description: 'Cross-origin request denied.' }, 403);
    let viewer: Awaited<ReturnType<typeof requireViewer>>;
    try { viewer = await requireViewer({ feature: 'settings/mcp', write: true }); } catch (error) {
      const digest = (error as { digest?: unknown } | null)?.digest;
      if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return oauthJson({ error: 'access_denied', error_description: 'Sign in with a workspace account that can manage MCP keys.' }, digest.includes('/sign-in') ? 401 : 403);
      throw error;
    }
    if (!['owner', 'admin'].includes(viewer.membership.role)) return oauthJson({ error: 'access_denied', error_description: 'Only workspace owners and admins can connect MCP clients.' }, 403);
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_FORM_BYTES) throw new OAuthError('invalid_request', 'The request is too large.');
    const form = await request.formData();
    const one = (name: string) => { const all = form.getAll(name); return all.length === 1 && typeof all[0] === 'string' ? all[0] : ''; };
    const many = (name: string) => form.getAll(name).filter((value): value is string => typeof value === 'string').slice(0, 2000);

    const params = authorizeParamsSchema.safeParse({
      client_id: one('client_id'), redirect_uri: one('redirect_uri'), response_type: one('response_type'), code_challenge: one('code_challenge'),
      code_challenge_method: one('code_challenge_method'), state: one('state') || undefined, scope: one('scope') || undefined,
    });
    const client = params.success ? await findClient(params.data.client_id) : null;
    // Unknown client or unregistered redirect: never redirect anywhere.
    if (!params.success || !client || !redirectRegistered(client.redirectUris, params.data.redirect_uri)) throw new OAuthError('invalid_request', 'Unknown client or redirect address.');
    // Cross-workspace: the decision is for the workspace the person was shown, which must still be their current one.
    if (one('workspace_id') !== viewer.workspaceId) return oauthJson({ error: 'access_denied', error_description: 'The workspace changed. Start the connection again.' }, 403);

    const common = { state: params.data.state, iss: rt.issuer };
    if (one('decision') !== 'allow') {
      await recordDenied({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, client.id);
      return back(params.data.redirect_uri, { ...common, error: 'access_denied' });
    }

    const allowed = new Set(workspaceMcpFeatureIds());
    const readFeatures = [...new Set(many('read'))];
    const writeFeatures = [...new Set(many('write'))];
    const permitted = (feature: string, level: 'read' | 'write') => allowed.has(feature) && canUseFeature(viewer.entitlements, feature) && canAccessFeature(viewer.permissions, feature, level);
    if (!readFeatures.length || readFeatures.some(feature => !permitted(feature, 'read')) || writeFeatures.some(feature => !readFeatures.includes(feature) || !permitted(feature, 'write'))) {
      throw new OAuthError('invalid_request', 'Choose features you can use. Allowing changes requires allowing reading.');
    }

    let resourceScope: OAuthResourceScope;
    if (one('mode') === 'all') {
      if (!viewer.permissions.pageScope.all) throw new OAuthError('invalid_request', 'Your own access is limited to selected channels, so choose them explicitly.');
      resourceScope = { version: 1, mode: 'all' };
    } else {
      const ids = [...new Set(many('target'))];
      const adAccountIds = [...new Set(many('adAccount'))];
      if (!ids.length && !adAccountIds.length) throw new OAuthError('invalid_request', 'Choose at least one channel or ad account, or allow all.');
      const channelScope = viewer.permissions.pageScope;
      if (!channelScope.all && (ids.some(id => !channelScope.ids.includes(id)) || adAccountIds.length)) throw new OAuthError('invalid_request', 'Choose only channels you can access.');
      const connection = await selectedResourceConnectionWhere(viewer.workspaceId, entitledPlatformIds(viewer.entitlements));
      const [targets, accounts] = await Promise.all([
        ids.length ? prisma.target.findMany({ where: { id: { in: ids }, workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: connection } }, select: { id: true } }) : [],
        adAccountIds.length ? prisma.adAccount.findMany({ where: { id: { in: adAccountIds }, workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: connection } }, select: { id: true } }) : [],
      ]);
      if (targets.length !== ids.length || accounts.length !== adAccountIds.length) throw new OAuthError('invalid_request', 'Choose only channels and ad accounts selected in this workspace.');
      resourceScope = { version: 1, mode: 'selected', ids, adAccountIds };
    }

    const { code } = await createAuthorizationCode({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      clientId: client.id, redirectUri: params.data.redirect_uri, codeChallenge: params.data.code_challenge, readFeatures, writeFeatures, resourceScope,
    });
    return back(params.data.redirect_uri, { ...common, code });
  } catch (error) {
    if (error instanceof OperationError) return oauthJson({ error: 'access_denied', error_description: error.message }, 403);
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return oauthJson({ error: 'access_denied', error_description: 'Sign in again.' }, 401);
    return oauthFailure(error);
  }
}
