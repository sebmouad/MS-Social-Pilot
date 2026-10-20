import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { fill } from '@/modules/settings/ui/shell-copy';
import { DataControls } from './controls';
import { WorkspaceExports } from './exports';
import { dataCopy } from './copy';

export const metadata: Metadata = { title: 'Data and privacy' };

export default async function DataSettingsPage() {
  const viewer = await requireViewer({ feature: 'settings/data' });
  const locale = await settingsLocale();
  const t = dataCopy[locale];
  const manager = ['owner', 'admin'].includes(viewer.membership.role);
  return <PageFrame module="settings"><SettingsPage active="settings/data" title={t.title} locale={locale} description={fill(t.description, { workspace: viewer.membership.workspace.name })}>
    <SettingsPanel title={t.exportPanel} detail={t.exportDetail}>
      <p className={styles['settings-note']}>{t.exportNote}</p>
      {manager ? <WorkspaceExports key={viewer.workspaceId} workspaceId={viewer.workspaceId} workspaceName={viewer.membership.workspace.name} locale={locale} /> : <p className={styles['settings-note']}>{t.managersOnly}</p>}
    </SettingsPanel>
    <SettingsPanel title={t.deletePanel} detail={t.deleteDetail}>
      <p className={styles['settings-note']}>{t.deleteNote}</p>
      <DataControls workspaceName={viewer.membership.workspace.name} locale={locale} destructive />
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
