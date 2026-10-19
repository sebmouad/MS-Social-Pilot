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

export const metadata = { title: 'MCP API keys' };
type KeyRow = { id: string; name: string; tokenPrefix: string; readFeatures: string[]; writeFeatures: string[]; resourceScope: {mode:string;ids?:string[];adAccountIds?:string[]}|null; expiresAt: Date; revokedAt: Date | null; createdAt: Date; lastUsedAt: Date | null };

export default async function McpKeysPage() {
  const viewer = await requireViewer({ feature: 'settings/mcp' });
  const isManager = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  if (!isManager) return <PageFrame module="settings"><SettingsPage active="settings/mcp" title="MCP API keys" description="Manage scoped credentials for MCP clients."><SettingsPanel title="Access restricted"><p className={styles['settings-note']}>Only workspace owners and admins can manage MCP API keys.</p></SettingsPanel></SettingsPage></PageFrame>;
  const [keys, maxLifetimeDays] = await Promise.all([
    prisma.$queryRaw<KeyRow[]>`SELECT id, name, "tokenPrefix", "readFeatures", "writeFeatures", "resourceScope", "expiresAt", "revokedAt", "createdAt", "lastUsedAt" FROM mcp_api_keys WHERE "workspaceId" = ${viewer.workspaceId} ORDER BY "createdAt" DESC`,
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
  const features = PAGES.filter(feature => workspaceMcpFeatureIds().includes(feature.id) && canUseFeature(viewer.entitlements, feature.id)).map(feature => ({ ...feature, name: feature.title, moduleLabel:MODULES.find(module=>module.id===feature.module)?.title??feature.module, canRead: canAccessFeature(viewer.permissions, feature.id, 'read'), canWrite: canAccessFeature(viewer.permissions, feature.id, 'write') })).filter(feature => feature.canRead || feature.canWrite);
  return <PageFrame module="settings"><SettingsPage active="settings/mcp" title="MCP API keys" description={`Issue workspace-scoped bearer keys for ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Create a key" detail="The full token appears once and is stored only as a hash."><McpKeyManager features={features} initialKeys={keys.map(key => ({ ...key, expiresAt: key.expiresAt.toISOString(), revokedAt: key.revokedAt?.toISOString() ?? null, createdAt: key.createdAt.toISOString(), lastUsedAt: key.lastUsedAt?.toISOString() ?? null }))} maxLifetimeDays={maxLifetimeDays} defaultLifetimeDays={defaultLifetimeDays} resources={resources} resourcesTruncated={resourcesTruncated} /></SettingsPanel>
    <p className={styles['settings-note']}>Bearer keys are fixed to this workspace and inherit your current permissions, further limited by their selected channels and ad accounts. Keep the token in a secret store. Key lifetime and request limits follow your workspace policy.</p>
  </SettingsPage></PageFrame>;
}
