import { profileCopy } from '../../channel-profiles/copy';
import { entitledPlatformIds } from '@/server/entitlements';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, listConnections } from '@/server/data';
import { SettingsPage, SettingsPanel, Status, styles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { fill } from '@/modules/settings/ui/shell-copy';
import { ConnectionManager } from './manager';
import { connectablePlatforms, platformGrantHealth } from '@/server/platforms/registry';
import { summarizeConnectionHealth, connectionHealthText, type ConnectionHealthCopyKey } from '@/lib/connection-health';
import { ReconnectButton } from './reconnect';
import { platformModule } from '@/platforms';
import { connectionState } from '@/lib/connection-status';
import { runtimeConfig } from '@/server/config/store';
import { connectionsCopy } from './copy';

export const metadata: Metadata = { title: 'Connections' };

const providerName = (provider: string) => platformModule(provider)?.name ?? provider.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ notice?: string; select?: string; source?: string; action?: string }> }) {
  const [viewer, params, locale] = await Promise.all([requireViewer({ feature: 'settings/connections' }), searchParams, settingsLocale()]);
  const t = connectionsCopy[locale];
  const allowedProviders = entitledPlatformIds(viewer.entitlements);
  const [accounts, adAccounts, platforms, statusLabels] = await Promise.all([listConnections(viewer.workspaceId, allowedProviders), getAdAccounts(viewer.workspaceId, allowedProviders), connectablePlatforms(allowedProviders), runtimeConfig('connections.statusLabels')]);
  const connectable = platforms.map(({ id, name, mark }) => ({ id, name, mark }));
  const socialById = new Map(accounts.map(account => [account.id, account]));
  const adRows = adAccounts.map(ad => {
    const social = ad.socialAccountId ? socialById.get(ad.socialAccountId) : undefined;
    return { ...ad, provider: social?.provider, owner: social?.name, state: social ? connectionState(social) : null };
  });
  const canManage = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  const now = new Date();
  const healthById = new Map(await Promise.all(accounts.map(async account => [account.id, summarizeConnectionHealth(account, await platformGrantHealth(account.provider, { scopes: account.scopes, hasAdAccounts: account.adAccounts.length > 0, locale }), now)] as const)));
  const text = (key: ConnectionHealthCopyKey, values?: Record<string, string>) => connectionHealthText(locale, key, values);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const notice = (key: string, tone: 'status' | 'alert', message: string) => params.notice === key && <p className={styles['settings-note']} role={tone}>{message}</p>;

  return <PageFrame module="settings"><SettingsPage active="settings/connections" title={t.title} description={t.description} locale={locale}>
    <a href="/settings/profiles">{profileCopy[locale].title}</a>
    <ConnectionManager locale={locale} statusLabels={statusLabels} sources={accounts} canManage={canManage} platforms={connectable} initiallyOpen={params.select === '1'} initialSourceId={params.source} initialAction={params.action === 'disconnect' ? 'disconnect' : params.action === 'manage' ? 'manage' : undefined} />
    {notice('connected_partial', 'status', t.connectedPartial)}
    {notice('connected', 'status', t.connected)}
    {notice('oauth_cancelled', 'status', t.oauthCancelled)}
    {notice('connect_failed', 'alert', t.connectFailed)}
    {notice('oauth_invalid_state', 'alert', t.invalidState)}
    {notice('saved', 'status', t.saved)}
    {notice('failed', 'alert', t.failed)}
    {!accounts.length && !adRows.length ? <SettingsPanel title={t.noneTitle} detail={t.noneDetail}>
      <p className={styles['settings-empty']}>{connectable.length && canManage ? t.noneConnect : t.noneAvailable}</p>
    </SettingsPanel> : <>
    <SettingsPanel title={t.socialPanel} detail={accounts.length === 1 ? t.socialDetailOne : fill(t.socialDetailMany, { count: accounts.length })}>
      {accounts.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">{t.account}</th><th scope="col">{t.platform}</th><th scope="col">{t.channels}</th><th scope="col">{t.status}</th>{canManage && <th scope="col">{t.actions}</th>}</tr></thead><tbody>
        {accounts.map(account => { const health = healthById.get(account.id)!; return <tr key={account.id}>
          <td><span className={styles['settings-table__primary']}>{account.name}</span><span className={styles['settings-table__secondary']}>{fill(t.added, { date: dayFormat.format(account.createdAt) })}</span></td>
          <td>{providerName(account.provider)}</td>
          <td>{account.targets.length ? <><span className={styles['settings-table__secondary']}>{fill(t.selectedOf, { enabled: account.targets.filter(target => target.enabled).length, total: account.targets.length })}</span><div className={styles['settings-inline-list']}>{account.targets.map(target => <div key={target.id} className={styles['settings-chip']} data-disabled={!target.enabled}><span className={styles['settings-chip__dot']} />{target.name || providerName(target.type)}{!target.enabled && t.notSelectedSuffix}</div>)}</div></> : <span className={styles['settings-table__secondary']}>{t.noChannels}</span>}</td>
          <td><Status tone={health.token === 'valid' ? 'good' : 'warning'}>{text(`token.${health.token}`)}</Status>
            <span className={styles['settings-table__secondary']}>{account.tokenExpiresAt ? text('token.expiresOn', { date: dateFormat.format(account.tokenExpiresAt) }) : text('token.noExpiry')}</span>
            {health.grants.length > 0 && <ul className={styles['settings-health-list']} aria-label={text('permissions')}>{health.grants.map(group => <li key={group.id}>{group.label}: {text(group.state)}</li>)}</ul>}
            {health.missing.length > 0 && <span className={styles['settings-table__secondary']}>{text('missingSummary', { labels: health.missing.map(group => group.label).join(', ') })}</span>}
            {health.grants.length > 0 && health.grants.every(group => group.state === 'unknown') && <span className={styles['settings-table__secondary']}>{text('unknownSummary')}</span>}</td>
          {canManage && <td><div className={styles['settings-row-actions']}>{health.reconnectRecommended && <ReconnectButton platformId={account.provider} label={text('reconnect')} busyLabel={text('reconnecting')} failedLabel={text('reconnectFailed')} />}<a href={`/settings/connections?source=${encodeURIComponent(account.id)}&action=manage`}>{t.manage}</a><a className={styles['settings-row-actions__danger']} href={`/settings/connections?source=${encodeURIComponent(account.id)}&action=disconnect`}>{t.disconnect}</a></div></td>}
        </tr>; })}
      </tbody></table></div> : <div className={styles['settings-empty']}>{t.noSocial}</div>}
      {!canManage && <p className={styles['settings-note']}>{t.managersOnly}</p>}
    </SettingsPanel>
    <SettingsPanel title={t.adPanel} detail={adRows.length === 1 ? t.adDetailOne : fill(t.adDetailMany, { count: adRows.length })}>
      {adRows.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">{t.adAccount}</th><th scope="col">{t.linkedProfile}</th><th scope="col">{t.accountId}</th><th scope="col">{t.status}</th>{canManage && <th scope="col">{t.actions}</th>}</tr></thead><tbody>
        {adRows.map(ad => <tr key={ad.id}><td><span className={styles['settings-table__primary']}>{ad.name}</span><span className={styles['settings-table__secondary']}>{ad.provider ? providerName(ad.provider) : t.platformMissing}</span></td><td>{ad.owner ?? t.noLinkedProfile}</td><td>{ad.actId}</td><td><Status tone={ad.enabled && ad.state === 'connected' ? 'good' : 'warning'}>{!ad.enabled ? t.notSelected : ad.state && ad.state !== 'connected' ? statusLabels[ad.state] : t.selected}</Status></td>{canManage && <td>{ad.socialAccountId && socialById.has(ad.socialAccountId) ? <a className={styles['settings-row-actions__link']} href={`/settings/connections?source=${encodeURIComponent(ad.socialAccountId)}&action=manage`}>{t.manageSelection}</a> : <span className={styles['settings-table__secondary']}>{t.reconnectFirst}</span>}</td>}</tr>)}
      </tbody></table></div> : <div className={styles['settings-empty']}>{t.noAds}</div>}
    </SettingsPanel>
    </>}
    <p className={styles['settings-note']}>{t.footnote}</p>
  </SettingsPage></PageFrame>;
}
