import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { StatusBadge } from '@/components/StatusBadge';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseInsights } from '@/lib/json';
import { sumInsights } from '@/lib/facebook/insights';
import { formatInZone, relativeTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const auth = await requireAuth();
  const t = await getTranslations('dashboard');
  const tPosts = await getTranslations('posts');
  const workspaceId = auth.workspace.id;
  const now = new Date();

  const [upcoming, recent, counts, targetCount, staleAccounts, failures, insightRows] = await Promise.all([
    prisma.post.findMany({
      where: { workspaceId, status: { in: ['scheduled', 'publishing'] }, scheduledAt: { gte: now } },
      include: { targets: { include: { target: { select: { name: true } } } } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    }),
    prisma.post.findMany({
      where: { workspaceId, status: { in: ['published', 'partially_failed', 'failed'] } },
      include: { targets: { include: { target: { select: { name: true } } } } },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    }),
    prisma.post.groupBy({ by: ['status'], where: { workspaceId }, _count: true }),
    prisma.target.count({ where: { workspaceId, enabled: true, canPublish: true } }),
    prisma.socialAccount.findMany({
      where: { workspaceId, invalidatedAt: { not: null } },
      select: { id: true, name: true, invalidReason: true },
    }),
    prisma.postTarget.count({ where: { status: 'failed', post: { workspaceId } } }),
    prisma.postTarget.findMany({
      where: { status: 'published', post: { workspaceId } },
      select: { insights: true },
      take: 500,
    }),
  ]);

  const countFor = (status: string) => counts.find((entry) => entry.status === status)?._count ?? 0;
  const totals = sumInsights(insightRows.map((row) => parseInsights(row.insights)));

  const stats = [
    { label: t('scheduled'), value: countFor('scheduled') + countFor('publishing') },
    { label: t('published'), value: countFor('published') + countFor('partially_failed') },
    { label: t('drafts'), value: countFor('draft') },
    { label: t('destinations'), value: targetCount },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {formatInZone(now, auth.workspace.timezone, 'EEEE d MMMM yyyy, HH:mm')} ·{' '}
            {auth.workspace.timezone}
          </p>
        </div>
        <Link href="/compose" className="btn-primary">
          {t('newPost')}
        </Link>
      </header>

      {staleAccounts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">{t('connectionsNeedAttention')}</p>
          <ul className="mt-1 list-inside list-disc">
            {staleAccounts.map((account) => (
              <li key={account.id}>
                {account.name}: {account.invalidReason ?? 'Reconnect required.'}
              </li>
            ))}
          </ul>
          <Link href="/accounts" className="mt-2 inline-block font-medium underline">
            {t('fixOnAccounts')}
          </Link>
        </div>
      )}

      {failures > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('destinationsFailed', { count: failures })}{' '}
          <Link href="/posts?status=failed" className="font-medium underline">
            {t('reviewAndRetry')}
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>

      {(totals.impressions ?? 0) + (totals.reactions ?? 0) > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('reachAndEngagement')}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {t('reachSubtitle')}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              [t('impressions'), totals.impressions],
              [t('peopleReached'), totals.reach],
              [t('reactions'), totals.reactions],
              [t('comments'), totals.comments],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  {typeof value === 'number' ? value.toLocaleString() : '—'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">{t('goingOutNext')}</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('nothingScheduled')}{' '}
              <Link href="/compose" className="font-medium text-brand-600 hover:underline">
                {t('writeAPost')}
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((post) => (
                <li key={post.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 flex-1 text-sm text-slate-800">
                      {post.message || post.link || tPosts('mediaOnly')}
                    </p>
                    <StatusBadge status={post.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {post.scheduledAt
                      ? `${formatInZone(post.scheduledAt, auth.workspace.timezone)} · ${relativeTime(post.scheduledAt, now)}`
                      : 'No time set'}{' '}
                    · {post.targets.map((target) => target.target.name).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">{t('recentlyPublished')}</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">{t('nothingPublished')}</p>
          ) : (
            <ul className="space-y-3">
              {recent.map((post) => (
                <li key={post.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 flex-1 text-sm text-slate-800">
                      {post.message || post.link || tPosts('mediaOnly')}
                    </p>
                    <StatusBadge status={post.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {post.publishedAt ? relativeTime(post.publishedAt, now) : '—'} ·{' '}
                    {post.targets.map((target) => target.target.name).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
