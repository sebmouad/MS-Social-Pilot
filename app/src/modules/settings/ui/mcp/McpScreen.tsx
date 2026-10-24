import { configOrDefault } from '@/server/config/config-or-default';
import { readSettingsUiCopy } from '@/modules/settings/ui/copy-server';
import { SESSION_ONLY_MCP_FEATURES } from '../../mcp-access/session-policy';
import { listMcpKeys } from '../../mcp-access/server';
import { accountConfirmationCopySchema } from '../../account-confirmation-copy';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canAccessFeature } from '@/server/permissions';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { workspaceMcpFeatureIds } from '@/server/mcp/server';
import { PAGES, MODULES } from '@/lib/product';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { McpKeyManager } from './keys';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { fill } from '@/modules/settings/ui/shell-copy';


export const metadata = { title: 'MCP API keys' };


export default async function McpKeysPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = props?.searchParams ?? Promise.resolve({});
  const viewer = await requireViewer({ feature: 'settings/mcp' });
  const locale = await settingsLocale();
  const uiCopy = await readSettingsUiCopy();
  const t = uiCopy.mcp[locale];
  const isManager = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  if (!isManager) return <PageFrame module="settings"><SettingsPage copy={uiCopy} tab="integrationsAssistants" active="settings/mcp" title={t.title} description={t.description} locale={locale}><SettingsPanel title={t.restricted}><p className={styles['settings-note']}>{t.managersOnly}</p></SettingsPanel></SettingsPage></PageFrame>;
  const instants = await workspaceInstantFormatter(viewer.workspaceId, locale);
  const params = await searchParams;
  const keyOffset = params.keyOffset === undefined ? 0 : Number(params.keyOffset);
  const copy = (await configOrDefault('settings.accountConfirmationCopy', accountConfirmationCopySchema))[locale];
  const [keyPage, maxLifetimeDays] = await Promise.all([
    listMcpKeys({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { offset: keyOffset }),
    runtimeConfig('mcp.keys.maxLifetimeDays') as Promise<number>,
  ]);
  const [maxResources,defaultLifetimeDays] = await Promise.all([runtimeConfig('mcp.keys.maxResourceIds') as Promise<number>,runtimeConfig('mcp.keys.defaultLifetimeDays') as Promise<number>]);
  const connection=await selectedResourceConnectionWhere(viewer.workspaceId,entitledPlatformIds(viewer.entitlements));
  const [channels,adAccounts]=await Promise.all([
    prisma.target.findMany({where:{workspaceId:viewer.workspaceId,enabled:true,socialAccount:{is:connection}},select:{id:true,name:true},orderBy:{name:'asc'},take:maxResources+1}),
    prisma.adAccount.findMany({where:{workspaceId:viewer.workspaceId,enabled:true,socialAccount:{is:connection}},select:{id:true,name:true},orderBy:{name:'asc'},take:maxResources+1}),
  ]);
  const resourcesTruncated=channels.length+adAccounts.length>maxResources;
  const resources=resourcesTruncated?[]:[...channels.map(c=>({...c,kind:'channel' as const})),...adAccounts.map(a=>({...a,kind:'adAccount' as const}))];
  const features = PAGES.filter(feature => !SESSION_ONLY_MCP_FEATURES.has(feature.id) && workspaceMcpFeatureIds().includes(feature.id) && canUseFeature(viewer.entitlements, feature.id)).map(feature => ({ ...feature, name: feature.title, moduleLabel:MODULES.find(module=>module.id===feature.module)?.title??feature.module, canRead: canAccessFeature(viewer.permissions, feature.id, 'read'), canWrite: canAccessFeature(viewer.permissions, feature.id, 'write') })).filter(feature => feature.canRead || feature.canWrite);
  return <PageFrame module="settings"><SettingsPage copy={uiCopy} tab="integrationsAssistants" active="settings/mcp" title={t.title} locale={locale} description={fill(t.issueDescription, { workspace: viewer.membership.workspace.name })}>
    <SettingsPanel title={t.createPanel} detail={t.createDetail}><McpKeyManager locale={locale} features={features} initialKeys={keyPage.keys.map(key => labelInstants({ ...key, expiresAt: key.expiresAt.toISOString(), revokedAt: key.revokedAt?.toISOString() ?? null, createdAt: key.createdAt.toISOString(), lastUsedAt: key.lastUsedAt?.toISOString() ?? null }, { createdAt: 'date', expiresAt: 'date', lastUsedAt: 'dateTime' }, instants))} maxLifetimeDays={maxLifetimeDays} defaultLifetimeDays={defaultLifetimeDays} resources={resources} resourcesTruncated={resourcesTruncated} /></SettingsPanel>
    {(keyOffset > 0 || keyPage.nextOffset !== null) && <nav aria-label={t.title}>
      {keyOffset > 0 && <a href="/settings/integrations">{copy.previous}</a>}
      {keyPage.nextOffset !== null && <a href={`/settings/integrations?keyOffset=${keyPage.nextOffset}`}>{copy.more}</a>}
    </nav>}
    <p className={styles['settings-note']}>{t.footnote}</p>
  </SettingsPage></PageFrame>;
}
