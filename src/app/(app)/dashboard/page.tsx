import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Icon, type IconName } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import { FeedPost } from '@/components/FeedPost';
import { PagesHub } from '@/components/PagesHub';
import { GettingStarted } from '@/components/GettingStarted';
import { feedLinkOf, feedMediaOf } from '@/lib/feed';
import { requirePage } from '@/lib/auth';
import { postScope, postTargetScope, targetScope } from '@/lib/page-access';
import { screenMetadata } from '@/lib/metadata';
import { summariseConnections } from '@/lib/connections';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { formatInZone, relativeTime, appLocale } from '@/lib/time';
import { publishedTotals, recentOutcomes } from '@/lib/analytics';
import { canManageAccounts, canManageInstance } from '@/lib/constants';
import { readSetupState } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('dashboard.title');
}


export default async function DashboardPage() {
  const auth = await requirePage();
  const t = await getTranslations('dashboard');
  const tSetup = await getTranslations('setup');
  const tPosts = await getTranslations('posts');
  const tCommon = await getTranslations('common');
  const workspaceId = auth.workspace.id;
  const now = new Date();
  // A member limited to some Pages sees their Pages' numbers only.
  const scopeIds = auth.pageScope.all ? undefined : auth.pageScope.ids;
  const postsIn = postScope(auth.pageScope);

  const [upcoming, recent, counts, targetCount, staleAccounts, failures, totals, health] =
    await Promise.all([
    prisma.post.findMany({
      where: { workspaceId, status: { in: ['scheduled', 'publishing'] }, scheduledAt: { gte: now }, ...postsIn },
      include: { targets: { include: { target: { select: { name: true, pictureUrl: true } } } } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    }),
    recentOutcomes(workspaceId, 5, scopeIds),
    prisma.post.groupBy({ by: ['status'], where: { workspaceId, ...postsIn }, _count: true }),
    prisma.target.count({ where: { workspaceId, enabled: true, canPublish: true, ...targetScope(auth.pageScope) } }),
    prisma.socialAccount.findMany({
      where: { workspaceId, invalidatedAt: { not: null } },
      select: { id: true, name: true, invalidReason: true },
    }),
    prisma.postTarget.count({ where: { status: 'failed', post: { workspaceId }, ...postTargetScope(auth.pageScope) } }),
      publishedTotals(workspaceId, scopeIds),
      summariseConnections(workspaceId, { now, warnWithinDays: env.tokenWarningDays }),
    ]);

  // An unfinished installation otherwise greets its owner with four zeros and
  // no hint why. Setup belongs to the installation owner, so only they are pointed at it.
  const setup = canManageInstance(auth) ? await readSetupState(workspaceId) : null;
  const stepsLeft = setup?.steps.filter((step) => !step.optional && !step.done) ?? [];

  const countFor = (status: string) => counts.find((entry) => entry.status === status)?._count ?? 0;

  const stats: Array<{ label: string; value: number; icon: IconName; href: string }> = [
    {
      label: t('scheduled'),
      value: countFor('scheduled') + countFor('publishing'),
      icon: 'clock',
      href: '/posts?status=scheduled',
    },
    {
      label: t('published'),
      value: countFor('published') + countFor('partially_failed'),
      icon: 'check',
      href: '/posts?status=published',
    },
    { label: t('drafts'), value: countFor('draft'), icon: 'compose', href: '/posts?status=draft' },
    { label: t('destinations'), value: targetCount, icon: 'connections', href: '/connections' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {formatInZone(now, auth.workspace.timezone, 'EEEE d MMMM yyyy, HH:mm')} ·{' '}
            {auth.workspace.timezone}
          </p>
        </div>
        <Link href="/compose" className="btn-primary">
          <Icon name="plus" size={16} /> {t('newPost')}
        </Link>
      </header>

      {setup && !setup.complete && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <p className="flex items-center gap-2">
            <Icon name="settings" size={16} />
            {stepsLeft.length > 0
              ? t('setupStepsLeft', {
                  count: stepsLeft.length,
                  next: tSetup(`steps.${stepsLeft[0]!.id}.title`),
                })
              : t('setupCheckFailing')}
          </p>
          <Link href="/setup" className="btn-primary">
            {t('continueSetup')}
          </Link>
        </div>
      )}

      {!(setup && !setup.complete) && <GettingStarted workspaceId={workspaceId} />}

      {staleAccounts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="flex items-center gap-2 font-medium">
            <Icon name="warning" size={16} /> {t('connectionsNeedAttention')}
          </p>
          <ul className="mt-1 list-inside list-disc">
            {staleAccounts.map((account) => (
              <li key={account.id}>
                {account.name}: {account.invalidReason ?? t('reconnectRequired')}
              </li>
            ))}
          </ul>
          <Link href="/connections" className="mt-2 inline-block font-medium underline">
            {t('fixOnAccounts')}
          </Link>
        </div>
      )}

      {/* A dead token has a banner above. This one is the warning *before* it
          happens, which is the difference between a five-minute reconnection
          and a week of silently failing posts. */}
      {staleAccounts.length === 0 && health.expiring > 0 && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="clock" size={16} />
          {t('tokensExpiring', { count: health.expiring, days: env.tokenWarningDays })}{' '}
          <Link href="/connections" className="font-medium underline">
            {t('reviewConnections')}
          </Link>
        </div>
      )}

      {failures > 0 && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <Icon name="error" size={16} />
          {t('destinationsFailed', { count: failures })}{' '}
          <Link href="/posts?status=failed" className="font-medium underline">
            {t('reviewAndRetry')}
          </Link>
        </div>
      )}

      <PagesHub
        workspaceId={workspaceId}
        timeZone={auth.workspace.timezone}
        canConnect={canManageAccounts(auth.role)}
        scope={auth.pageScope}
        now={now}
      />

      {/* Each tile is a link to the list it counts: a number nobody can act on
          is decoration, and the count is exactly the filter someone wants. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="card group p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
          >
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
              <Icon name={stat.icon} size={14} className="text-slate-400 group-hover:text-brand-500" />
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 sm:text-3xl">{stat.value}</p>
          </Link>
        ))}
      </div>

      {/* Shown once anything at all has come back. Impressions alone cannot
          gate it: Meta retired the metric, so a Page synced since reads zero
          there while its reach and comments are real. */}
      {totals.impressions + totals.reach + totals.reactions + totals.comments > 0 && (
        <div className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon name="analytics" className="text-slate-400" /> {t('reachAndEngagement')}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {t('reachSubtitle')}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                // Only where some were recorded: a Page synced since Meta
                // retired the metric reads a flat zero that means "not
                // reported", not "nobody saw it".
                ...(totals.impressions > 0 ? [[t('impressions'), totals.impressions] as const] : []),
                [t('peopleReached'), totals.reach],
                [t('reactions'), totals.reactions],
                [t('comments'), totals.comments],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  {value.toLocaleString(appLocale())}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Two feeds side by side, each post drawn as the Page's followers
            will see it — or saw it. */}
        <section className="space-y-3" aria-labelledby="dash-next">
          <h2 id="dash-next" className="flex items-center gap-2 px-1 text-[17px] font-bold text-slate-900">
            <Icon name="clock" className="text-slate-500" /> {t('goingOutNext')}
          </h2>
          {upcoming.length === 0 ? (
            <p className="card p-5 text-sm text-slate-600">
              {t('nothingScheduled')}{' '}
              <Link href="/compose" className="font-medium text-brand-600 hover:underline">
                {t('writeAPost')}
              </Link>
              .
            </p>
          ) : (
            upcoming.map((post) => (
              <FeedPost
                key={post.id}
                compact
                clamp
                href={`/compose?post=${post.id}`}
                author={feedAuthor(post.targets)}
                meta={
                  post.scheduledAt
                    ? `${formatInZone(post.scheduledAt, auth.workspace.timezone)} · ${relativeTime(post.scheduledAt, now)}`
                    : t('noTimeSet')
                }
                badge={<StatusBadge status={post.status} />}
                message={post.message}
                emptyText={tPosts('mediaOnly')}
                media={feedMediaOf(post.media)}
                link={post.link}
                linkPreview={feedLinkOf(post.linkPreview)}
                seeMore={tCommon('seeMore')}
              />
            ))
          )}
        </section>

        <section className="space-y-3" aria-labelledby="dash-recent">
          <h2 id="dash-recent" className="flex items-center gap-2 px-1 text-[17px] font-bold text-slate-900">
            <Icon name="posts" className="text-slate-500" /> {t('recentlyPublished')}
          </h2>
          {recent.length === 0 ? (
            <p className="card p-5 text-sm text-slate-600">{t('nothingPublished')}</p>
          ) : (
            recent.map((post) => (
              <FeedPost
                key={post.id}
                compact
                clamp
                href="/posts?status=published"
                author={feedAuthor(post.targets)}
                meta={post.publishedAt ? relativeTime(post.publishedAt, now) : '—'}
                badge={<StatusBadge status={post.status} />}
                message={post.message}
                emptyText={tPosts('mediaOnly')}
                media={feedMediaOf(post.media)}
                link={post.link}
                linkPreview={feedLinkOf(post.linkPreview)}
                seeMore={tCommon('seeMore')}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

/** The Page a post goes to, or every Page's name with the first one's photo. */
function feedAuthor(targets: Array<{ target: { name: string; pictureUrl: string | null } }>) {
  return {
    name: targets.map((entry) => entry.target.name).join(', '),
    pictureUrl: targets[0]?.target.pictureUrl ?? null,
  };
}

