import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, listConnections } from '@/server/data';
import { SettingsPage, SettingsPanel, Status, styles } from '../_components';
import { ConnectionManager } from './manager';

export const metadata: Metadata = { title: 'Connections' };

const providerName = (provider: string) => provider.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const accountStatus = (invalidatedAt: Date | null) => invalidatedAt ? { label: 'Needs attention', tone: 'warning' as const } : { label: 'Connected', tone: 'good' as const };

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ notice?: string; select?: string }> }) {
  const [viewer, params] = await Promise.all([requireViewer({ feature: 'settings/connections' }), searchParams]);
  const [accounts, adAccounts] = await Promise.all([listConnections(viewer.workspaceId), getAdAccounts(viewer.workspaceId)]);
  const socialById = new Map(accounts.map(account => [account.id, account]));
  const adRows = adAccounts.map(ad => {
    const social = ad.socialAccountId ? socialById.get(ad.socialAccountId) : undefined;
    return { ...ad, provider: social?.provider, owner: social?.name, invalidatedAt: social?.invalidatedAt };
  });
  const canManage = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';

  return <PageFrame module="settings"><SettingsPage active="settings/connections" title="Connections" description="Choose which discovered channels and advertising accounts this workspace uses.">
    <ConnectionManager sources={accounts} canManage={canManage} initiallyOpen={params.select === '1'} />
    {params.notice === 'connected_partial' && <p className={styles['settings-note']} role="status">Meta connected. Newly discovered channels and ad accounts are ready for selection. Items already linked to another profile were left unchanged.</p>}
    {params.notice === 'connected' && <p className={styles['settings-note']} role="status">Meta connected. Discovered channels and ad accounts are ready for your selection.</p>}
    {params.notice === 'oauth_cancelled' && <p className={styles['settings-note']} role="status">Meta authorization was cancelled.</p>}
    {params.notice === 'connect_failed' && <p className={styles['settings-note']} role="alert">Connection unavailable. Try again or contact support.</p>}
    {params.notice === 'oauth_invalid_state' && <p className={styles['settings-note']} role="alert">The authorization session expired or changed. Start again from this page.</p>}
    {params.notice === 'saved' && <p className={styles['settings-note']} role="status">Selection saved.</p>}
    {params.notice === 'failed' && <p className={styles['settings-note']} role="alert">The selection could not be saved. Check your workspace access and try again.</p>}
    <SettingsPanel title="Social accounts" detail={`${accounts.length} connected account${accounts.length === 1 ? '' : 's'} in this workspace`}>
      {accounts.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">Account</th><th scope="col">Platform</th><th scope="col">Channels</th><th scope="col">Status</th></tr></thead><tbody>
        {accounts.map(account => { const status = accountStatus(account.invalidatedAt); return <tr key={account.id}>
          <td><span className={styles['settings-table__primary']}>{account.name}</span><span className={styles['settings-table__secondary']}>Added {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(account.createdAt)}</span></td>
          <td>{providerName(account.provider)}</td>
          <td>{account.targets.length ? <div className={styles['settings-inline-list']}>{account.targets.map(target => <div key={target.id} className={styles['settings-chip']} data-disabled={!target.enabled}><span className={styles['settings-chip__dot']} />{target.name || providerName(target.type)}{!target.enabled && ' · not selected'}</div>)}</div> : <span className={styles['settings-table__secondary']}>No channels recorded</span>}</td>
          <td><Status tone={status.tone}>{status.label}</Status></td>
        </tr>; })}
      </tbody></table></div> : <div className={styles['settings-empty']}>No social accounts are connected to this workspace.</div>}
      {!canManage && <p className={styles['settings-note']}>Only workspace owners and admins can change these selections.</p>}
    </SettingsPanel>

    <SettingsPanel title="Advertising accounts" detail={`${adRows.length} discovered account${adRows.length === 1 ? '' : 's'}`}>
      {adRows.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">Ad account</th><th scope="col">Linked profile</th><th scope="col">Account ID</th><th scope="col">Status</th><th scope="col">Selection</th></tr></thead><tbody>
        {adRows.map(ad => <tr key={ad.id}><td><span className={styles['settings-table__primary']}>{ad.name}</span><span className={styles['settings-table__secondary']}>{ad.provider ? providerName(ad.provider) : 'Platform not recorded'}</span></td><td>{ad.owner ?? 'No linked profile'}</td><td>{ad.actId}</td><td><Status tone={ad.enabled && !ad.invalidatedAt ? 'good' : 'warning'}>{!ad.enabled ? 'Not selected' : ad.invalidatedAt ? 'Linked profile needs attention' : 'Selected'}</Status></td><td>{ad.socialAccountId ? (ad.enabled ? 'Selected' : 'Not selected') : 'Reconnect source first'}</td></tr>)}
      </tbody></table></div> : <div className={styles['settings-empty']}>No advertising accounts are linked to the social accounts in this workspace.</div>}
    </SettingsPanel>
    <p className={styles['settings-note']}>Selection changes only the workspace’s local enabled state. They do not change access at the provider. Credentials are never shown here.</p>
  </SettingsPage></PageFrame>;
}
