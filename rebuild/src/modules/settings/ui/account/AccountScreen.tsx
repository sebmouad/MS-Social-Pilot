import { configOrDefault } from '@/server/config/config-or-default';
import { AccountSettings } from './settings';
import { readSectionsCopy, readSettingsUiCopy } from '@/modules/settings/ui/copy-server';
import { canAccessFeature } from '@/server/permissions';
import { accountConfirmationCopySchema } from '../../account-confirmation-copy';
import { PersonKeysAccountFallback } from '@/modules/settings/person-keys/AccountFallback';
import { headers } from 'next/headers';
import { PersonKeysManager } from '@/modules/settings/person-keys/Manager';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles, type SectionTabKey } from '@/modules/settings/ui/_components';
import { readAccount } from '../../server/account';
import { accountSessionActor } from '../../server/account-session';
import { listPersonKeys } from '@/modules/settings/person-keys/service';

export const metadata: Metadata = { title: 'Account' };

/** Shared by the Profile and Security tabs and the API keys tab of Integrations: the account actor, copy and the Account-only fallback. */
async function accountViewer() {
  const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' as const : 'en' as const;
  try {
    const viewer = await requireViewer({ feature: 'settings/account', channelScoped: true });
    return { locale, viewer, fallback: null };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('NEXT_REDIRECT')) throw error;
    return { locale, viewer: null, fallback: <PersonKeysAccountFallback locale={locale} /> };
  }
}

async function AccountTab({ part, tab }: { part: 'profile' | 'security'; tab: SectionTabKey }) {
  const { locale, viewer, fallback } = await accountViewer();
  if (!viewer) return fallback;
  const uiCopy = await readSettingsUiCopy();
  const t = uiCopy.account[locale];
  const account = await readAccount(await accountSessionActor(viewer.user.id, viewer.workspaceId));
  const { passwordPolicy, nameMaxLength } = account;
  const confirmationCopy = (await configOrDefault('settings.accountConfirmationCopy', accountConfirmationCopySchema))[locale];
  // The workspace slug is an internal identifier and is not shown to customers.
  const values = [
    { label: t.workspace, value: viewer.membership.workspace.name },
    { label: t.role, value: (uiCopy.roles[locale] as Record<string, string>)[viewer.membership.role] ?? viewer.membership.role },
    { label: t.timezone, value: viewer.membership.workspace.timezone },
  ];
  return <PageFrame module="settings" scopedAccess><SettingsPage copy={uiCopy} active="settings/account" tab={tab} title={t.title} description={t.description} locale={locale}>
    <AccountSettings part={part} canWrite={canAccessFeature(viewer.permissions, 'settings/account', 'write')} nameMaxLength={nameMaxLength} confirmationCopy={confirmationCopy} locale={locale} initialName={account.name} email={account.email} passwordPolicy={passwordPolicy} />
    {part === 'profile' && <SettingsPanel title={t.contextTitle}>
      <dl className={styles['settings-account-grid']}>{values.map(item => <div className={styles['settings-account-item']} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </SettingsPanel>}
  </SettingsPage></PageFrame>;
}

export default function AccountProfilePage() { return <AccountTab part="profile" tab="accountProfile" />; }
export function AccountSecurityPage() { return <AccountTab part="security" tab="accountSecurity" />; }

/** Personal API keys: the Integrations "API keys" tab. They belong to the person, so the Account-only fallback still applies. */
export async function PersonalKeysPage() {
  const { locale, viewer, fallback } = await accountViewer();
  if (!viewer) return fallback;
  const uiCopy = await readSettingsUiCopy();
  // Read on the server so an unavailable credential store shows an in-page retry instead of a failing browser request.
  const personKeys = await listPersonKeys({ userId: viewer.user.id })
    .then(result => ({ ...result, keys: result.keys.map(key => ({ ...key, expiresAt: key.expiresAt.toISOString(), createdAt: key.createdAt.toISOString() })) }))
    .catch(() => null);
  const t = uiCopy.personKeys[locale];
  const sections = await readSectionsCopy(locale);
  return <PageFrame module="settings" scopedAccess><SettingsPage copy={uiCopy} active="settings/account" tab="integrationsKeys" title={sections.tabs.integrationsKeys} description={t.help} locale={locale}>
    <PersonKeysManager locale={locale} initial={personKeys} />
  </SettingsPage></PageFrame>;
}
