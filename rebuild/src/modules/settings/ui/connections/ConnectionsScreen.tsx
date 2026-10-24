import { readSectionsCopy, readSettingsUiCopy } from '@/modules/settings/ui/copy-server';

import { entitledPlatformIds } from '@/server/entitlements';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, listConnections } from '@/server/data';
import { SettingsPage, SettingsPanel, Status, styles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { fill } from '@/modules/settings/ui/shell-copy';
import { ConnectionManager } from './manager';
import { connectablePlatforms, platformConnectsWithCredentials, platformGrantHealth } from '@/server/platforms/registry';
import { summarizeConnectionHealth, connectionHealthText, type ConnectionHealthCopyKey } from '@/lib/connection-health';
import { ChannelCardActions } from './row-menu';
import { Avatar, DataTable, EmptyState, InfoTip } from '@/components';
import { GrantChips } from './GrantChips';
import cardStyles from './connections.module.css';
import { IconPlugConnected } from '@tabler/icons-react';
import { platformModule } from '@/platforms';
import { connectionState } from '@/lib/connection-status';
import { runtimeConfig } from '@/server/config/store';

export const metadata: Metadata = { title: 'Channels' };

const providerName = (provider: string) => platformModule(provider)?.name ?? provider.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ notice?: string; select?: string; source?: string; action?: string }> }) {
  const [viewer, params, locale] = await Promise.all([requireViewer({ feature: 'settings/connections' }), searchParams, settingsLocale()]);
  const [uiCopy, sections] = await Promise.all([readSettingsUiCopy(), readSectionsCopy(locale)]);
  const t = uiCopy.connections[locale];
  const c = sections.channels;
  const allowedProviders = entitledPlatformIds(viewer.entitlements);
  const [accounts, adAccounts, platforms, statusLabels] = await Promise.all([listConnections(viewer.workspaceId, allowedProviders), getAdAccounts(viewer.workspaceId, allowedProviders), connectablePlatforms(allowedProviders), runtimeConfig('connections.statusLabels')]);
  const connectable = platforms.map(({ id, name, mark }) => ({ id, name, mark, credentials: platformConnectsWithCredentials(id) }));
  const socialById = new Map(accounts.map(account => [account.id, account]));
  const adRows = adAccounts.map(ad => {
    const social = ad.socialAccountId ? socialById.get(ad.socialAccountId) : undefined;
    return { ...ad, provider: social?.provider, owner: social?.name, state: social ? connectionState(social) : null };
  });
  const canManage = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  const now = new Date();
  const healthById = new Map(await Promise.all(accounts.map(async account => [account.id, summarizeConnectionHealth(account, await platformGrantHealth(account.provider, { scopes: account.scopes, hasAdAccounts: account.adAccounts.length > 0, locale }), now)] as const)));
  const text = (key: ConnectionHealthCopyKey, values?: Record<string, string>) => connectionHealthText(locale, key, values);
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const notice = (key: string, tone: 'status' | 'alert', message: string) => params.notice === key && <p className={styles['settings-note']} role={tone}>{message}</p>;

  return <PageFrame module="settings"><SettingsPage copy={uiCopy} tab="channelsAccounts" active="settings/connections" title={t.title} description={t.description} info={<InfoTip name={t.title}>{t.footnote}</InfoTip>} locale={locale}>
    <ConnectionManager locale={locale} statusLabels={statusLabels} sources={accounts.map(account => ({ ...account, platformName: providerName(account.provider) }))} canManage={canManage} platforms={connectable} initiallyOpen={params.select === '1'} initialSourceId={params.source} initialAction={params.action === 'disconnect' ? 'disconnect' : params.action === 'manage' ? 'manage' : undefined} />
    {notice('connected_partial', 'status', t.connectedPartial)}
    {notice('connected', 'status', t.connected)}
    {notice('oauth_cancelled', 'status', t.oauthCancelled)}
    {notice('connect_failed', 'alert', t.connectFailed)}
    {notice('oauth_invalid_state', 'alert', t.invalidState)}
    {notice('saved', 'status', t.saved)}
    {notice('failed', 'alert', t.failed)}
    {!accounts.length && !adRows.length ? <SettingsPanel title={t.noneTitle} detail={t.noneDetail}>
      <EmptyState title={t.noneTitle} icon={<IconPlugConnected />} action={connectable.length && canManage ? <a href="#connection-actions">{t.manageSelections}</a> : <a href="/settings/account">{t.account}</a>}>{canManage && connectable.length ? t.noneConnect : t.noneAvailable}</EmptyState>
    </SettingsPanel> : <>
    <div className={cardStyles.cards} role="list" aria-label={t.socialPanel}>
      {accounts.map(account => {
        const health = healthById.get(account.id)!;
        const state = connectionState(account, now);
        const enabled = account.targets.filter(target => target.enabled).length;
        return <article key={account.id} className={cardStyles.card} role="listitem" aria-label={account.name}>
          <div className={cardStyles.cardHead}>
            <div className={cardStyles.cardTitle}>
              <Avatar name={account.name} size="md" decorative />
              <div><h3>{account.name}</h3><p>{providerName(account.provider)} · {fill(t.added, { date: dayFormat.format(account.createdAt) })}</p></div>
            </div>
            <Status tone={state === 'connected' ? 'good' : 'warning'}>{statusLabels[state]}</Status>
          </div>
          <div className={cardStyles.cardMeta}>
            <span>{account.targets.length ? fill(c.inUse, { enabled, total: account.targets.length }) : t.noChannels}</span>
            {account.tokenExpiresAt && state === 'connected' ? <span>{text('token.expiresOn', { date: dayFormat.format(account.tokenExpiresAt) })}</span> : null}
          </div>
          {health.missing.length > 0 && <p className={cardStyles.cardMissing}>{fill(c.permissionsMissing, { labels: health.missing.map(group => group.label).join(', ') })}</p>}
          {health.grants.length > 0 ? <GrantChips grants={health.grants} locale={locale} label={c.permissions} /> : null}
          {canManage && <ChannelCardActions id={account.id} name={account.name} platformId={account.provider} needsReconnect={state !== 'connected' || health.missing.length > 0} manageLabel={c.manage} disconnectLabel={c.disconnect} actionsLabel={c.more} reconnectLabel={c.reconnect} busyLabel={text('reconnecting')} failedLabel={text('reconnectFailed')} />}
        </article>;
      })}
    </div>
    {!canManage && <p className={styles['settings-note']}>{t.managersOnly}</p>}
    <SettingsPanel title={c.adTitle} detail={c.adDetail}>
      <DataTable caption={c.adTitle} rows={adRows} rowKey={ad => ad.id} emptyMessage={t.noAds} emptyIcon={<IconPlugConnected />} columns={[
        { key: 'account', label: t.adAccount, render: ad => <><strong>{ad.name}</strong><span className={styles['settings-table__secondary']}>{ad.provider ? providerName(ad.provider) : t.platformMissing}</span></> },
        { key: 'profile', label: c.adLinked, render: ad => ad.owner ?? t.noLinkedProfile },
        { key: 'status', label: t.status, render: ad => <Status tone={ad.enabled && ad.state === 'connected' ? 'good' : 'warning'}>{!ad.enabled ? c.inUseOff : ad.state && ad.state !== 'connected' ? statusLabels[ad.state] : c.inUseOn}</Status> },
        ...(canManage ? [{ key: 'actions', label: t.actions, render: (ad: (typeof adRows)[number]) => ad.socialAccountId && socialById.has(ad.socialAccountId) ? <a href={`/settings/channels?source=${encodeURIComponent(ad.socialAccountId)}&action=manage`}>{c.adManage}</a> : t.reconnectFirst }] : []),
      ]} />
    </SettingsPanel>
    </>}
    <SettingsPanel title={c.groupsTitle} detail={c.groupsDetail}><a href="/settings/channels/groups">{c.groupsOpen}</a></SettingsPanel>
  </SettingsPage></PageFrame>;
}
