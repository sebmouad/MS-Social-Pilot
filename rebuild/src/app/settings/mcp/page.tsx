import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canAccessFeature } from '@/server/permissions';
import { canUseFeature } from '@/server/entitlements';
import { PAGES } from '@/lib/product';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { McpKeyManager } from './keys';

export const metadata = { title: 'MCP API keys' };
type KeyRow = { id: string; name: string; tokenPrefix: string; readFeatures: string[]; writeFeatures: string[]; expiresAt: Date; revokedAt: Date | null; createdAt: Date; lastUsedAt: Date | null };

export default async function McpKeysPage() {
  const viewer = await requireViewer({ feature: 'settings/mcp' });
  const isManager = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  if (!isManager) return <PageFrame module="settings"><SettingsPage active="settings/mcp" title="MCP API keys" description="Manage scoped credentials for MCP clients."><SettingsPanel title="Access restricted"><p className={styles['settings-note']}>Only workspace owners and admins can manage MCP API keys.</p></SettingsPanel></SettingsPage></PageFrame>;
  const [keys, maxLifetimeDays] = await Promise.all([
    prisma.$queryRaw<KeyRow[]>`SELECT id, name, "tokenPrefix", "readFeatures", "writeFeatures", "expiresAt", "revokedAt", "createdAt", "lastUsedAt" FROM mcp_api_keys WHERE "workspaceId" = ${viewer.workspaceId} ORDER BY "createdAt" DESC`,
    runtimeConfig('mcp.keys.maxLifetimeDays') as Promise<number>,
  ]);
  const features = PAGES.filter(feature => canUseFeature(viewer.entitlements, feature.id)).map(feature => ({ ...feature, name: feature.title, canRead: canAccessFeature(viewer.permissions, feature.id, 'read'), canWrite: canAccessFeature(viewer.permissions, feature.id, 'write') })).filter(feature => feature.canRead || feature.canWrite);
  return <PageFrame module="settings"><SettingsPage active="settings/mcp" title="MCP API keys" description={`Issue workspace-scoped bearer keys for ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Create a key" detail="The full token appears once and is stored only as a hash."><McpKeyManager features={features} initialKeys={keys.map(key => ({ ...key, expiresAt: key.expiresAt.toISOString(), revokedAt: key.revokedAt?.toISOString() ?? null, createdAt: key.createdAt.toISOString(), lastUsedAt: key.lastUsedAt?.toISOString() ?? null }))} maxLifetimeDays={maxLifetimeDays} /></SettingsPanel>
    <p className={styles['settings-note']}>Bearer keys are fixed to this workspace and inherit your current feature and channel permissions. Keep the token in a secret store. Key lifetime and request limits follow your workspace policy.</p>
  </SettingsPage></PageFrame>;
}
