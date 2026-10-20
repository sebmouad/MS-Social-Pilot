import { canAccessFeature } from '@/server/permissions';
import { runtimeConfig } from '@/server/config/store';
import { accountConfirmationCopySchema } from '../../account-confirmation-copy';
import { PersonKeysAccountFallback } from '@/modules/settings/person-keys/AccountFallback';
import { headers } from 'next/headers';
import { PersonKeysManager } from '@/modules/settings/person-keys/Manager';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { AccountManager } from './manager';
import { readAccount } from '../../server/account';
import { accountSessionActor } from '../../server/account-session';
import { accountCopy } from './copy';
import { listPersonKeys } from '@/modules/settings/person-keys/service';

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
  const account = await readAccount(await accountSessionActor(viewer.user.id, viewer.workspaceId));
  const { passwordPolicy, nameMaxLength } = account;
  const confirmationCopy = accountConfirmationCopySchema.parse(await runtimeConfig('settings.accountConfirmationCopy'))[locale];
  // Read on the server so an unavailable credential store shows an in-page retry instead of a failing browser request.
  const personKeys = await listPersonKeys({ userId: viewer.user.id })
    .then(result => ({ ...result, keys: result.keys.map(key => ({ ...key, expiresAt: key.expiresAt.toISOString(), createdAt: key.createdAt.toISOString() })) }))
    .catch(() => null);
  const values = [
    { label: t.workspace, value: viewer.membership.workspace.name },
    { label: t.role, value: viewer.membership.role },
    { label: t.timezone, value: viewer.membership.workspace.timezone },
    { label: t.slug, value: viewer.membership.workspace.slug },
  ];

  return <PageFrame module="settings" scopedAccess><SettingsPage active="settings/account" title={t.title} description={t.description} locale={locale}>
    <AccountManager canWrite={canAccessFeature(viewer.permissions, 'settings/account', 'write')} nameMaxLength={nameMaxLength} confirmationCopy={confirmationCopy} locale={locale} initialName={account.name} email={account.email} passwordPolicy={passwordPolicy} />
    <PersonKeysManager locale={locale} initial={personKeys} />
    <SettingsPanel title={t.contextTitle}>
      <dl className={styles['settings-account-grid']}>{values.map(item => <div className={styles['settings-account-item']} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
