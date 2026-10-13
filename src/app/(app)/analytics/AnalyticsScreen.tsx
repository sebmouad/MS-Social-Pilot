import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TargetType, WorkspaceRole } from '@prisma/client';
import { loadSelection } from '@/lib/page-filter';
import { ChannelsLayout } from '@/components/ChannelsLayout';

import { AnalyticsClient } from '@/components/AnalyticsClient';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import { ComparePagesView, PageAnalysisView } from '@/components/analysis/PageAnalysisView';
import { BreakdownBars } from '@/components/BreakdownBars';
import { AudienceView } from '@/components/AudienceSection';
import { CommentsPanel } from '@/components/CommentsPanel';
import { InboxPanel } from '@/components/InboxPanel';
import { ExportMenu } from '@/components/ExportMenu';
import { DateRangePicker } from '@/components/DateRangePicker';
import { parseCompare, parseRange, rangeQuery } from '@/lib/date-range';
import { PostAnalyticsTable, type PostRow } from '@/components/PostAnalyticsTable';
import { StatTile } from '@/components/charts/StatTile';
import { AutoSyncNote } from '@/components/AutoSyncNote';
import { requirePage } from '@/lib/auth';
import { targetScope } from '@/lib/page-access';
import { listPageGroups } from '@/lib/page-groups';
import { screenMetadata } from '@/lib/metadata';
import { atLeast, canDeleteComments, canModerateComments } from '@/lib/constants';
import { INBOX_VIEW_PATHS, PRIMARY_ANALYTICS_VIEWS, UNWINDOWED_VIEWS, defaultAnalyticsView, parseAnalyticsView, type AnalyticsView } from '@/lib/analytics-views';
import { isPinnable, readPinnedFigures } from '@/lib/pinned-metrics';
import { PinnedTiles } from '@/components/analysis/PinnedTiles';
import { SummaryView } from '@/components/analysis/SummaryView';
import { ResponseTimeView } from '@/components/analysis/ResponseTimeView';
import { Pagination } from '@/components/Pagination';
import { pageHref, pageNumber, paginate } from '@/lib/paging';
import { prisma } from '@/lib/prisma';
import {
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
  countConversations,
  readExternalPosts,
  readReviews,
  readVideos,
} from '@/lib/engagement';
import { formatInZone, appLocale } from '@/lib/time';
import { env } from '@/lib/env';
import { pageRatingsAvailable } from '@/lib/facebook/graph';
import { ExternalLink } from '@/components/ExternalLink';
import { FeedPost } from '@/components/FeedPost';
import { EmptyState } from '@/components/EmptyState';
import { NetworksView } from './NetworksView';
import { ChannelFiguresSection } from '@/components/analysis/ChannelFiguresSection';
import type { IconName } from '@/components/Icon';
import { formatOfStatusType } from '@/lib/page-analysis';
import { feedMediaOfPicture } from '@/lib/feed';


/** A query parameter that may arrive repeated. */
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The analytics screen. `only` shows one view on its own, without the tab
 * strip, for the engagement views the Inbox module lists in its sidebar.
 */
