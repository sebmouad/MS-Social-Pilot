import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { AnalyticsClient } from '@/components/AnalyticsClient';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import { BreakdownBars } from '@/components/BreakdownBars';
import { PagePicker } from '@/components/PagePicker';
import { PostAnalyticsTable } from '@/components/PostAnalyticsTable';
import { requirePage } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  readAudience,
  readAvailability,
  readInteractions,
  readPostAnalytics,
  readStoredAnalytics,
} from '@/lib/analytics';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('analytics');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  // Groups have no insights edge, so they are not offered here at all.
  const pages = await prisma.target.findMany({
    where: { workspaceId: auth.workspace.id, type: TargetType.page },
    orderBy: { name: 'asc' },
  });

  if (pages.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        </header>
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">{t('noPages')}</p>
          <Link href="/accounts" className="btn-primary mt-4 inline-flex">
            {t('connect')}
          </Link>
        </div>
      </div>
    );
  }

  const requested = first(params.target);
  const selected = pages.find((page) => page.id === requested) ?? pages[0]!;

  const days = Number.parseInt(first(params.days) ?? '30', 10);
  const window = Number.isFinite(days) && days > 0 && days <= 365 ? days : 30;
  const to = new Date();
  const from = new Date(to.getTime() - window * 24 * 60 * 60 * 1000);

  const view = first(params.view) ?? 'overview';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('subtitle')} · {formatInZone(from, timezone, 'd MMM')} –{' '}
            {formatInZone(to, timezone, 'd MMM yyyy')}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <PagePicker
            pages={pages.map((page) => ({ id: page.id, name: page.name }))}
            selectedId={selected.id}
            days={window}
          />

          <div className="flex gap-1">
            {[7, 30, 90].map((option) => (
              <Link
                key={option}
                href={`/analytics?target=${selected.id}&days=${option}`}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  option === window ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t('lastDays', { count: option })}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <AnalyticsTabs current={view} />

      {view === 'posts' && (
        <PostAnalyticsTable
          posts={(
            await readPostAnalytics({
              workspaceId: auth.workspace.id,
              targetId: selected.id,
              from,
              to,
            })
          ).map((post) => ({
            postTargetId: post.postTargetId,
            message: post.message,
            targetName: post.targetName,
            publishedLabel: post.publishedAt ? formatInZone(post.publishedAt, timezone) : null,
            url: post.url,
            impressions: post.impressions,
            reach: post.reach,
            engagedUsers: post.engagedUsers,
            reactions: post.reactions,
            comments: post.comments,
            shares: post.shares,
            clicks: post.clicks,
            negativeFeedback: post.negativeFeedback,
            videoViews: post.videoViews,
            organic: post.organic,
            paid: post.paid,
            engagementRate: post.engagementRate,
          }))}
        />
      )}

      {view === 'interactions' && <InteractionsView
        workspaceId={auth.workspace.id}
        targetId={selected.id}
        from={from}
        to={to}
      />}

      {view === 'audience' && <AudienceView targetId={selected.id} from={from} to={to} />}

      {view === 'overview' && (
        <AnalyticsClient
          targetId={selected.id}
          targetName={selected.name}
          series={await readStoredAnalytics({ targetId: selected.id, from, to })}
          availability={(await readAvailability(selected.id)).map((entry) => ({
            metric: entry.metric,
            label: entry.label,
            period: entry.period,
            available: entry.available,
            reason: entry.reason,
            description: entry.description,
          }))}
          profile={{
            fanCount: selected.fanCount,
            followersCount: selected.followersCount,
            talkingAboutCount: selected.talkingAboutCount,
            syncedLabel: selected.profileSyncedAt
              ? formatInZone(selected.profileSyncedAt, timezone)
              : null,
          }}
        />
      )}
    </div>
  );
}


/** How people interacted: reaction and click splits, plus totals. */
async function InteractionsView({
  workspaceId,
  targetId,
  from,
  to,
}: {
  workspaceId: string;
  targetId: string;
  from: Date;
  to: Date;
}) {
  const t = await getTranslations('analytics');
  const summary = await readInteractions({ workspaceId, targetId, from, to });

  const cards = [
    { label: t('reactions'), value: summary.totals.reactions },
    { label: t('comments'), value: summary.totals.comments },
    { label: t('shares'), value: summary.totals.shares },
    { label: t('clicks'), value: summary.totals.clicks },
    { label: t('engaged'), value: summary.totals.engagedUsers },
    { label: t('negativeFeedback'), value: summary.totals.negativeFeedback },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {card.value.toLocaleString()}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownBars
          title={t('reactionsByType')}
          description={t('reactionsByTypeHint')}
          data={summary.reactionsByType}
          formatKey={(key) => key.replace(/^post_reactions_|_total$/g, '')}
        />
        <BreakdownBars
          title={t('clicksByType')}
          description={t('clicksByTypeHint')}
          data={summary.clicksByType}
        />
      </div>
    </div>
  );
}

/** Who the audience is, and how it changed over the window. */
async function AudienceView({ targetId, from, to }: { targetId: string; from: Date; to: Date }) {
  const t = await getTranslations('analytics');
  const audience = await readAudience({ targetId, from, to });

  const cards = [
    { label: t('fans'), value: audience.fans },
    { label: t('followers'), value: audience.followers },
    { label: t('talkingAbout'), value: audience.talkingAbout },
    { label: t('newLikes'), value: audience.adds },
    { label: t('lostLikes'), value: audience.removes },
    { label: t('netChange'), value: audience.net },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {card.value === null ? '—' : card.value.toLocaleString()}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownBars title={t('byCountry')} data={audience.byCountry} />
        <BreakdownBars title={t('byCity')} data={audience.byCity} />
        <BreakdownBars title={t('byGenderAge')} data={audience.byGenderAge} />
        <BreakdownBars title={t('byLocale')} data={audience.byLocale} />
      </div>

      <p className="text-xs text-slate-500">{t('audienceHint')}</p>
    </div>
  );
}
