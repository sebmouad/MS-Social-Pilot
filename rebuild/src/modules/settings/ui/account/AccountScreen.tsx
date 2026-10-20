import { PersonKeysAccountFallback } from '@/modules/settings/person-keys/AccountFallback';
import { headers } from 'next/headers';
import { PersonKeysManager } from '@/modules/settings/person-keys/Manager';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { AccountManager } from './manager';
import { accountPasswordPolicy } from '@/server/account-settings';
import { accountCopy } from './copy';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/account', channelScoped: true }); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('NEXT_REDIRECT')) throw error;
    return <PersonKeysAccountFallback locale={locale} />;
  }
  const t = accountCopy[locale];
  const passwordPolicy = await accountPasswordPolicy();
  const values = [
    { label: t.workspace, value: viewer.membership.workspace.name },
    { label: t.role, value: viewer.membership.role },
    { label: t.timezone, value: viewer.membership.workspace.timezone },
    { label: t.slug, value: viewer.membership.workspace.slug },
  ];

  return <PageFrame module="settings" scopedAccess><SettingsPage active="settings/account" title={t.title} description={t.description} locale={locale}>
    <AccountManager locale={locale} initialName={viewer.user.name} email={viewer.user.email} passwordPolicy={passwordPolicy} />
    <PersonKeysManager locale={locale} />
    <SettingsPanel title={t.contextTitle}>
      <dl className={styles['settings-account-grid']}>{values.map(item => <div className={styles['settings-account-item']} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
