import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { AnalyticsClient } from '@/components/AnalyticsClient';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import { BreakdownBars } from '@/components/BreakdownBars';
import { CommentsPanel } from '@/components/CommentsPanel';
import { InboxPanel } from '@/components/InboxPanel';
import { ExportMenu } from '@/components/ExportMenu';
import { PagePicker } from '@/components/PagePicker';
import { PostAnalyticsTable } from '@/components/PostAnalyticsTable';
import { StatTile } from '@/components/charts/StatTile';
import { SyncButton } from '@/components/SyncButton';
import { requirePage } from '@/lib/auth';
import { canDeleteComments, canModerateComments } from '@/lib/constants';
import { Pagination } from '@/components/Pagination';
import { pageHref, pageNumber, paginate } from '@/lib/paging';
import { prisma } from '@/lib/prisma';
import {
  readAudience,
  readAvailability,
  readCoverage,
  readInteractions,
  readPostAnalytics,
  readStoredAnalytics,
} from '@/lib/analytics';
import {
  countComments,
  readComments,
  readConversations,
  readExternalPosts,
  readReviews,
  readVideos,
} from '@/lib/engagement';
import { listInstagramAccounts, readInstagramInsights, readInstagramMedia } from '@/lib/instagram';
import { listAdAccounts, readAdSummary, readCampaigns } from '@/lib/ads';
import { formatInZone } from '@/lib/time';
import { ExternalLink } from '@/components/ExternalLink';

export const dynamic = 'force-dynamic';

