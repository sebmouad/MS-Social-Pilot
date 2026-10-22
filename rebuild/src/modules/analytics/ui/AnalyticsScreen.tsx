import { IconChartBar, IconPlugConnected, IconDownload, IconPin } from '@tabler/icons-react';
import { EmptyState } from '@/components/EmptyState';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { operationFailure } from '@/lib/operation-error';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import type { AnalyticsSnapshot } from '@/modules/analytics/server/types';
import { readPinnedMetrics } from '@/modules/analytics/pins/server/pins';
import { readGoals } from '@/modules/analytics/goals/server/goals';
import { readPosts } from '@/modules/analytics/explorer-posts/service';
import { loadChartAnnotations } from '@/modules/calendar-extras/server/chart-notes';
import { InsightsHeader } from './insights/InsightsHeader';
import { InsightsTiles } from './insights/InsightsTiles';
import { MainChartCard } from './insights/MainChartCard';
import { GoalsCard, PublishingActivityCard, TopPostsCard, type GoalBar, type TopPostItem } from './insights/OverviewCards';
import { OverviewInsights } from './insights/OverviewInsights';
import { chartMetrics, formatMetricValue, headlineTiles, pinnedTile, rankPosts } from './insights/overview-model';
import { fillInsights } from './insights/insights-config';
import { resolvePeriod } from './insights/period';
import { loadInsightsUi } from './insights/runtime';
import { insightsReadInput, withParams } from './insights/scope';
import './analytics.css';
import './insights/insights.css';

type Search = Record<string, string | string[] | undefined>;

