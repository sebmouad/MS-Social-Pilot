import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { listApiTokens } from '@/modules/integrations/server/tokens';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { KeysManager } from './KeysManager';

export const metadata = { title: 'API keys' };

export default async function ApiAccessPage() {
  const viewer = await requireViewer({ feature: 'settings/mcp', channelScoped: true });
  const frame = (body: React.ReactNode) => <PageFrame module="settings"><SettingsPage active="settings/mcp" title="API keys" description={`Let your own tools read or change ${viewer.membership.workspace.name} over the REST API.`}>{body}</SettingsPage></PageFrame>;
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return frame(<SettingsPanel title="Access restricted"><p className={styles['settings-note']}>Only workspace owners and admins can manage API keys.</p></SettingsPanel>);
  let data: Awaited<ReturnType<typeof listApiTokens>> | null = null;
  try { data = await listApiTokens({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch { data = null; }
  if (!data) return frame(<SettingsPanel title="API keys"><p role="alert" className={styles['settings-note']}>API keys could not be loaded. Refresh the page to try again.</p></SettingsPanel>);
  if (!data.available) return frame(<SettingsPanel title="API keys"><p className={styles['settings-note']}>API keys are not available right now.</p></SettingsPanel>);
  const keys = data.tokens.map(token => ({ id: token.id, name: token.name, prefix: token.prefix, scope: token.scope, targetNames: token.targetNames, createdBy: token.createdBy, status: token.status, createdAt: token.createdAt.toISOString(), expiresAt: token.expiresAt?.toISOString() ?? null, lastUsedAt: token.lastUsedAt?.toISOString() ?? null }));
  return frame(<>
    <SettingsPanel title="Create a key" detail="The key appears once and cannot be recovered. Only a fingerprint is stored."><KeysManager initial={keys} channels={data.channels} defaultDays={data.defaultExpiryDays} maxDays={data.maxExpiryDays} canChooseAll={viewer.permissions.pageScope.all} /></SettingsPanel>
    <p className={styles['settings-note']}>Send the key as an Authorization: Bearer header. Keys made through a connected app appear here too and can be revoked at any time.</p>
  </>);
}
