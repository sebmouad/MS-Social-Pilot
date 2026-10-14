import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '../_components';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const viewer = await requireViewer();
  const values = [
    { label: 'Name', value: viewer.user.name },
    { label: 'Email', value: viewer.user.email },
    { label: 'Workspace', value: viewer.membership.workspace.name },
    { label: 'Your role', value: viewer.membership.role },
    { label: 'Workspace time zone', value: viewer.membership.workspace.timezone },
    { label: 'Workspace slug', value: viewer.membership.workspace.slug },
  ];

  return <PageFrame module="settings"><SettingsPage active="settings/account" title="Account" description="Your profile and the workspace context used for this session.">
    <SettingsPanel title="Profile and workspace">
      <dl className={styles['settings-account-grid']}>{values.map(item => <div className={styles['settings-account-item']} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </SettingsPanel>
    <p className={styles['settings-note']}>These details come from your current account and workspace records. Profile and preference editing is not available here.</p>
  </SettingsPage></PageFrame>;
}
