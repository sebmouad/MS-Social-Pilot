import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { DataControls } from './controls';

export const metadata: Metadata = { title: 'Data and privacy' };

export default async function DataSettingsPage() {
  const viewer = await requireViewer({ feature: 'settings/data' });
  return <PageFrame module="settings"><SettingsPage active="settings/data" title="Data and privacy" description={`Export or remove the data stored for ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Export workspace data" detail="Download a ZIP of the current app snapshot and workspace media.">
      <p className={styles['settings-note']}>The database snapshot includes workspace details, member names and emails, connected account metadata, channels, posts, inbox records, stored analytics, and older tables directly owned by this workspace. The manifest lists exported table counts and remaining coverage gaps. Provider credential fields and the instance-wide security audit log are excluded.</p>
      <DataControls workspaceName={viewer.membership.workspace.name} />
    </SettingsPanel>
    <SettingsPanel title="Delete workspace data" detail="Remove the workspace’s content and connected account records from this application.">
      <p className={styles['settings-note']}>This removes workspace-owned database records, stored media, and export files while keeping workspace identity and member access. The ZIP includes directly workspace-owned older tables and stored media; its manifest identifies records outside that boundary. Content already published to social networks remains there, and provider authorization is not revoked.</p>
      <DataControls workspaceName={viewer.membership.workspace.name} destructive />
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
