import { entitledPlatformIds } from '@/server/entitlements';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, listConnections } from '@/server/data';
import { SettingsPage, SettingsPanel, Status, styles } from '../_components';
import { ConnectionManager } from './manager';
import { connectablePlatforms } from '@/server/platforms/registry';
import { platformModule } from '@/platforms';
import { connectionState } from '@/lib/connection-status';
import { runtimeConfig } from '@/server/config/store';

export const metadata: Metadata = { title: 'Connections' };

const providerName = (provider: string) => platformModule(provider)?.name ?? provider.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ notice?: string; select?: string; source?: string; action?: string }> }) {
  const [viewer, params] = await Promise.all([requireViewer({ feature: 'settings/connections' }), searchParams]);
  const allowedProviders = entitledPlatformIds(viewer.entitlements);
  const [accounts, adAccounts, platforms, statusLabels] = await Promise.all([listConnections(viewer.workspaceId, allowedProviders), getAdAccounts(viewer.workspaceId, allowedProviders), connectablePlatforms(allowedProviders), runtimeConfig('connections.statusLabels')]);
  const connectable = platforms.map(({ id, name, mark }) => ({ id, name, mark }));
  const socialById = new Map(accounts.map(account => [account.id, account]));
  const adRows = adAccounts.map(ad => {
    const social = ad.socialAccountId ? socialById.get(ad.socialAccountId) : undefined;
    return { ...ad, provider: social?.provider, owner: social?.name, state: social ? connectionState(social) : null };
  });
  const canManage = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';

  return <PageFrame module="settings"><SettingsPage active="settings/connections" title="Connections" description="Choose which discovered channels and advertising accounts this workspace uses.">
    <ConnectionManager statusLabels={statusLabels} sources={accounts} canManage={canManage} platforms={connectable} initiallyOpen={params.select === '1'} initialSourceId={params.source} initialAction={params.action === 'disconnect' ? 'disconnect' : params.action === 'manage' ? 'manage' : undefined} />
    {params.notice === 'connected_partial' && <p className={styles['settings-note']} role="status">Connected. Newly discovered channels and ad accounts are ready for selection. Items already linked to another profile were left unchanged.</p>}
    {params.notice === 'connected' && <p className={styles['settings-note']} role="status">Connected. Discovered channels and ad accounts are ready for your selection.</p>}
    {params.notice === 'oauth_cancelled' && <p className={styles['settings-note']} role="status">Authorization was cancelled.</p>}
    {params.notice === 'connect_failed' && <p className={styles['settings-note']} role="alert">Connection unavailable. Try again or contact support.</p>}
    {params.notice === 'oauth_invalid_state' && <p className={styles['settings-note']} role="alert">The authorization session expired or changed. Start again from this page.</p>}
    {params.notice === 'saved' && <p className={styles['settings-note']} role="status">Selection saved.</p>}
    {params.notice === 'failed' && <p className={styles['settings-note']} role="alert">The selection could not be saved. Check your workspace access and try again.</p>}
    {!accounts.length && !adRows.length ? <SettingsPanel title="No available connections" detail="Available channels and ad accounts you select will appear here.">
      <p className={styles['settings-empty']}>{connectable.length && canManage ? 'Connect a source above to choose what this workspace uses.' : 'No channels or advertising accounts are currently available.'}</p>
    </SettingsPanel> : <>
    <SettingsPanel title="Social accounts" detail={`${accounts.length} connected account${accounts.length === 1 ? '' : 's'} in this workspace`}>
      {accounts.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">Account</th><th scope="col">Platform</th><th scope="col">Channels</th><th scope="col">Status</th>{canManage && <th scope="col">Actions</th>}</tr></thead><tbody>
        {accounts.map(account => { const state = connectionState(account); const status = { label: statusLabels[state], tone: state === 'connected' ? 'good' as const : 'warning' as const }; return <tr key={account.id}>
          <td><span className={styles['settings-table__primary']}>{account.name}</span><span className={styles['settings-table__secondary']}>Added {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(account.createdAt)}</span></td>
          <td>{providerName(account.provider)}</td>
          <td>{account.targets.length ? <><span className={styles['settings-table__secondary']}>{account.targets.filter(target => target.enabled).length} of {account.targets.length} selected</span><div className={styles['settings-inline-list']}>{account.targets.map(target => <div key={target.id} className={styles['settings-chip']} data-disabled={!target.enabled}><span className={styles['settings-chip__dot']} />{target.name || providerName(target.type)}{!target.enabled && ' · not selected'}</div>)}</div></> : <span className={styles['settings-table__secondary']}>No channels recorded</span>}</td>
          <td><Status tone={status.tone}>{status.label}</Status></td>
          {canManage && <td><div className={styles['settings-row-actions']}><a href={`/settings/connections?source=${encodeURIComponent(account.id)}&action=manage`}>Manage</a><a className={styles['settings-row-actions__danger']} href={`/settings/connections?source=${encodeURIComponent(account.id)}&action=disconnect`}>Disconnect</a></div></td>}
        </tr>; })}
      </tbody></table></div> : <div className={styles['settings-empty']}>No social accounts are connected to this workspace.</div>}
      {!canManage && <p className={styles['settings-note']}>Only workspace owners and admins can change these selections.</p>}
    </SettingsPanel>
    <SettingsPanel title="Advertising accounts" detail={`${adRows.length} discovered account${adRows.length === 1 ? '' : 's'}`}>
      {adRows.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">Ad account</th><th scope="col">Linked profile</th><th scope="col">Account ID</th><th scope="col">Status</th>{canManage && <th scope="col">Actions</th>}</tr></thead><tbody>
        {adRows.map(ad => <tr key={ad.id}><td><span className={styles['settings-table__primary']}>{ad.name}</span><span className={styles['settings-table__secondary']}>{ad.provider ? providerName(ad.provider) : 'Platform not recorded'}</span></td><td>{ad.owner ?? 'No linked profile'}</td><td>{ad.actId}</td><td><Status tone={ad.enabled && ad.state === 'connected' ? 'good' : 'warning'}>{!ad.enabled ? 'Not selected' : ad.state && ad.state !== 'connected' ? statusLabels[ad.state] : 'Selected'}</Status></td>{canManage && <td>{ad.socialAccountId && socialById.has(ad.socialAccountId) ? <a className={styles['settings-row-actions__link']} href={`/settings/connections?source=${encodeURIComponent(ad.socialAccountId)}&action=manage`}>Manage selection</a> : <span className={styles['settings-table__secondary']}>Reconnect source first</span>}</td>}</tr>)}
      </tbody></table></div> : <div className={styles['settings-empty']}>No advertising accounts are linked to the social accounts in this workspace.</div>}
    </SettingsPanel>
    </>}
    <p className={styles['settings-note']}>Selection changes only the workspace’s local enabled state. They do not change access at the provider. Credentials are never shown here.</p>
  </SettingsPage></PageFrame>;
}
