import { PlanMeter } from '@/components/PlanMeter';
import { planUsage } from '@/lib/plans';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getTranslations } from 'next-intl/server';

import { ConnectionsClient } from '@/components/ConnectionsClient';
import { Icon } from '@/components/Icon';
import { OtherNetworks } from '@/components/OtherNetworks';
import { SidebarDock } from '@/components/SidebarDock';
import { NETWORK_KEYS, NETWORK_LABELS, isNetworkKey, networkAvailable, type NetworkKey } from '@/lib/networks';
import { includedPlatforms } from '@/lib/plans';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { canManageAccounts } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('connections.title');
}


/**
 * Every connection this workspace has, and the health of each.
 *
 * One screen rather than one per provider, because the failure they share is
 * the same: a token dies and everything downstream of it stops quietly. Pages,
 * Groups, Instagram accounts and ad accounts all hang off a connected Facebook
 * user, so they belong under the credential that reaches them.
 */
export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const meter = await planUsage(auth.workspace.id, 'channels');
  const tPlan = await getTranslations('planMeter');
  const t = await getTranslations('connections');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const [allAccounts, instagram, ads, orphans] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { workspaceId: auth.workspace.id },
      include: {
        targets: {
          orderBy: [{ type: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.instagramAccount.findMany({
      where: { workspaceId: auth.workspace.id },
      include: { target: { select: { name: true } } },
      orderBy: { username: 'asc' },
    }),
    prisma.adAccount.findMany({
      where: { workspaceId: auth.workspace.id },
      orderBy: { name: 'asc' },
    }),
    // Left behind when their account was disconnected: shown so they can be removed.
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, socialAccountId: null },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const targetView = (target: (typeof orphans)[number]) => ({
    id: target.id,
    name: target.name,
    type: target.type,
    pictureUrl: target.pictureUrl,
    enabled: target.enabled,
    canPublish: target.canPublish,
    publishBlockerCode: target.publishBlockerCode,
    followers: target.followersCount ?? target.fanCount,
    lastSyncedLabel: target.lastSyncedAt ? formatInZone(target.lastSyncedAt, timezone) : null,
  });

  const canManage = canManageAccounts(auth.role);
  const accounts = allAccounts.filter((account) => account.provider === 'facebook');
  const networkAccounts = allAccounts.filter((account) => isNetworkKey(account.provider));
  const included = await includedPlatforms(auth.workspace.id);
  const offeredNetworks = NETWORK_KEYS.map((key) => ({
    key,
    label: NETWORK_LABELS[key],
    available: included.has(key) && networkAvailable(key),
  }));
  const visibleNetworks = offeredNetworks.filter((entry) => entry.available || networkAccounts.some((account) => account.provider === entry.key));
  const networkNotice = first(params.network);

  return (
    <div className="space-y-6">
      <ScreenHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canManage && (
            // A full navigation, not fetch: the route redirects to Facebook.
            <a href="/api/facebook/connect" className="btn-primary">
              <Icon name="plus" size={16} /> {t('connect')}
            </a>
          )
        }
      />
      {meter.limit !== null && <PlanMeter label={tPlan('channels', { used: meter.used, limit: meter.limit })} used={meter.used} limit={meter.limit} />}
      {canManage && first(params.select) === '1' && (
        <p role="status" className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800">
          {t('selectChannelsHint')}
        </p>
      )}

      {(['connected', 'warning', 'error'] as const).map((kind) => {
        const value = first(params[kind]);
        // Another network's answer is shown in its own section below.
        if (!value || networkNotice) return null;
        const tone =
          kind === 'connected'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : kind === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-red-200 bg-red-50 text-red-700';
        return (
          <p key={kind} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}>
            <Icon name={kind === 'connected' ? 'check' : kind === 'warning' ? 'warning' : 'error'} />
            {value}
          </p>
        );
      })}

      {/* A long screen: chips jump to each part, as Simplified does. */}
      <SidebarDock><nav aria-label={t('jumpTo')} className="flex flex-col gap-1">
        {[
          ...(accounts.length > 0
            ? [
                { href: '#facebook', label: t('jump_facebook') },
                ...(env.instagramEnabled && included.has('instagram') || instagram.length > 0 ? [{ href: '#instagram', label: t('jump_instagram') }] : []),
                ...(env.adsEnabled && auth.features.includes('ads/performance') || ads.length > 0 ? [{ href: '#ads', label: t('jump_ads') }] : []),
              ]
            : []),
          ...(visibleNetworks.length > 0 ? [{ href: '#networks', label: t('jump_networks') }] : []),
        ].map((chip) => (
          <a
            key={chip.href}
            href={chip.href}
            className="rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            {chip.label}
          </a>
        ))}
      </nav></SidebarDock>


      {accounts.length === 0 && orphans.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon name="connections" size={24} />
          </span>
          <h2 className="text-sm font-semibold text-slate-900">{t('noneTitle')}</h2>
          <p className="max-w-lg text-sm text-slate-600">{t('noneBody')}</p>
          {canManage && (
            <a href="/api/facebook/connect" className="btn-primary">
              <Icon name="plus" size={16} /> {t('connect')}
            </a>
          )}
        </div>
      ) : (
        <>
        <ConnectionsClient
          canManage={canManage}
          instagramEnabled={env.instagramEnabled && included.has('instagram')}
          adsEnabled={env.adsEnabled && auth.features.includes('ads/performance')}
          orphans={orphans.map(targetView)}
          connections={accounts.map((account) => ({
            id: account.id,
            name: account.name,
            pictureUrl: account.pictureUrl,
            needsReconnect: account.invalidatedAt !== null,
            lastSyncedLabel: account.lastSyncedAt
              ? formatInZone(account.lastSyncedAt, timezone)
              : null,
            targets: account.targets.map(targetView),
          }))}
          instagram={instagram.map((account) => ({
            id: account.id,
            label: `@${account.username}`,
            detail: account.target?.name
              ? t('viaPage', { page: account.target.name })
              : t('noLinkedPage'),
            enabled: account.enabled,
            connected: account.socialAccountId !== null,
            lastSyncedLabel: account.lastSyncedAt
              ? formatInZone(account.lastSyncedAt, timezone)
              : null,
          }))}
          ads={ads.map((account) => ({
            id: account.id,
            label: account.name,
            detail: account.currency ?? null,
            enabled: account.enabled,
            connected: account.socialAccountId !== null,
            lastSyncedLabel: account.lastSyncedAt
              ? formatInZone(account.lastSyncedAt, timezone)
              : null,
          }))}
        />
        </>
      )}

      {visibleNetworks.length > 0 && <div id="networks" className="scroll-mt-20">
      <OtherNetworks
        canManage={canManage}
        initialDialog={first(params.connect)}
        notice={
          networkNotice && isNetworkKey(networkNotice)
            ? { network: networkNotice, error: first(params.error) ?? null, connected: first(params.connected) ?? null }
            : null
        }
        networks={visibleNetworks}
        accounts={networkAccounts.map((account) => ({
          id: account.id,
          network: account.provider as NetworkKey,
          name: account.name,
          pictureUrl: account.pictureUrl,
          invalidReason: account.invalidatedAt ? t('reconnectRequired') : null,
          lastSyncedLabel: account.lastSyncedAt ? formatInZone(account.lastSyncedAt, timezone) : null,
          targets: account.targets.map((target) => ({ id: target.id, name: target.name, category: target.category, enabled: target.enabled })),
        }))}
      />
      </div>}


    </div>
  );
}
