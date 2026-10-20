import { PersonKeysAccountFallback } from '@/modules/settings/person-keys/AccountFallback';
import { headers } from 'next/headers';
import { PersonKeysManager } from '@/modules/settings/person-keys/Manager';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { AccountManager } from './manager';
import { accountPasswordPolicy } from '@/server/account-settings';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/account', channelScoped: true }); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('NEXT_REDIRECT')) throw error;
    return <PersonKeysAccountFallback locale={locale} />;
  }
  const passwordPolicy = await accountPasswordPolicy();
  const values = [
    { label: 'Workspace', value: viewer.membership.workspace.name },
    { label: 'Your role', value: viewer.membership.role },
    { label: 'Workspace time zone', value: viewer.membership.workspace.timezone },
    { label: 'Workspace slug', value: viewer.membership.workspace.slug },
  ];

  return <PageFrame module="settings" scopedAccess><SettingsPage active="settings/account" title="Account" description="Your profile and the workspace context used for this session.">
    <AccountManager initialName={viewer.user.name} email={viewer.user.email} passwordPolicy={passwordPolicy} />
    <PersonKeysManager locale={locale} />
    <SettingsPanel title="Workspace context">
      <dl className={styles['settings-account-grid']}>{values.map(item => <div className={styles['settings-account-item']} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