/** A query parameter that may arrive repeated. */
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('analytics');
  const params = await searchParams;
  const timezone = auth.workspace.timezone;


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
          <Link href="/connections" className="btn-primary mt-4 inline-flex">
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
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('subtitle')} · {formatInZone(from, timezone, 'd MMM')} –{' '}
          {formatInZone(to, timezone, 'd MMM yyyy')}
        </p>
      </header>

      {/* One filter row, above everything it scopes: the date range first,
          because it is the control every reader reaches for. Per-view filters
          would let two panels disagree about which window they are showing. */}
      <div className="filter-row">
        <div className="segmented">
          {[7, 30, 90].map((option) => (
            <Link
              key={option}
              href={`/analytics?view=${view}&target=${selected.id}&days=${option}`}
              className={`segmented-item ${option === window ? 'segmented-item-active' : ''}`}
            >
              {t('lastDays', { count: option })}
            </Link>
          ))}
        </div>

        <PagePicker
          pages={pages.map((page) => ({ id: page.id, name: page.name }))}
          selectedId={selected.id}
          days={window}
          view={view}
        />

        <div className="ml-auto">
          <ExportMenu targetId={selected.id} from={from.toISOString()} to={to.toISOString()} />
        </div>
      </div>

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

      {view === 'videos' && (
        <VideosView workspaceId={auth.workspace.id} targetId={selected.id} timezone={timezone} />
      )}

      {view === 'comments' && (
        <CommentsView
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          timezone={timezone}
          canModerate={canModerateComments(auth.role)}
          canDelete={canDeleteComments(auth.role)}
          params={params}
        />
      )}

      {view === 'reviews' && (
        <ReviewsView workspaceId={auth.workspace.id} targetId={selected.id} timezone={timezone} />
      )}

      {view === 'inbox' && (
        <InboxView
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          timezone={timezone}
          canReply={canModerateComments(auth.role)}
        />
      )}

      {view === 'external' && (
        <ExternalView
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          from={from}
          to={to}
          timezone={timezone}
        />
      )}

      {view === 'instagram' && (
        <InstagramView
          workspaceId={auth.workspace.id}
          accountId={first(params.account)}
          from={from}
          to={to}
          timezone={timezone}
        />
      )}

      {view === 'ads' && (
        <AdsView
          workspaceId={auth.workspace.id}
          level={first(params.adLevel)}
          from={from}
          to={to}
          timezone={timezone}
        />
      )}

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
            deprecatedFrom: entry.deprecatedFrom,
          }))}
          coverage={(await readCoverage(selected.id)).map((row) => ({
            ...row,
            levelLabel: t(`level_${row.level}`),
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
      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <StatTile key={card.label} label={card.label} value={card.value} />
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
      {/* Losing likes is not an achievement, whichever way the arrow points. */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <StatTile
            key={card.label}
            label={card.label}
            value={card.value}
            upIsGood={card.label !== t('lostLikes')}
          />
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

// ---------------------------------------------------------------------------
// Graph edges beyond /insights
// ---------------------------------------------------------------------------

/** Videos with their video-level figures, which aggregate across crossposts. */
async function VideosView({
  workspaceId,
  targetId,
  timezone,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
}) {
  const t = await getTranslations('engagement');
  const videos = await readVideos({ workspaceId, targetId });

  if (videos.length === 0) {
    return <EmptyEdge message={t('noVideos')} targetId={targetId} label={t('refresh')} />;
  }

  const seconds = (milliseconds: number | null) =>
    milliseconds === null ? '—' : `${Math.round(milliseconds / 1000).toLocaleString()}s`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('videosHint')}</p>
        <SyncButton endpoint="/api/engagement/sync" body={{ targetId }} label={t('refresh')} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t('video')}</th>
              <th className="px-4 py-3 text-right">{t('views')}</th>
              <th className="px-4 py-3 text-right">{t('uniqueViews')}</th>
              <th className="px-4 py-3 text-right">{t('completeViews')}</th>
              <th className="px-4 py-3 text-right">{t('avgWatch')}</th>
              <th className="px-4 py-3 text-right">{t('totalWatch')}</th>
              <th className="px-4 py-3 text-right">{t('metricsCount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {videos.map((video) => (
              <tr key={video.id}>
                <td className="max-w-xs px-4 py-3">
                  <p className="truncate font-medium text-slate-900" title={video.title}>
                    {video.permalink ? (
                      <ExternalLink href={video.permalink} className="hover:underline">
                        {video.title}
                      </ExternalLink>
                    ) : (
                      video.title
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {video.targetName} · {formatInZone(video.createdTime, timezone)}
                  </p>
                </td>
                <td className="px-4 py-3 text-right">{video.views?.toLocaleString() ?? '—'}</td>
                <td className="px-4 py-3 text-right">{video.uniqueViews?.toLocaleString() ?? '—'}</td>
                <td className="px-4 py-3 text-right">{video.completeViews?.toLocaleString() ?? '—'}</td>
                <td className="px-4 py-3 text-right">{seconds(video.avgTimeWatchedMs)}</td>
                <td className="px-4 py-3 text-right">{seconds(video.totalWatchTimeMs)}</td>
                <td className="px-4 py-3 text-right text-slate-500">
                  {Object.keys(video.metrics).length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Comments on posts this app published, with moderation. */
async function CommentsView({
  workspaceId,
  targetId,
  timezone,
  canModerate,
  canDelete,
  params,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
  canModerate: boolean;
  canDelete: boolean;
  params: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations('engagement');

  const search = (first(params.q) ?? '').trim();
  const shown = first(params.shown);
  const hidden = shown === 'hidden' ? true : shown === 'visible' ? false : undefined;

  // The three go together. Two hundred comments with no way to search them and
  // no way to reach the two hundred and first is not a moderation screen, and a
  // busy Page passes that in a week.
  const filter = { workspaceId, targetId, ...(hidden === undefined ? {} : { hidden }), ...(search ? { search } : {}) };
  const page = paginate({
    total: await countComments(filter),
    requested: pageNumber(params.page),
    size: 50,
  });

  const comments = await readComments({ ...filter, skip: page.skip, limit: page.take });

  const href = (next: number) =>
    pageHref('/analytics', { ...params, view: 'comments' }, next);

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value="comments" />
        {typeof params.target === 'string' && (
          <input type="hidden" name="target" value={params.target} />
        )}

        <div className="min-w-[12rem] flex-1">
          <label className="label" htmlFor="q">
            {t('searchComments')}
          </label>
          <input id="q" name="q" className="input" defaultValue={search} placeholder={t('searchPlaceholder')} />
        </div>

        <div>
          <label className="label" htmlFor="shown">
            {t('show')}
          </label>
          <select id="shown" name="shown" className="input" defaultValue={shown ?? 'all'}>
            <option value="all">{t('showAll')}</option>
            <option value="visible">{t('showVisible')}</option>
            <option value="hidden">{t('showHidden')}</option>
          </select>
        </div>

        <button type="submit" className="btn-secondary">
          {t('applyFilter')}
        </button>
      </form>

    <CommentsPanel
      targetId={targetId}
      canModerate={canModerate}
      canDelete={canDelete}
      comments={comments.map((comment) => ({
        id: comment.id,
        message: comment.message,
        author: comment.author,
        likeCount: comment.likeCount,
        replyCount: comment.replyCount,
        isHidden: comment.isHidden,
        isReply: comment.isReply,
        createdLabel: formatInZone(comment.createdTime, timezone),
        postMessage: comment.postMessage,
        targetName: comment.targetName,
      }))}
    />

      <Pagination page={page} href={href} />
    </div>
  );
}

/** Star ratings and recommendations left on the Page. */
async function ReviewsView({
  workspaceId,
  targetId,
  timezone,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
}) {
  const t = await getTranslations('engagement');
  const summary = await readReviews({ workspaceId, targetId });

  if (summary.count === 0) {
    return <EmptyEdge message={t('noReviews')} targetId={targetId} label={t('refresh')} />;
  }

  const cards = [
    { label: t('reviewCount'), value: summary.count.toLocaleString() },
    { label: t('averageRating'), value: summary.averageRating?.toFixed(1) ?? '—' },
    { label: t('recommends'), value: summary.recommends.toLocaleString() },
    { label: t('doesNotRecommend'), value: summary.doesNotRecommend.toLocaleString() },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('reviewsHint')}</p>
        <SyncButton endpoint="/api/engagement/sync" body={{ targetId }} label={t('refresh')} />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <StatTile key={card.label} label={card.label} value={card.value} />
        ))}
      </section>

      <BreakdownBars title={t('byRating')} data={summary.byRating} limit={5} />

      <ul className="space-y-3">
        {summary.recent.map((review) => (
          <li key={review.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{review.reviewer}</p>
              <p className="text-xs text-slate-500">{formatInZone(review.createdTime, timezone)}</p>
            </div>
            <p className="mt-1 text-sm text-amber-600">
              {review.rating !== null
                ? '★'.repeat(review.rating) + '☆'.repeat(Math.max(0, 5 - review.rating))
                : review.recommendationType === 'positive'
                  ? t('recommends')
                  : t('doesNotRecommend')}
            </p>
            {review.text && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{review.text}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Page inbox threads. */
async function InboxView({
  workspaceId,
  targetId,
  timezone,
  canReply,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
  canReply: boolean;
}) {
  const t = await getTranslations('engagement');
  const conversations = await readConversations({ workspaceId, targetId });

  if (conversations.length === 0) {
    return <EmptyEdge message={t('noConversations')} targetId={targetId} label={t('refresh')} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('inboxHint')}</p>
        <SyncButton endpoint="/api/engagement/sync" body={{ targetId }} label={t('refresh')} />
      </div>

      <InboxPanel
        canReply={canReply}
        threads={conversations.map((thread) => ({
          id: thread.id,
          participants: thread.participants.join(', ') || t('unknownParticipant'),
          updatedLabel: formatInZone(thread.updatedTime, timezone),
          messageCount: thread.messageCount,
          unreadCount: thread.unreadCount,
          messages: thread.messages.map((message) => ({
            id: message.id,
            from: message.from,
            message: message.message,
          })),
          reply:
            thread.reply.state === 'open'
              ? { state: 'open' as const, untilLabel: formatInZone(thread.reply.until, timezone) }
              : { state: thread.reply.state },
        }))}
      />
    </div>
  );
}

/** Posts that reached the Page without going through this app. */
async function ExternalView({
  workspaceId,
  targetId,
  from,
  to,
  timezone,
}: {
  workspaceId: string;
  targetId: string;
  from: Date;
  to: Date;
  timezone: string;
}) {
  const t = await getTranslations('engagement');
  const posts = await readExternalPosts({ workspaceId, targetId, from, to });

  if (posts.length === 0) {
    return <EmptyEdge message={t('noExternal')} targetId={targetId} label={t('refresh')} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('externalHint')}</p>
        <SyncButton endpoint="/api/engagement/sync" body={{ targetId }} label={t('refresh')} />
      </div>

      <ul className="space-y-3">
        {posts.map((post) => {
          const figures = [
            { label: t('impressions'), value: post.impressions },
            { label: t('reach'), value: post.reach },
            { label: t('engaged'), value: post.engagedUsers },
            { label: t('reactions'), value: post.reactions },
            { label: t('comments'), value: post.comments },
            { label: t('shares'), value: post.shares },
          ];

          return (
            <li key={post.id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {post.statusType ?? t('postType')}
                </p>
                <p className="text-xs text-slate-500">
                  {post.targetName} · {formatInZone(post.createdTime, timezone)}
                </p>
              </div>

              <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{post.message}</p>

              {post.syncedAt && (
                <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {figures.map((figure) => (
                    <div key={figure.label}>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                        {figure.label}
                      </dt>
                      <dd className="text-sm font-medium text-slate-900">
                        {figure.value === null ? '—' : figure.value.toLocaleString()}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
                {post.metricCount > 0 && (
                  <Link
                    href={`/analytics/post/${post.id}?external=true`}
                    className="text-brand-600 hover:underline"
                  >
                    {t('allMetrics', { count: post.metricCount })}
                  </Link>
                )}
                {post.permalink && (
                  <ExternalLink href={post.permalink} className="text-brand-600 hover:underline">
                    {t('viewOnFacebook')}
                  </ExternalLink>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A "nothing here yet, pull it" placeholder shared by the edge views. */
async function EmptyEdge({
  message,
  targetId,
  label,
}: {
  message: string;
  targetId: string;
  label: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-slate-600">{message}</p>
      <SyncButton
        endpoint="/api/engagement/sync"
        body={{ targetId }}
        label={label}
        variant="primary"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instagram and advertising
// ---------------------------------------------------------------------------

async function InstagramView({
  workspaceId,
  accountId,
  from,
  to,
  timezone,
}: {
  workspaceId: string;
  accountId?: string;
  from: Date;
  to: Date;
  timezone: string;
}) {
  const t = await getTranslations('instagram');
  const accounts = await listInstagramAccounts(workspaceId);

  if (accounts.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-slate-600">{t('none')}</p>
        <SyncButton
          endpoint="/api/instagram"
          body={{ action: 'discover' }}
          label={t('discover')}
          variant="primary"
        />
      </div>
    );
  }

  const selected = accounts.find((account) => account.id === accountId) ?? accounts[0]!;
  const [series, media] = await Promise.all([
    readInstagramInsights({ accountId: selected.id, from, to }),
    readInstagramMedia({ accountId: selected.id, limit: 24 }),
  ]);

  const cards = [
    { label: t('followers'), value: selected.followersCount },
    { label: t('following'), value: selected.followsCount },
    { label: t('posts'), value: selected.mediaCount },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">@{selected.username}</p>
          <p className="text-xs text-slate-500">
            {selected.linkedPage ? t('via', { page: selected.linkedPage }) : t('unlinked')}
            {selected.lastSyncedAt && ` · ${formatInZone(selected.lastSyncedAt, timezone)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <SyncButton endpoint="/api/instagram" body={{ action: 'discover' }} label={t('discover')} />
          <SyncButton
            endpoint="/api/instagram"
            body={{ action: 'sync', accountId: selected.id }}
            label={t('sync')}
            variant="primary"
          />
        </div>
      </div>

      {accounts.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {accounts.map((account) => (
            <Link
              key={account.id}
              href={`/analytics?view=instagram&account=${account.id}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                account.id === selected.id
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              @{account.username}
            </Link>
          ))}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {cards.map((card) => (
          <StatTile key={card.label} label={card.label} value={card.value} />
        ))}
      </section>

      {series.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-600">{t('noInsights')}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t('metric')}</th>
                <th className="px-4 py-3">{t('period')}</th>
                <th className="px-4 py-3 text-right">{t('total')}</th>
                <th className="px-4 py-3 text-right">{t('points')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {series.map((entry) => (
                <tr key={`${entry.metric}-${entry.period}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{entry.label}</p>
                    {entry.description && (
                      <p className="text-xs text-slate-500">{entry.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{entry.period}</td>
                  <td className="px-4 py-2.5 text-right">
                    {entry.total === null ? t('breakdown') : entry.total.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{entry.points.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {media.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t('media')}</th>
                <th className="px-4 py-3 text-right">{t('reach')}</th>
                <th className="px-4 py-3 text-right">{t('impressions')}</th>
                <th className="px-4 py-3 text-right">{t('likes')}</th>
                <th className="px-4 py-3 text-right">{t('comments')}</th>
                <th className="px-4 py-3 text-right">{t('saved')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {media.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-sm px-4 py-3">
                    <p className="truncate text-slate-900" title={item.caption}>
                      {item.permalink ? (
                        <ExternalLink href={item.permalink} className="hover:underline">
                          {item.caption}
                        </ExternalLink>
                      ) : (
                        item.caption
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.mediaType ?? '—'} · {formatInZone(item.timestamp, timezone)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">{item.reach?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{item.impressions?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{item.likeCount?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{item.commentsCount?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{item.saved?.toLocaleString() ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function AdsView({
  workspaceId,
  level,
  from,
  to,
  timezone,
}: {
  workspaceId: string;
  level?: string;
  from: Date;
  to: Date;
  timezone: string;
}) {
  const t = await getTranslations('ads');
  const accounts = await listAdAccounts(workspaceId);

  const breakdown: 'campaign' | 'adset' | 'ad' =
    level === 'adset' || level === 'ad' ? level : 'campaign';

  if (accounts.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-slate-600">{t('none')}</p>
        <SyncButton
          endpoint="/api/ads"
          body={{ action: 'discover' }}
          label={t('discover')}
          variant="primary"
        />
      </div>
    );
  }

  const [summary, campaigns] = await Promise.all([
    readAdSummary({ workspaceId, from, to }),
    readCampaigns({ workspaceId, from, to, level: breakdown }),
  ]);

  const money = (value: number | null) =>
    value === null ? '—' : `${value.toLocaleString()} ${summary.currency ?? ''}`.trim();

  const cards = [
    { label: t('spend'), value: money(summary.spend) },
    { label: t('impressions'), value: summary.impressions.toLocaleString() },
    { label: t('reach'), value: summary.reach.toLocaleString() },
    { label: t('clicks'), value: summary.clicks.toLocaleString() },
    { label: t('cpc'), value: money(summary.cpc) },
    { label: t('cpm'), value: money(summary.cpm) },
    { label: t('ctr'), value: summary.ctr === null ? '—' : `${summary.ctr}%` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">{t('hint')}</p>
          <p className="text-xs text-slate-500">
            {accounts.map((account) => account.name).join(', ')}
            {accounts[0]?.lastSyncedAt && ` · ${formatInZone(accounts[0].lastSyncedAt, timezone)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <SyncButton endpoint="/api/ads" body={{ action: 'discover' }} label={t('discover')} />
          <SyncButton
            endpoint="/api/ads"
            body={{ action: 'sync' }}
            label={t('sync')}
            variant="primary"
          />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-7">
        {cards.map((card) => (
          <StatTile key={card.label} label={card.label} value={card.value} />
        ))}
      </section>

      {Object.keys(summary.actions).length > 0 && (
        <BreakdownBars title={t('actions')} description={t('actionsHint')} data={summary.actions} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">{t('level')}</span>
        {(['campaign', 'adset', 'ad'] as const).map((option) => (
          <Link
            key={option}
            href={`/analytics?view=ads&adLevel=${option}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              option === breakdown ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t(`level_${option}`)}
          </Link>
        ))}
      </div>

      {campaigns.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-600">{t('noCampaigns')}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t(`level_${breakdown}`)}</th>
                <th className="px-4 py-3 text-right">{t('spend')}</th>
                <th className="px-4 py-3 text-right">{t('impressions')}</th>
                <th className="px-4 py-3 text-right">{t('reach')}</th>
                <th className="px-4 py-3 text-right">{t('clicks')}</th>
                <th className="px-4 py-3 text-right">{t('cpc')}</th>
                <th className="px-4 py-3 text-right">{t('ctr')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.map((campaign) => (
                <tr key={campaign.objectId}>
                  <td className="max-w-xs truncate px-4 py-3 font-medium text-slate-900" title={campaign.name}>
                    {campaign.name}
                  </td>
                  <td className="px-4 py-3 text-right">{money(campaign.spend)}</td>
                  <td className="px-4 py-3 text-right">{campaign.impressions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{campaign.reach.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{campaign.clicks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{money(campaign.cpc)}</td>
                  <td className="px-4 py-3 text-right">
                    {campaign.ctr === null ? '—' : `${campaign.ctr}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">{t('reachNote')}</p>
    </div>
  );
}
