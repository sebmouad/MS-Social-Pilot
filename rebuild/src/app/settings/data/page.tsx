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
      <p className={styles['settings-note']}>This removes rows represented by the rebuild data-control schema: posts and destination links, connected accounts, inbox conversations and comments, and stored page and ad metrics. Workspace identity and member access remain. The compatibility schema does not cover every legacy table, so this is not a complete database erasure. It does not delete content already published to social networks or revoke provider authorization. Export a copy first if you may need this data.</p>
      <DataControls workspaceName={viewer.membership.workspace.name} destructive />
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
