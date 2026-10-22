import { readSettingsUiCopy } from '@/modules/settings/ui/copy-server';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readWorkspacePolicy } from '@/modules/settings/server/workspace-policy';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { fill } from '@/modules/settings/ui/shell-copy';
import { WorkspacePolicyForm } from './policy-form';
import { readWorkspaceOperations } from '@/modules/settings/server/workspace-operations';

import { WorkspaceOperationsForm } from './operations-form';
import { BestTimeApplyCard } from './best-time-apply-card';


export const metadata: Metadata = { title: 'Workspace policies' };
export default async function WorkspacePolicyPage() {
  const viewer = await requireViewer({ feature: 'settings/workspace' });
  const locale = await settingsLocale();
  const uiCopy = await readSettingsUiCopy();
  const t = uiCopy.workspace[locale];
  let value: Awaited<ReturnType<typeof readWorkspacePolicy>> | null = null;
  let error = '';
  try { value = await readWorkspacePolicy({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch { error = t.unavailable; }
  let operations: Awaited<ReturnType<typeof readWorkspaceOperations>> | null = null;
  try { operations = await readWorkspaceOperations({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch { operations = null; }
  const copy = uiCopy.operations[locale];
  return <PageFrame module="settings"><SettingsPage copy={uiCopy} active="settings/workspace" title={t.title} locale={locale} description={fill(t.description, { workspace: viewer.membership.workspace.name })}>
    <SettingsPanel title={t.zonePanel} detail={t.zoneDetail}>
      {error ? <p className={styles['settings-note']} role="alert">{error}</p> : value && <WorkspacePolicyForm key={viewer.workspaceId} locale={locale} workspaceName={viewer.membership.workspace.name} workspaceId={viewer.workspaceId} timezone={value.timezone} requiresApproval={value.requiresApproval} maxTimezoneCharacters={value.maxTimezoneCharacters} />}
    </SettingsPanel>
    <p className={styles['settings-note']}>{t.approvalNote}</p>
    <SettingsPanel title={copy.panelTitle} detail={copy.panelLiveDetail}>
      {operations ? <WorkspaceOperationsForm key={viewer.workspaceId} locale={locale} workspaceName={viewer.membership.workspace.name} workspaceId={viewer.workspaceId} initial={operations.settings} /> : <p className={styles['settings-note']} role="alert">{copy.unavailable}</p>}
      {['owner', 'admin'].includes(viewer.membership.role) && operations ? <BestTimeApplyCard locale={locale} /> : null}
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
