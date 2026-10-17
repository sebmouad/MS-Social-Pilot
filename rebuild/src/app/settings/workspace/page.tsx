import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readWorkspacePolicy } from '@/modules/settings/server/workspace-policy';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { WorkspacePolicyForm } from './policy-form';

export const metadata: Metadata = { title: 'Workspace policies' };
export default async function WorkspacePolicyPage() {
  const viewer = await requireViewer({ feature: 'settings/workspace' });
  let value: Awaited<ReturnType<typeof readWorkspacePolicy>> | null = null;
  let error = '';
  try { value = await readWorkspacePolicy({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch { error = 'Workspace policies are unavailable. Refresh the page or try again later.'; }
  return <PageFrame module="settings"><SettingsPage active="settings/workspace" title="Workspace policies" description={`Set the publishing time zone and review requirement for ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Publishing time zone" detail="Used to display and schedule publishing times across this workspace.">
      {error ? <p className={styles['settings-note']} role="alert">{error}</p> : value && <WorkspacePolicyForm key={viewer.workspaceId} workspaceId={viewer.workspaceId} timezone={value.timezone} requiresApproval={value.requiresApproval} maxTimezoneCharacters={value.maxTimezoneCharacters} />}
    </SettingsPanel>
    <p className={styles['settings-note']}>When approval is required, new scheduled posts from contributors wait in review. Owners, admins, and editors keep their publishing bypass. Editing an approved post clears its previous review so contributors must obtain approval for the changed content and destinations.</p>
  </SettingsPage></PageFrame>;
}
