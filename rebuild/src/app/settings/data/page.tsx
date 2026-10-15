import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { DataControls } from './controls';

export const metadata: Metadata = { title: 'Data and privacy' };

export default async function DataSettingsPage() {
  const viewer = await requireViewer({ feature: 'settings/data' });
  return <PageFrame module="settings"><SettingsPage active="settings/data" title="Data and privacy" description={`Export or remove the data stored for ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Export workspace data" detail="Download a portable JSON copy of the content represented by this app build.">
      <p className={styles['settings-note']}>The export includes workspace details, member names and emails, connected account metadata, channels, posts, inbox records, and stored analytics. Provider access credentials and the instance-wide security audit log are excluded.</p>
      <DataControls workspaceName={viewer.membership.workspace.name} />
    </SettingsPanel>
    <SettingsPanel title="Delete workspace data" detail="Remove the workspace’s content and connected account records from this application.">
      <p className={styles['settings-note']}>This removes workspace-owned database records, stored media, and export files while keeping workspace identity and member access. The JSON download above covers core records only; older feature records and file bytes may not be in it. Content already published to social networks remains there, and provider authorization is not revoked.</p>
      <DataControls workspaceName={viewer.membership.workspace.name} destructive />
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
