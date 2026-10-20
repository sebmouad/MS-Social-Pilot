import { cookies, headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash, prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { workspaceMcpFeatureIds } from '@/server/mcp/server';
import { canAccessFeature } from '@/server/permissions';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { PAGES } from '@/lib/product';
import { SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { oauthCopyFor, oauthLocale, oauthText } from '../copy';
import { authorizeParamsSchema, redirectRegistered } from '../protocol';
import { findClient, oauthRuntime } from '../server';
import { ConsentForm } from './ConsentForm';

async function hasSession() {
  const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
  const hash = token ? hashLegacySessionToken(token) : null;
  if (!hash) return false;
  return isUsableLegacySession(await getSessionByTokenHash(hash), undefined);
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * The consent screen an MCP client sends a signed-in person to. Client and redirect are checked before anything is
 * shown, and an invalid request never redirects. The decision itself is validated again by POST /api/oauth/authorize.
 */
export async function AuthorizeScreen({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const locale = oauthLocale((await headers()).get('accept-language'));
  const t = (key: Parameters<typeof oauthText>[1], vars?: Record<string, string | number>) => oauthText(locale, key, vars);
  const bare = (title: string, body: string, alert = false) => <main className="route-state"><h1>{title}</h1><p role={alert ? 'alert' : undefined}>{body}</p></main>;

  const rt = await oauthRuntime().catch(() => null);
  if (!rt?.enabled || !rt.issuer) return bare(t('title', { client: 'MCP' }), t('unavailable'));

  const params = authorizeParamsSchema.safeParse({
    client_id: first(searchParams.client_id), redirect_uri: first(searchParams.redirect_uri), response_type: first(searchParams.response_type),
    code_challenge: first(searchParams.code_challenge), code_challenge_method: first(searchParams.code_challenge_method),
    state: first(searchParams.state) || undefined, scope: first(searchParams.scope) || undefined,
  });
  const client = params.success ? await findClient(params.data.client_id) : null;
  if (!params.success || !client || !redirectRegistered(client.redirectUris, params.data.redirect_uri)) return bare(t('title', { client: 'MCP' }), t('invalid'), true);

  if (!await hasSession()) {
    // The sign-in screen does not keep a return address, so the person reopens this link from the app afterwards.
    return <main className="route-state"><h1>{t('signInNeeded')}</h1><p>{t('signInBody', { client: client.name })}</p><p><a href="/sign-in">{t('signIn')}</a></p></main>;
  }
  const viewer = await requireViewer({ feature: 'settings/mcp', write: true });
  if (!['owner', 'admin'].includes(viewer.membership.role)) return bare(t('title', { client: client.name }), t('restricted'));

  const workspace = viewer.membership.workspace.name;
  const allowed = new Set(workspaceMcpFeatureIds());
  const features = PAGES.filter(page => allowed.has(page.id) && canUseFeature(viewer.entitlements, page.id) && canAccessFeature(viewer.permissions, page.id, 'read'))
    .map(page => ({ id: page.id, name: page.title, canWrite: canAccessFeature(viewer.permissions, page.id, 'write') }));
  const limit = Number(await runtimeConfig('mcp.keys.maxResourceIds')) || 1000;
  const connection = await selectedResourceConnectionWhere(viewer.workspaceId, entitledPlatformIds(viewer.entitlements));
  const channelScope = viewer.permissions.pageScope;
  const [channels, adAccounts] = await Promise.all([
    prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: connection }, ...(channelScope.all ? {} : { id: { in: [...channelScope.ids] } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: limit + 1 }),
    channelScope.all ? prisma.adAccount.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: connection } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: limit + 1 }) : Promise.resolve([]),
  ]);
  const truncated = channels.length + adAccounts.length > limit;
  const asksWrite = (params.data.scope ?? '').split(/\s+/).includes('write');
  const host = new URL(params.data.redirect_uri).host;

  return <PageFrame module="settings">
    <div className={styles['settings-page']}>
      <header className={styles['settings-heading']}><div><p className={styles['settings-eyebrow']}>{t('eyebrow')}</p><h1>{t('title', { client: client.name })}</h1><p>{t('description', { client: client.name, workspace })}</p></div></header>
      <SettingsPanel title={client.name} detail={t('sends', { host, client: client.name })}>{asksWrite ? <p className={styles['settings-note']}>{t('writeRequested', { client: client.name })}</p> : null}</SettingsPanel>
      <ConsentForm copy={oauthCopyFor(locale)} client={client.name} workspace={workspace} features={features} canAll={channelScope.all} truncated={truncated}
        channels={truncated ? [] : channels} adAccounts={truncated ? [] : adAccounts}
        hidden={{ client_id: client.id, redirect_uri: params.data.redirect_uri, response_type: 'code', code_challenge: params.data.code_challenge, code_challenge_method: 'S256', state: params.data.state ?? '', scope: params.data.scope ?? '', workspace_id: viewer.workspaceId }} />
    </div>
  </PageFrame>;
}