export async function AnalyticsScreen({
  searchParams,
  only,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  only?: AnalyticsView;
}) {
  const auth = await requirePage();
  const t = await getTranslations('analytics');
  const params = await searchParams;
  // Follows the shared profile selection (src/lib/page-filter.ts).
  const selection = await loadSelection(auth, params);
  const pageScope = selection.scope;
  const timezone = auth.workspace.timezone;


  // Groups have no insights edge, so they are not offered here at all.
  const pages = await prisma.target.findMany({
    where: { workspaceId: auth.workspace.id, type: TargetType.page, ...targetScope(pageScope) },
    orderBy: { name: 'asc' },
  });

  // Instagram accounts are not Pages: the selection reaches them through these.
  const igSelection = {
    memberScope: auth.pageScope,
    picked: selection.picked,
    ids: selection.ids,
    net: selection.net,
    platform: selection.platform,
  };

  // No Facebook Page in the selection, but other channels: the four views
  // still open, with the Instagram and other-network figures only.
  const otherChannels =
    pages.length === 0 &&
    (selection.pages.length > 0 || (env.instagramEnabled && (await prisma.instagramAccount.count({ where: { workspaceId: auth.workspace.id } })) > 0));
  if (otherChannels && !only) {
    const range = parseRange({ range: first(params.range), from: first(params.from), to: first(params.to), days: first(params.days) }, timezone);
    const asked = parseAnalyticsView(first(params.view));
    const channelView = asked === 'networks' ? 'networks' : PRIMARY_ANALYTICS_VIEWS.includes(asked) ? asked : 'summary';
    return (
      <ChannelsLayout
        auth={auth}
        selection={selection}
        tools={
          <>
            <AnalyticsTabs current={channelView} />
            <DateRangePicker range={range} path="/analytics" keep={{ view: channelView }} />
          </>
        }
      >
        <div className="min-w-0 flex-1 space-y-6">
          <header>
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{channelView === 'networks' ? t('view.networks') : t('title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('noPagesOtherChannels')}</p>
          </header>
          {channelView === 'networks' ? (
            <NetworksView workspaceId={auth.workspace.id} scope={pageScope} from={range.from} to={range.to} timezone={timezone} />
          ) : (
            <ChannelFiguresSection
              view={channelView as 'summary' | 'posts' | 'audience' | 'compare'}
              workspaceId={auth.workspace.id}
              scope={pageScope}
              instagram={igSelection}
              from={range.from}
              to={range.to}
              timezone={timezone}
              emptyWhenNone
            />
          )}
        </div>
      </ChannelsLayout>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
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

  // Named periods and custom dates, in the workspace's own days. `window` is
  // the span in days, which the comparison with "the period before" uses.
  const range = parseRange(
    { range: first(params.range), from: first(params.from), to: first(params.to), days: first(params.days) },
    timezone,
  );
  const { from, to } = range;
  const window = range.days;
  const compare = parseCompare(first(params.compare));
  // The period as links carry it: dates, and the comparison when it is not the default.
  const periodQuery = `${rangeQuery(range)}${compare === 'year' ? '&compare=year' : ''}`;

  // Ads is its own module now; an old bookmark to the tab lands there.
  if (first(params.view) === 'ads') {
    const level = first(params.adLevel);
    redirect(level ? `/ads?level=${encodeURIComponent(level)}` : '/ads');
  }

  // The analysis is the answer to "how is this Page doing"; the raw views
  // behind it are one tab away for anyone who wants the figures themselves.
  // An unknown view — a typo, a retired tab — lands there too rather than on
  // a screen with a tab strip and nothing under it.
  // Several profiles selected and no view or Page asked for: their total first.
  const askedView = first(params.view);
  const view = only ?? (askedView || requested ? parseAnalyticsView(askedView) : defaultAnalyticsView(pages.length));
  // The engagement views live in the Inbox module now; old links follow them.
  if (!only && INBOX_VIEW_PATHS[view]) redirect(`${INBOX_VIEW_PATHS[view]}?${new URLSearchParams(params as Record<string, string>).toString()}`);

  const overviewSeries = view === 'overview' ? await readStoredAnalytics({ targetId: selected.id, from, to }) : [];
  // Metrics this person pinned from Overview, shown as tiles on Analysis and All profiles.
  const pinnedKeys =
    (await prisma.user.findUnique({ where: { id: auth.user.id }, select: { pinnedMetrics: true } }))?.pinnedMetrics ?? [];

  // The post table covers every selected profile until one Page is picked.
  const postsScope = requested ? { targetId: selected.id } : { targetIds: pages.map((page) => page.id) };
  // The Summary reads the whole selection, or the one Page asked for.
  const summaryIds = requested || pages.length === 1 ? [selected.id] : pages.map((page) => page.id);

  return (
    <ChannelsLayout
      auth={auth}
      selection={selection}
      tools={
        <>
          {/* The view, then the window and the export: every control that scopes the screen, in the column. */}
          {!only && <AnalyticsTabs current={view} />}
          {!UNWINDOWED_VIEWS.has(view) && (
            <DateRangePicker
              range={range}
              path={only ? INBOX_VIEW_PATHS[only]! : '/analytics'}
              keep={{ view, target: selected.id }}
              compare={view === 'summary' || view === 'compare' ? compare : undefined}
            />
          )}
          <ExportMenu targetId={selected.id} from={from.toISOString()} to={to.toISOString()} />
        </>
      }
    >
    <div className="min-w-0 flex-1 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{only ? t(`view.${only}`) : t('title')}</h1>
          {!only && <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>}
        </div>
      </header>

      {pages.length > 1 && !requested && !['summary', 'total', 'compare', 'posts', 'responseTime', 'networks'].includes(view) && (
        <p className="rounded-xl bg-brand-50 px-4 py-2 text-sm text-brand-800">{t('oneChannelHint', { name: selected.name })}</p>
      )}

      {view === 'summary' && (
        <PinnedTiles
          overviewHref={`/analytics?view=overview&target=${selected.id}&${periodQuery}`}
          figures={await readPinnedFigures({ keys: pinnedKeys, targetIds: summaryIds, from, to })}
        />
      )}

      {view === 'summary' && (
        <SummaryView
          workspaceId={auth.workspace.id}
          targetIds={summaryIds}
          from={from}
          to={to}
          days={window}
          timeZone={timezone}
          compare={compare}
          rangeQuery={summaryIds.length === 1 ? `target=${selected.id}&${periodQuery}` : periodQuery}
          reportHref={`/reports?target=${selected.id}&${periodQuery}`}
        />
      )}

      {/* One channel: the full reading of it follows the summary. */}
      {view === 'summary' && summaryIds.length === 1 && (
        <section className="space-y-3 border-t border-slate-200 pt-6" aria-label={t('summaryDetail')}>
          <PageAnalysisView
            workspaceId={auth.workspace.id}
            targetId={selected.id}
            from={from}
            to={to}
            days={window}
            timeZone={timezone}
            compare={compare}
            notesAccess={{ canEdit: atLeast(auth.role, WorkspaceRole.editor), canNoteAllPages: auth.pageScope.all }}
          />
        </section>
      )}

      {view === 'compare' && (
        <ComparePagesView
          workspaceId={auth.workspace.id}
          from={from}
          to={to}
          days={window}
          timeZone={timezone}
          sort={first(params.sort)}
          order={first(params.order)}
          targetId={selected.id}
          rangeQuery={periodQuery}
          compare={compare}
          targetIds={pageScope.all ? undefined : pageScope.ids}
          groups={await listPageGroups(auth.workspace.id, auth.pageScope)}
          groupId={first(params.group)}
        />
      )}

      {view === 'posts' && (
        <PostAnalyticsTable
          posts={([] as PostRow[]).concat(
            (
              await readPostAnalytics({
                workspaceId: auth.workspace.id,
                ...postsScope,
                from,
                to,
              })
            ).map((post) => ({
            postTargetId: post.postTargetId,
            message: post.message,
            targetName: post.targetName,
            targetPictureUrl: post.targetPictureUrl,
            imageUrl: post.imageUrl,
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
            source: 'app' as const,
          })),
            // Posts made on Facebook itself, so the table covers the whole Page.
            (await readExternalPosts({ workspaceId: auth.workspace.id, ...postsScope, from, to, limit: 500 })).map(
              (post) => {
                const interactions = (post.reactions ?? 0) + (post.comments ?? 0) + (post.shares ?? 0);
                return {
                  postTargetId: post.id,
                  href: `/analytics/post/${post.id}?external=true`,
                  message: post.message,
                  targetName: post.targetName,
                  targetPictureUrl: post.targetPictureUrl,
                  imageUrl: post.pictureUrl,
                  publishedLabel: formatInZone(post.createdTime, timezone),
                  url: post.permalink,
                  impressions: post.impressions ?? 0,
                  reach: post.reach ?? 0,
                  engagedUsers: post.engagedUsers ?? 0,
                  reactions: post.reactions ?? 0,
                  comments: post.comments ?? 0,
                  shares: post.shares ?? 0,
                  clicks: 0,
                  negativeFeedback: 0,
                  videoViews: 0,
                  organic: 0,
                  paid: 0,
                  engagementRate: post.reach ? Math.round((interactions / post.reach) * 1000) / 10 : null,
                  source: 'page' as const,
                };
              },
            ),
          )}
        />
      )}

      {view === 'interactions' && <InteractionsView
        workspaceId={auth.workspace.id}
        targetId={selected.id}
        from={from}
        to={to}
      />}

      {view === 'audience' && <AudienceView targetId={selected.id} from={from} to={to} timeZone={timezone} />}

      {view === 'videos' && (
        <VideosView
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          timezone={timezone}
          firstReadPending={!selected.firstReadAt}
        />
      )}

      {view === 'comments' && (
        <CommentsView
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          timezone={timezone}
          canModerate={canModerateComments(auth.role)}
          canDelete={canDeleteComments(auth.role)}
          firstReadPending={!selected.firstReadAt}
          params={params}
        />
      )}

      {view === 'reviews' && (
        <ReviewsView
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          timezone={timezone}
          firstReadPending={!selected.firstReadAt}
        />
      )}

      {view === 'inbox' && (
        <InboxView
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          timezone={timezone}
          canReply={canModerateComments(auth.role)}
          firstReadPending={!selected.firstReadAt}
          params={params}
          pageName={selected.name}
        />
      )}

      {view === 'responseTime' && (
        <ResponseTimeView
          workspaceId={auth.workspace.id}
          targetIds={pages.map((page) => page.id)}
          from={from}
          to={to}
          timeZone={timezone}
        />
      )}

      {view === 'external' && (
        <ExternalView
          firstReadPending={!selected.firstReadAt}
          workspaceId={auth.workspace.id}
          targetId={selected.id}
          from={from}
          to={to}
          timezone={timezone}
        />
      )}

      {view === 'networks' && (
        <NetworksView workspaceId={auth.workspace.id} scope={pageScope} from={from} to={to} timezone={timezone} />
      )}

      {/* Instagram and the other networks in the selection, in each primary view. */}
      {(view === 'summary' || view === 'posts' || view === 'audience' || view === 'compare') && (
        <ChannelFiguresSection view={view} workspaceId={auth.workspace.id} scope={pageScope} instagram={igSelection} from={from} to={to} timezone={timezone} />
      )}


      {view === 'overview' && (
        <AnalyticsClient
          targetId={selected.id}
          targetName={selected.name}
          timeZone={timezone}
          series={overviewSeries}
          pinned={pinnedKeys}
          pinnable={overviewSeries.map((entry) => `${entry.metric}::${entry.period}`).filter(isPinnable)}
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
    </ChannelsLayout>
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
    // Interactions rather than "engaged people": Meta retired the engaged-users
    // metrics, so that tile read zero on every Page.
    {
      label: t('interactionsTotal'),
      value: summary.totals.reactions + summary.totals.comments + summary.totals.shares,
    },
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

// ---------------------------------------------------------------------------

/** Videos with their video-level figures, which aggregate across crossposts. */
async function VideosView({
  workspaceId,
  targetId,
  timezone,
  firstReadPending,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
  firstReadPending: boolean;
}) {
  const t = await getTranslations('engagement');
  const videos = await readVideos({ workspaceId, targetId });

  if (videos.length === 0) {
    return <EmptyEdge icon="video" message={t('noVideos')} firstReadPending={firstReadPending} />;
  }

  const seconds = (milliseconds: number | null) =>
    milliseconds === null ? '—' : `${Math.round(milliseconds / 1000).toLocaleString(appLocale())}s`;
  // Hours of watching read as hours: "24 h 33 min", not "88,400s".
  const watched = (milliseconds: number | null) => {
    if (milliseconds === null) return '—';
    const minutes = Math.round(milliseconds / 60000);
    if (minutes < 1) return seconds(milliseconds);
    const h = Math.floor(minutes / 60);
    return h > 0 ? `${h.toLocaleString(appLocale())} h ${minutes % 60} min` : `${minutes} min`;
  };
  // 1:05, or 1:02:05 past the hour, as the player writes it.
  const duration = (total: number) => {
    const whole = Math.round(total);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const sec = String(whole % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('videosHint')}</p>
        <AutoSyncNote job="edges" timezone={timezone} firstReadPending={firstReadPending} />
      </div>

      {/* Facebook's video tab: the still, its length on it, then the title
          and what it drew. The full catalogue is one click further. */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => {
          const still = (
            <span className="relative block aspect-video overflow-hidden bg-slate-900">
              {video.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
              <span aria-hidden className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-black/50 text-white">
                  <svg viewBox="0 0 24 24" className="ms-0.5 h-6 w-6" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
              {video.lengthSeconds !== null && (
                <span className="nums absolute bottom-2 end-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {duration(video.lengthSeconds)}
                </span>
              )}
            </span>
          );
          return (
            <li key={video.id} className="card overflow-hidden">
              {video.permalink ? (
                <ExternalLink href={video.permalink} className="block hover:opacity-90">
                  {still}
                </ExternalLink>
              ) : (
                still
              )}
              <div className="px-3 py-2.5">
                <p className="line-clamp-2 text-[15px] font-semibold leading-5 text-slate-900" title={video.title}>
                  {video.title}
                </p>
                <p className="mt-0.5 text-[13px] text-slate-600">
                  {video.targetName} · {formatInZone(video.createdTime, timezone)}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-1.5">
                  {[
                    { label: t('views'), value: video.views?.toLocaleString(appLocale()) ?? '—' },
                    { label: t('avgWatch'), value: seconds(video.avgTimeWatchedMs) },
                    { label: t('completeViews'), value: video.completeViews?.toLocaleString(appLocale()) ?? '—' },
                  ].map((figure) => (
                    <div key={figure.label} className="rounded-md bg-slate-50 px-2 py-1.5">
                      <dt className="truncate text-[11px] font-semibold text-slate-600" title={figure.label}>
                        {figure.label}
                      </dt>
                      <dd className="nums text-sm font-semibold text-slate-900">{figure.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-slate-500">
                  {t('uniqueViews')}: {video.uniqueViews?.toLocaleString(appLocale()) ?? '—'} · {t('totalWatch')}:{' '}
                  {watched(video.totalWatchTimeMs)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
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
  firstReadPending,
  params,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
  canModerate: boolean;
  canDelete: boolean;
  firstReadPending: boolean;
  params: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations('engagement');
  const tAuto = await getTranslations('autoSync');

  const search = (first(params.q) ?? '').trim();
  const shown = first(params.shown);
  const hidden = shown === 'hidden' ? true : shown === 'visible' ? false : undefined;
  const unanswered = shown === 'unanswered';

  // The three go together. Two hundred comments with no way to search them and
  // no way to reach the two hundred and first is not a moderation screen, and a
  // busy Page passes that in a week.
  const filter = {
    workspaceId,
    targetId,
    ...(hidden === undefined ? {} : { hidden }),
    ...(unanswered ? { unanswered: true } : {}),
    ...(search ? { search } : {}),
  };
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
        {/* Otherwise applying the filter quietly resets the window to 30 days. */}
        {(['days', 'range', 'from', 'to'] as const).map((name) =>
          typeof params[name] === 'string' ? (
            <input key={name} type="hidden" name={name} value={params[name] as string} />
          ) : null,
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
            <option value="unanswered">{t('showUnanswered')}</option>
          </select>
        </div>

        <button type="submit" className="btn-secondary">
          {t('applyFilter')}
        </button>
      </form>

    <CommentsPanel
      note={<AutoSyncNote job="edges" timezone={timezone} firstReadPending={firstReadPending} />}
      emptyHint={tAuto(firstReadPending ? 'firstRead' : 'emptyHint')}
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
        fromPage: comment.fromPage,
        pagePictureUrl: comment.targetPictureUrl ?? null,
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
  firstReadPending,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
  firstReadPending: boolean;
}) {
  const t = await getTranslations('engagement');
  const summary = await readReviews({ workspaceId, targetId });

  // Meta withdrew Page ratings from the API in v22.0. Say so, rather than offer
  // a refresh button that can only ever fail; what was stored before stays.
  const retired = !pageRatingsAvailable(env.graphVersion);
  const retiredNotice = (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      {t('reviewsRetired', { version: env.graphVersion })}
    </p>
  );

  if (summary.count === 0) {
    return retired ? (
      retiredNotice
    ) : (
      <EmptyEdge icon="star" message={t('noReviews')} firstReadPending={firstReadPending} />
    );
  }

  const cards = [
    { label: t('reviewCount'), value: summary.count.toLocaleString(appLocale()) },
    { label: t('averageRating'), value: summary.averageRating?.toFixed(1) ?? '—' },
    { label: t('recommends'), value: summary.recommends.toLocaleString(appLocale()) },
    { label: t('doesNotRecommend'), value: summary.doesNotRecommend.toLocaleString(appLocale()) },
  ];

  return (
    <div className="space-y-6">
      {retired && retiredNotice}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('reviewsHint')}</p>
        {!retired && <AutoSyncNote job="edges" timezone={timezone} firstReadPending={firstReadPending} />}
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
              <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-700">{review.text}</p>
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
  firstReadPending,
  params,
  pageName,
}: {
  workspaceId: string;
  targetId: string;
  timezone: string;
  pageName: string;
  canReply: boolean;
  firstReadPending: boolean;
  params: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations('engagement');

  // Paged like the comments, so a busy inbox is not cut off at its fiftieth thread.
  const page = paginate({
    total: await countConversations({ workspaceId, targetId }),
    requested: pageNumber(params.page),
    size: 50,
  });
  const conversations = await readConversations({ workspaceId, targetId, skip: page.skip, limit: page.take });

  if (page.total === 0) {
    // Messenger access is the second half of Meta's review. Until it is on,
    // a pull reads nothing, and the honest thing is to say why.
    if (!env.messagingEnabled) {
      return <EmptyState icon="inbox" title={t('inboxWaiting')} hint={t('inboxWaitingHint')} />;
    }
    return <EmptyEdge icon="inbox" message={t('noConversations')} firstReadPending={firstReadPending} />;
  }

  const href = (next: number) => pageHref('/analytics', { ...params, view: 'inbox' }, next);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('inboxHint')}</p>
        <AutoSyncNote job="edges" timezone={timezone} firstReadPending={firstReadPending} />
      </div>

      <InboxPanel
        canReply={canReply}
        pageName={pageName}
        threads={conversations.map((thread) => ({
          id: thread.id,
          participants: thread.participants.join(', ') || t('unknownParticipant'),
          updatedLabel: formatInZone(thread.updatedTime, timezone),
          messageCount: thread.messageCount,
          unreadCount: thread.unreadCount,
          snippet: thread.snippet,
          timeLabel: formatInZone(thread.updatedTime, timezone, 'd MMM, HH:mm'),
          messages: thread.messages.map((message) => ({
            id: message.id,
            from: message.from,
            fromPage: message.fromPage,
            message: message.message,
            timeLabel: formatInZone(message.createdTime, timezone, 'd MMM, HH:mm'),
          })),
          reply:
            thread.reply.state === 'open'
              ? { state: 'open' as const, untilLabel: formatInZone(thread.reply.until, timezone) }
              : { state: thread.reply.state },
        }))}
      />

      <Pagination page={page} href={href} />
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
  firstReadPending,
}: {
  workspaceId: string;
  targetId: string;
  from: Date;
  to: Date;
  timezone: string;
  firstReadPending: boolean;
}) {
  const t = await getTranslations('engagement');
  const tFormat = await getTranslations('pageAnalysis');
  const tCommon = await getTranslations('common');
  const posts = await readExternalPosts({ workspaceId, targetId, from, to });

  if (posts.length === 0) {
    return <EmptyEdge icon="posts" message={t('noExternal')} firstReadPending={firstReadPending} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{t('externalHint')}</p>
        <AutoSyncNote job="edges" timezone={timezone} firstReadPending={firstReadPending} />
      </div>

      <ul className="mx-auto max-w-[680px] space-y-3">
        {posts.map((post) => {
          const figures = [
            { label: t('impressions'), value: post.impressions },
            { label: t('reach'), value: post.reach },
            {
              label: t('interactions'),
              value:
                post.reactions === null && post.comments === null && post.shares === null
                  ? null
                  : (post.reactions ?? 0) + (post.comments ?? 0) + (post.shares ?? 0),
            },
            { label: t('reactions'), value: post.reactions },
            { label: t('comments'), value: post.comments },
            { label: t('shares'), value: post.shares },
          ];

          return (
            <li key={post.id}>
              {/* As it sits on the Page's timeline, with what it earned under it. */}
              <FeedPost
                author={{ name: post.targetName, pictureUrl: post.targetPictureUrl }}
                meta={`${formatInZone(post.createdTime, timezone)} · ${tFormat(`format.${formatOfStatusType(post.statusType)}`)}`}
                message={post.message}
                emptyText="—"
                clamp
                media={feedMediaOfPicture(post.pictureUrl, post.statusType === 'added_video')}
                mediaHref={post.permalink}
                seeMore={tCommon('seeMore')}
                stats={
                  post.syncedAt
                    ? {
                        reactions: post.reactions ?? 0,
                        others: [
                          `${(post.comments ?? 0).toLocaleString(appLocale())} ${t('comments').toLowerCase()}`,
                          `${(post.shares ?? 0).toLocaleString(appLocale())} ${t('shares').toLowerCase()}`,
                        ],
                      }
                    : undefined
                }
                footer={
                  <div className="space-y-2 py-2">
                    {post.syncedAt && (
                      <dl className="grid grid-cols-3 gap-2">
                        {figures.slice(0, 3).filter((figure) => figure.value !== null).map((figure) => (
                          <div key={figure.label} className="rounded-md bg-slate-50 px-2 py-1.5">
                            <dt className="text-[11px] font-semibold text-slate-600">{figure.label}</dt>
                            <dd className="nums text-sm font-semibold text-slate-900">
                              {figure.value === null ? '—' : figure.value.toLocaleString(appLocale())}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="flex flex-wrap gap-3 text-[13px] font-semibold">
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
                  </div>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A "nothing here yet" placeholder shared by the edge views: the worker fills them. */
async function EmptyEdge({
  message,
  icon = 'inbox',
  firstReadPending,
}: {
  message: string;
  icon?: IconName;
  firstReadPending: boolean;
}) {
  const t = await getTranslations('autoSync');
  return <EmptyState icon={icon} title={message} hint={firstReadPending ? t('firstRead') : t('emptyHint')} />;
}

