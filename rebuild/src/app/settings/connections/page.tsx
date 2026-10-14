import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, listConnections } from '@/server/data';
import { SettingsPage, SettingsPanel, Status, styles } from '../_components';

export const metadata: Metadata = { title: 'Connections' };

const providerName = (provider: string) => provider.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const accountStatus = (invalidatedAt: Date | null) => invalidatedAt ? { label: 'Needs attention', tone: 'warning' as const } : { label: 'Connected', tone: 'good' as const };

export default async function ConnectionsPage() {
  const viewer = await requireViewer();
  const [accounts, adAccounts] = await Promise.all([listConnections(viewer.workspaceId), getAdAccounts(viewer.workspaceId)]);
  const socialById = new Map(accounts.map(account => [account.id, account]));
  const adRows = adAccounts.map(ad => {
    const social = ad.socialAccountId ? socialById.get(ad.socialAccountId) : undefined;
    return { ...ad, provider: social?.provider, owner: social?.name, invalidatedAt: social?.invalidatedAt };
  });

  return <PageFrame module="settings"><SettingsPage active="settings/connections" title="Connections" description="Social profiles and advertising accounts available in this workspace.">
    <SettingsPanel title="Social accounts" detail={`${accounts.length} connected account${accounts.length === 1 ? '' : 's'} in this workspace`}>
      {accounts.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">Account</th><th scope="col">Platform</th><th scope="col">Channels</th><th scope="col">Status</th></tr></thead><tbody>
        {accounts.map(account => { const status = accountStatus(account.invalidatedAt); return <tr key={account.id}>
          <td><span className={styles['settings-table__primary']}>{account.name}</span><span className={styles['settings-table__secondary']}>Added {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(account.createdAt)}</span></td>
          <td>{providerName(account.provider)}</td>
          <td>{account.targets.length ? <div className={styles['settings-inline-list']}>{account.targets.map(target => <span key={target.id} className={styles['settings-chip']} data-disabled={!target.enabled}><span className={styles['settings-chip__dot']} />{target.name || providerName(target.type)}{!target.enabled && ' · disabled'}</span>)}</div> : <span className={styles['settings-table__secondary']}>No channels recorded</span>}</td>
          <td><Status tone={status.tone}>{status.label}</Status></td>
        </tr>; })}
      </tbody></table></div> : <div className={styles['settings-empty']}>No social accounts are connected to this workspace.</div>}
    </SettingsPanel>

    <SettingsPanel title="Advertising accounts" detail={`${adRows.length} linked account${adRows.length === 1 ? '' : 's'} recorded`}>
      {adRows.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">Ad account</th><th scope="col">Linked profile</th><th scope="col">Account ID</th><th scope="col">Status</th></tr></thead><tbody>
        {adRows.map(ad => <tr key={ad.id}><td><span className={styles['settings-table__primary']}>{ad.name}</span><span className={styles['settings-table__secondary']}>{ad.provider ? providerName(ad.provider) : 'Platform not recorded'}</span></td><td>{ad.owner ?? 'No linked profile'}</td><td>{ad.actId}</td><td><Status tone={ad.enabled && !ad.invalidatedAt ? 'good' : 'warning'}>{!ad.enabled ? 'Disabled' : ad.invalidatedAt ? 'Linked profile needs attention' : 'Enabled'}</Status></td></tr>)}
      </tbody></table></div> : <div className={styles['settings-empty']}>No advertising accounts are linked to the social accounts in this workspace.</div>}
    </SettingsPanel>
    <p className={styles['settings-note']}>Connection status reflects the records currently stored for this workspace. Credentials are never shown here.</p>
  </SettingsPage></PageFrame>;
}