/**
 * Insights › Overview (design v2 S9): four key numbers (plus pinned metrics), the main chart, Top posts, publishing
 * activity and goal progress. The channel list in the sidebar scopes the page; the period and compare switch sit in
 * the header. Every caveat is behind an ⓘ. All numbers come from the same scoped snapshot REST and MCP read.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/overview', channelScoped: true });
  const params = await searchParams;
  const runtime = await loadInsightsUi();
  const { copy, policy, locale } = runtime;
  const scope = await pageChannelScope(viewer, params);
  const period = resolvePeriod(params, policy);
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const input = insightsReadInput(params, scope.ids, { start: period.start, end: period.end, compare: period.compare });
  delete input.period;

  let snapshot: AnalyticsSnapshot | null = null;
  let failure: string | null = null;
  try {
    snapshot = await readAnalyticsSnapshot(actor, input, { allowedChannelIds: viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, feature: 'analytics/overview' });
  } catch (error) {
    failure = operationFailure(error, copy.loadFailedBody).error;
  }

  const may = (feature: string) => canUseFeature(viewer.entitlements, feature) && canAccessFeature(viewer.permissions, feature);
  const channelIds = snapshot?.selected.channelIds ?? [];
  const range = snapshot ? { start: snapshot.period.start, end: snapshot.period.end } : period;
  const context = { copy, locale, period: range };

  // Secondary cards load independently: a refusal or failure hides that card, never the page.
  const readInput = { start: range.start, end: range.end, compare: 'previous' as const, ...(channelIds.length ? { filter: '1' as const, channel: channelIds } : {}) };
  const [pins, goals, posts, annotations] = snapshot && channelIds.length ? await Promise.all([
    may('analytics/pins') ? readPinnedMetrics(actor, readInput).catch(() => null) : null,
    may('analytics/goals') ? readGoals(actor).catch(() => null) : null,
    may('analytics/posts') ? readPosts(actor, { start: range.start, end: range.end, filter: '1', channel: channelIds, sort: 'publishedAt', direction: 'desc' }, policy.topPostsPool).catch(() => null) : null,
    loadChartAnnotations({ ...actor, locale }, range.start, range.end, channelIds),
  ]) : [null, null, null, null];

  const headline = snapshot ? headlineTiles(snapshot, policy, context) : { tiles: [], metrics: [] };
  const pinned = (pins?.pins ?? []).map(pin => pinnedTile(pin, context));
  const tiles = [...headline.tiles, ...pinned].slice(0, policy.tilesMax);
  const exploreHref = (key: string) => `/insights/explore?${withParams(params, { metric: key, period: null, start: range.start, end: range.end })}`;
  const metrics = snapshot ? chartMetrics(snapshot, headline.metrics, policy, { ...context, exploreHref }) : [];

  const ranked = posts ? rankPosts(posts.items.map(item => ({ ...item, measures: item.measures.map(measure => ({ ...measure, label: locale === 'fr' ? measure.labelFr ?? measure.label : measure.label })) })), policy.topPostsRankWords, policy.topPostsRows) : null;
  const topPosts: TopPostItem[] = ranked?.posts.map(post => {
    const value = ranked.measureKey ? post.measures.find(measure => measure.key === ranked.measureKey)?.value ?? null : null;
    return { key: `${post.channelId}:${post.postId}`, text: post.text, channelName: post.channelName, url: post.url, value: value === null ? null : formatMetricValue(value, 'count', locale), measure: value === null ? null : ranked.measureLabel };
  }) ?? [];
  const goalBars: GoalBar[] = (goals?.channels ?? []).flatMap(channel => channel.goals.map(goal => ({ key: `${channel.channelId}:${goal.metric}`, label: `${channel.channelName} · ${goal.label}`, percent: goal.percent }))).slice(0, policy.goalsShown);

  const contentLink = (status: string) => `/content?${withParams({ channel: params.channel }, { status })}`;
  const reportQuery = snapshot ? new URLSearchParams({ start: range.start, end: range.end, ...(channelIds.length ? { filter: '1' } : {}) }) : null;
  channelIds.forEach(id => reportQuery?.append('channel', id));
  const canExport = snapshot !== null && channelIds.length > 0 && may('analytics/reports');
  const canConnect = may('settings/connections');
  const retry = `/insights${Object.keys(params).length ? `?${withParams(params, {})}` : ''}`;

  return <PageFrame module="analytics" scopedAccess><div className="insights">
    <InsightsHeader runtime={runtime} title={copy.overviewTitle} info={copy.overviewInfo} period={period}
      actions={(canExport && reportQuery) || may('analytics/pins') ? <>
        {may('analytics/pins') && snapshot && channelIds.length > 0 && <a className="ui-button ui-button--quiet ui-button--md" href="/insights/pins"><IconPin size={16} stroke={1.9} aria-hidden="true" /> {copy.pinsManage}</a>}
        {canExport && reportQuery && <a className="ui-button ui-button--secondary ui-button--md" href={`/api/reports/export?${reportQuery}`}><IconDownload size={16} stroke={1.9} aria-hidden="true" /> {copy.downloadReport}</a>}
      </> : undefined} />
    {failure && <EmptyState tone="error" title={copy.loadFailedTitle} action={<a href={retry}>{copy.retry}</a>}>{failure}</EmptyState>}
    {snapshot && !snapshot.options.channels.length && <EmptyState icon={<IconPlugConnected />} title={copy.noChannelsTitle} action={canConnect ? <a className="ui-button ui-button--primary ui-button--md" href="/settings/channels">{copy.noChannelsAction}</a> : undefined}>{copy.noChannelsBody}</EmptyState>}
    {snapshot && snapshot.options.channels.length > 0 && !channelIds.length && <EmptyState icon={<IconChartBar />} title={copy.noDataTitle}>{copy.noDataBody}</EmptyState>}
    {snapshot && channelIds.length > 0 && <>
      {tiles.length > 0 && <InsightsTiles tiles={tiles} visible={policy.tilesVisible} labels={{ group: copy.tilesLabel, showAll: copy.tilesShowAll, showLess: copy.tilesShowLess }} />}
      <MainChartCard title={copy.overviewTitle} metrics={metrics} locale={locale} annotations={annotations}
        labels={{ switcher: copy.chartMetrics, chartLabel: copy.chartLabel, empty: copy.chartNoSeries, scrollHint: copy.chartScrollHint, previous: copy.chartPrevious, openExplore: copy.chartOpenExplore, info: copy.chartInfo }} />
      <div className="insights-grid">
        {posts !== null || may('analytics/posts') ? <TopPostsCard copy={copy} posts={topPosts} unavailable={posts === null} allHref={may('analytics/posts') ? `/insights/posts?${withParams(params, { period: null, start: range.start, end: range.end })}` : undefined}
          infoText={ranked?.measureLabel ? fillInsights(copy.topPostsInfo, { measure: ranked.measureLabel, count: policy.topPostsPool }) : copy.topPostsInfoRecent} /> : <span />}
        <PublishingActivityCard copy={copy} counts={snapshot.publishing} hrefs={{ published: contentLink('published'), scheduled: contentLink('scheduled'), failed: contentLink('failed') }} />
      </div>
      <GoalsCard copy={copy} goals={goalBars} href="/insights/goals" />
      <details className="insights-more">
        <summary>{copy.moreInsights}</summary>
        <OverviewInsights locale={locale} workspaceId={viewer.workspaceId} window={snapshot.period.range} channels={snapshot.options.channels.filter(channel => channelIds.includes(channel.id))} />
      </details>
    </>}
  </div></PageFrame>;
}
