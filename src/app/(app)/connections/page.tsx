import { getTranslations } from 'next-intl/server';

import { ConnectionHealth } from '@/components/ConnectionHealth';
import { ConnectionsClient } from '@/components/ConnectionsClient';
import { Icon } from '@/components/Icon';
import { OtherNetworks } from '@/components/OtherNetworks';
import { NETWORK_KEYS, NETWORK_LABELS, isNetworkKey, networkAvailable, type NetworkKey } from '@/lib/networks';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { canManageAccounts } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { formatInZone } from '@/lib/time';
import { abilitiesOf } from '@/lib/scope-abilities';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('connections.title');
}


const DAY_MS = 24 * 60 * 60 * 1000;

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
  const t = await getTranslations('connections');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;
  const now = Date.now();

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
    publishBlocker: target.publishBlocker,
    publishBlockerCode: target.publishBlockerCode,
    hasOwnToken: target.accessToken !== null,
    followers: target.followersCount ?? target.fanCount,
    lastSyncedLabel: target.lastSyncedAt ? formatInZone(target.lastSyncedAt, timezone) : null,
  });

  const canManage = canManageAccounts(auth.role);
  const accounts = allAccounts.filter((account) => account.provider === 'facebook');
  const networkAccounts = allAccounts.filter((account) => isNetworkKey(account.provider));
  const networkNotice = first(params.network);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        </div>

        {canManage && (
          // A full navigation, not fetch: the route redirects to Facebook.
          <a href="/api/facebook/connect" className="btn-primary">
            <Icon name="plus" size={16} /> {t('connect')}
          </a>
        )}
      </header>

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
      <nav aria-label={t('jumpTo')} className="flex flex-wrap gap-2">
        {[
          ...(accounts.length > 0
            ? [
                { href: '#health', label: t('jump_health') },
                { href: '#facebook', label: t('jump_facebook') },
                { href: '#instagram', label: t('jump_instagram') },
                { href: '#ads', label: t('jump_ads') },
              ]
            : []),
          { href: '#networks', label: t('jump_networks') },
        ].map((chip) => (
          <a
            key={chip.href}
            href={chip.href}
            className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-surface hover:bg-slate-50"
          >
            {chip.label}
          </a>
        ))}
      </nav>


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
        {/* Above the list: the answer to "is it working" comes before the
            inventory of what is connected. */}
        {accounts.length > 0 && (
          <div id="health" className="scroll-mt-20">
            <ConnectionHealth canManage={canManage} />
          </div>
        )}

        <ConnectionsClient
          canManage={canManage}
          instagramEnabled={env.instagramEnabled}
          adsEnabled={env.adsEnabled}
          orphans={orphans.map(targetView)}
          connections={accounts.map((account) => ({
            id: account.id,
            name: account.name,
            pictureUrl: account.pictureUrl,
            providerUserId: account.providerUserId,
            abilities: abilitiesOf(
              account.scopes.split(',').map((scope) => scope.trim()).filter(Boolean),
              env.facebookScopes,
            ),
            tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
            // Days rather than a date: "expires 14 Sep" makes the reader do
            // the arithmetic before they know whether to act.
            daysLeft: account.tokenExpiresAt
              ? Math.max(0, Math.ceil((account.tokenExpiresAt.getTime() - now) / DAY_MS))
              : null,
            invalidReason: account.invalidatedAt
              ? account.invalidReason ?? t('reconnectRequired')
              : null,
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
            lastSyncedLabel: account.lastSyncedAt
              ? formatInZone(account.lastSyncedAt, timezone)
              : null,
          }))}
          ads={ads.map((account) => ({
            id: account.id,
            label: account.name,
            detail: [account.actId, account.currency].filter(Boolean).join(' · '),
            enabled: account.enabled,
            lastSyncedLabel: account.lastSyncedAt
              ? formatInZone(account.lastSyncedAt, timezone)
              : null,
          }))}
        />
        </>
      )}

      <div id="networks" className="scroll-mt-20">
      <OtherNetworks
        canManage={canManage}
        isOwner={auth.role === 'owner'}
        notice={
          networkNotice && isNetworkKey(networkNotice)
            ? { network: networkNotice, error: first(params.error) ?? null, connected: first(params.connected) ?? null }
            : null
        }
        networks={NETWORK_KEYS.map((key) => ({ key, label: NETWORK_LABELS[key], available: networkAvailable(key) }))}
        accounts={networkAccounts.map((account) => ({
          id: account.id,
          network: account.provider as NetworkKey,
          name: account.name,
          pictureUrl: account.pictureUrl,
          invalidReason: account.invalidatedAt ? account.invalidReason ?? t('reconnectRequired') : null,
          targets: account.targets.map((target) => ({ id: target.id, name: target.name, category: target.category, enabled: target.enabled })),
        }))}
      />
      </div>

      {!env.groupsEnabled && (
        <p className="flex items-start gap-2 text-xs text-slate-500">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          {t('groupsOff')}
        </p>
      )}
    </div>
  );
}
