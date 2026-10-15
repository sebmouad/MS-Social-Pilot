import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { AccountManager } from './manager';
import { accountPasswordPolicy } from '@/server/account-settings';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const viewer = await requireViewer({ feature: 'settings/account', channelScoped: true });
  const passwordPolicy = await accountPasswordPolicy();
  const values = [
    { label: 'Workspace', value: viewer.membership.workspace.name },
    { label: 'Your role', value: viewer.membership.role },
    { label: 'Workspace time zone', value: viewer.membership.workspace.timezone },
    { label: 'Workspace slug', value: viewer.membership.workspace.slug },
  ];

  return <PageFrame module="settings" scopedAccess><SettingsPage active="settings/account" title="Account" description="Your profile and the workspace context used for this session.">
    <AccountManager initialName={viewer.user.name} email={viewer.user.email} passwordPolicy={passwordPolicy} />
    <SettingsPanel title="Workspace context">
      <dl className={styles['settings-account-grid']}>{values.map(item => <div className={styles['settings-account-item']} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
