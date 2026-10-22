import { readSectionsCopy, readSettingsUiCopy } from '@/modules/settings/ui/copy-server';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readWorkspacePolicy } from '@/modules/settings/server/workspace-policy';
import { readWorkspaceOperations } from '@/modules/settings/server/workspace-operations';
import { SettingsPage, styles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { fill } from '@/modules/settings/ui/shell-copy';
import { WorkspaceCards } from './WorkspaceCards';
import { BestTimeApplyCard } from './best-time-apply-card';

export const metadata: Metadata = { title: 'Workspace' };
export default async function WorkspacePolicyPage() {
  const viewer = await requireViewer({ feature: 'settings/workspace' });
  const locale = await settingsLocale();
  const [uiCopy, sections] = await Promise.all([readSettingsUiCopy(), readSectionsCopy(locale)]);
  const t = uiCopy.workspace[locale];
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [policy, operations] = await Promise.all([readWorkspacePolicy(actor).catch(() => null), readWorkspaceOperations(actor).catch(() => null)]);
  const canManage = ['owner', 'admin'].includes(viewer.membership.role);
  const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return <PageFrame module="settings"><SettingsPage copy={uiCopy} active="settings/workspace" title={t.title} locale={locale} description={fill(t.description, { workspace: viewer.membership.workspace.name })}>
    {policy && operations
      ? <WorkspaceCards key={viewer.workspaceId} locale={locale} copy={sections} workspaceId={viewer.workspaceId} workspaceName={viewer.membership.workspace.name} canManage={canManage} policy={policy} operations={operations.settings} timezones={timezones} bestTime={canManage ? <BestTimeApplyCard key="best-time" locale={locale} /> : null} />
      : <p className={styles['settings-note']} role="alert">{sections.unavailable}</p>}
  </SettingsPage></PageFrame>;
}
