import { TargetType } from '@prisma/client';

import { comparisonWindow, type CompareMode } from './date-range';
import { feedLinkOf, feedMediaOf, feedMediaOfPicture } from './feed';
import { prisma } from './prisma';
import { errors } from './errors';
import { parseInsights, parseMedia } from './json';
import {
  analyse,
  formatOfAppPost,
  formatOfStatusType,
  netFollows,
  rateOf,
  summarise,
  type AnalysedPost,
  type Health,
  type PageAnalysis,
  type PageTotals,
  healthScore,
  compareKpis,
  cadence,
  dailySeries,
  type DailySeries,
  findings,
  formatBreakdown,
  bestTimes,
  median,
  type Finding,
} from './page-analysis';

/**
 * The database half of the page analysis: which posts, which Page figures.
 *
 * **Every post on the Page, not only ours.** A Page's history is mostly posts
 * made in Facebook itself — by the owner on their phone, by a colleague, before
 * this app was connected. Analysing only what went out through here would call
 * a busy Page quiet and draw a best time to post from a handful of samples.
 * Both sources are read and put in one list; the `source` field keeps them
 * apart for anyone who wants to know which was which.
 *
 * **The metric Meta still serves.** Page-level figures are read through a
 * fallback list, newest name first. `page_fan_adds` was withdrawn in favour of
 * `page_daily_follows_unique`, and a Page connected before and after the switch
 * holds one or the other; asking for a single name would read zero on half of
 * them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Posts the time-of-day grid wants at least this much history for. */
const TIMING_LOOKBACK_DAYS = 90;

const PAGE_METRICS: Record<keyof PageTotals, string[]> = {
  // Viewers is Meta's replacement for reach, which it retired on 29 July 2026.
  reach: ['page_total_media_view_unique', 'page_impressions_unique', 'page_posts_impressions_unique'],
  engagements: ['page_post_engagements'],
  profileViews: ['page_views_total'],
  follows: ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_fan_adds'],
  unfollows: ['page_daily_unfollows_unique', 'page_fan_removes_unique', 'page_fan_removes'],
};

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toAnalysed(options: {
  id: string;
  source: AnalysedPost['source'];
  message: string | null;
  url: string | null;
  imageUrl: string | null;
  media: AnalysedPost['media'];
  linkPreview?: AnalysedPost['linkPreview'];
  publishedAt: Date;
  format: AnalysedPost['format'];
  insights: unknown;
}): AnalysedPost {
  const insights = parseInsights(options.insights as never);
  const reactions = numberOr(insights?.reactions, 0);
  const comments = numberOr(insights?.comments, 0);
  const shares = numberOr(insights?.shares, 0);
  const reach = nullableNumber(insights?.reach);
  const interactions = reactions + comments + shares;

  return {
    id: options.id,
    source: options.source,
    message: options.message?.trim() || '',
    url: options.url,
    imageUrl: options.imageUrl,
    media: options.media,
    linkPreview: options.linkPreview ?? null,
    publishedAt: options.publishedAt,
    format: options.format,
    reach,
    impressions: nullableNumber(insights?.impressions),
    reactions,
    comments,
    shares,
    clicks: nullableNumber(insights?.clicks),
    interactions,
    rate: rateOf(interactions, reach),
  };
}

/** Every post on one Page in a window, from both sources. */
export async function loadPagePosts(targetId: string, from: Date, to: Date): Promise<AnalysedPost[]> {
  const [ours, found] = await Promise.all([
    prisma.postTarget.findMany({
      where: { targetId, status: 'published', publishedAt: { gte: from, lte: to } },
      select: {
        id: true,
        publishedAt: true,
        remoteUrl: true,
        insights: true,
        post: { select: { message: true, media: true, link: true, linkPreview: true } },
      },
    }),
    prisma.externalPost.findMany({
      where: { targetId, createdTime: { gte: from, lte: to } },
      select: {
        id: true,
        message: true,
        permalink: true,
        statusType: true,
        pictureUrl: true,
        createdTime: true,
        insights: true,
      },
    }),
  ]);

  return [
    ...ours.map((row) =>
      toAnalysed({
        id: row.id,
        source: 'app',
        message: row.post.message,
        url: row.remoteUrl,
        imageUrl: parseMedia(row.post.media).find((item) => item.kind === 'image')?.url ?? null,
        media: feedMediaOf(row.post.media),
        linkPreview: feedLinkOf(row.post.linkPreview),
        publishedAt: row.publishedAt!,
        format: formatOfAppPost(parseMedia(row.post.media), row.post.link),
        insights: row.insights,
      }),
    ),
    ...found.map((row) =>
      toAnalysed({
        id: row.id,
        source: 'page',
        message: row.message,
        url: row.permalink,
        imageUrl: row.pictureUrl,
        media: feedMediaOfPicture(row.pictureUrl, row.statusType === 'added_video'),
        publishedAt: row.createdTime,
        format: formatOfStatusType(row.statusType),
        insights: row.insights,
      }),
    ),
  ].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
}

/**
 * Page-level sums over each window.
 *
 * Each day counts once, from the first metric in its fallback list that has a
 * figure for that day. Per day rather than per window, because Meta renames
 * these mid-history: a Page synced across 29 July 2026 holds reach before it
 * and viewers after it, and choosing one name for the whole span would drop
 * the other half. A day is never counted twice under two names.
 */
export async function loadPageTotals(
  targetId: string,
  windows: Array<{ from: Date; to: Date }>,
): Promise<PageTotals[]> {
  const spanFrom = new Date(Math.min(...windows.map((window) => window.from.getTime())));
  const spanTo = new Date(Math.max(...windows.map((window) => window.to.getTime())));

  // A daily value's endTime is the end of the day it covers, so a window takes
  // the days that *end* inside it.
  const rows = await prisma.pageInsight.findMany({
    where: {
      targetId,
      period: 'day',
      metric: { in: Object.values(PAGE_METRICS).flat() },
      endTime: { gt: spanFrom, lte: spanTo },
    },
    select: { metric: true, endTime: true, numeric: true },
  });

  return windows.map((window) => totalsOf(rows, window));
}

/** Totals over one window from stored daily rows; per day, the first metric name Meta still serves wins. */
export function totalsOf(
  rows: Array<{ metric: string; endTime: Date; numeric: number | null }>,
  window: { from: Date; to: Date },
): PageTotals {
  const inside = rows.filter(
    (row) => row.endTime.getTime() > window.from.getTime() && row.endTime.getTime() <= window.to.getTime(),
  );

  const totals = {} as PageTotals;
  for (const key of Object.keys(PAGE_METRICS) as Array<keyof PageTotals>) {
    const names = PAGE_METRICS[key];
    const byDay = new Map<string, { rank: number; value: number }>();
    for (const row of inside) {
      const rank = names.indexOf(row.metric);
      if (rank === -1 || row.numeric === null) continue;
      const day = row.endTime.toISOString().slice(0, 10);
      const held = byDay.get(day);
      if (!held || rank < held.rank) byDay.set(day, { rank, value: row.numeric });
    }
    totals[key] =
      byDay.size === 0 ? null : Math.round([...byDay.values()].reduce((sum, day) => sum + day.value, 0));
  }
  return totals;
}

/** Every metric name the totals read, for a query that loads many Pages at once. */
export const PAGE_TOTAL_METRICS = Object.values(PAGE_METRICS).flat();

async function findPage(workspaceId: string, targetId: string) {
  const page = await prisma.target.findFirst({
    where: { id: targetId, workspaceId, type: TargetType.page },
  });
  if (!page) throw errors.destinationNotFound();
  return page;
}

/** When this Page's figures were last refreshed from Facebook, by any route. */
async function lastSynced(targetId: string, profileSyncedAt: Date | null): Promise<Date | null> {
  // Not `Target.lastSyncedAt`, which records the destination list being
  // refreshed on connect and says nothing about when figures were last read.
  const [ours, found, insight] = await Promise.all([
    prisma.postTarget.aggregate({ where: { targetId }, _max: { insightsSyncedAt: true } }),
    prisma.externalPost.aggregate({ where: { targetId }, _max: { insightsSyncedAt: true } }),
    prisma.pageInsight.aggregate({ where: { targetId }, _max: { fetchedAt: true } }),
  ]);
  const times = [profileSyncedAt, ours._max.insightsSyncedAt, found._max.insightsSyncedAt, insight._max.fetchedAt]
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

export interface PageAnalysisResult extends PageAnalysis {
  page: { id: string; name: string; pictureUrl: string | null; followers: number | null };
  window: { from: Date; to: Date; previousFrom: Date };
  lastSyncedAt: Date | null;
}

/** The whole analysis of one Page, over `from`–`to`, against the period before. */
export async function analysePage(options: {
  workspaceId: string;
  targetId: string;
  from: Date;
  to: Date;
  timeZone: string;
  now?: Date;
  compare?: CompareMode;
}): Promise<PageAnalysisResult> {
  const page = await findPage(options.workspaceId, options.targetId);
  const now = options.now ?? new Date();

  const before = comparisonWindow(options.from, options.to, options.compare ?? 'previous');
  const previousFrom = before.from;
  const timingFrom = new Date(
    Math.min(options.from.getTime(), options.to.getTime() - TIMING_LOOKBACK_DAYS * DAY_MS),
  );

  const [current, previous, timing, totals, syncedAt] = await Promise.all([
    loadPagePosts(page.id, options.from, options.to),
    loadPagePosts(page.id, previousFrom, new Date(before.to.getTime() - 1)),
    loadPagePosts(page.id, timingFrom, options.to),
    loadPageTotals(page.id, [
      { from: options.from, to: options.to },
      { from: previousFrom, to: before.to },
    ]),
    lastSynced(page.id, page.profileSyncedAt),
  ]);

  const followers = page.followersCount ?? page.fanCount;

  return {
    ...analyse({
      current,
      previous,
      timing,
      currentTotals: totals[0]!,
      previousTotals: totals[1]!,
      followers,
      from: options.from,
      to: options.to,
      timeZone: options.timeZone,
      lastSyncedAt: syncedAt,
      now,
    }),
    page: { id: page.id, name: page.name, pictureUrl: page.pictureUrl, followers },
    window: { from: options.from, to: options.to, previousFrom },
    lastSyncedAt: syncedAt,
  };
}

export interface PageComparisonRow {
  targetId: string;
  name: string;
  pictureUrl: string | null;
  followers: number | null;
  posts: number;
  perWeek: number;
  interactions: number;
  avgInteractions: number | null;
  avgInteractionsChange: number | null;
  medianRate: number | null;
  reach: number | null;
  netFollows: number | null;
  health: Health;
  /** Day by day over the window, for the chart with one line per Page. */
  daily: Pick<DailySeries, 'days' | 'posts' | 'interactions' | 'reach'>;
  /** Follows gained and lost over the window; null where Meta serves none. */
  follows: number | null;
  unfollows: number | null;
  /** The same figures over the comparison window (previous period or last year). */
  previous: {
    followers: number | null;
    posts: number;
    interactions: number;
    reach: number | null;
    netFollows: number | null;
    daily: Pick<DailySeries, 'days' | 'posts' | 'interactions' | 'reach'>;
  };
  /** The Page's three strongest posts of the window, by interactions. */
  top: AnalysedPost[];
  /** Every post of the window, for a combined time-of-day grid. */
  postList: AnalysedPost[];
  /** What the numbers say about this Page (see `findings()`). */
  findings: Finding[];
}

/**
 * Every Page in the workspace side by side, on the same figures and the same
 * window — the question an agency asks first: which client needs attention.
 */
export async function comparePages(options: {
  workspaceId: string;
  from: Date;
  to: Date;
  timeZone: string;
  compare?: CompareMode;
  /** Only these Pages: a member's own, or one group's. */
  targetIds?: string[];
}): Promise<PageComparisonRow[]> {
  const pages = await prisma.target.findMany({
    where: {
      workspaceId: options.workspaceId,
      type: TargetType.page,
      ...(options.targetIds ? { id: { in: options.targetIds } } : {}),
    },
    orderBy: { name: 'asc' },
  });

  const baseline = comparisonWindow(options.from, options.to, options.compare ?? 'previous');
  const previousFrom = baseline.from;

  // One Page at a time: a workspace has a handful, and each is a few queries.
  const rows: PageComparisonRow[] = [];
  for (const page of pages) {
    const [current, previous, totals, syncedAt, followerSnapshot] = await Promise.all([
      loadPagePosts(page.id, options.from, options.to),
      loadPagePosts(page.id, previousFrom, new Date(baseline.to.getTime() - 1)),
      loadPageTotals(page.id, [
        { from: options.from, to: options.to },
        { from: previousFrom, to: baseline.to },
      ]),
      lastSynced(page.id, page.profileSyncedAt),
      prisma.pageInsight.findFirst({
        where: {
          targetId: page.id, metric: 'page_follows', period: 'day', numeric: { not: null },
          endTime: { lte: baseline.to, gte: new Date(baseline.to.getTime() - 7 * DAY_MS) },
        },
        orderBy: { endTime: 'desc' },
        select: { numeric: true },
      }),
    ]);

    const now = summarise(current);
    const before = summarise(previous);
    const kpis = compareKpis({
      current: now,
      previous: before,
      currentTotals: totals[0]!,
      previousTotals: totals[1]!,
    });
    const rhythm = cadence(current, options.from, options.to, options.timeZone);
    const followers = page.followersCount ?? page.fanCount;
    const ranked = [...current].sort(
      (a, b) => b.interactions - a.interactions || b.publishedAt.getTime() - a.publishedAt.getTime(),
    );

    rows.push({
      targetId: page.id,
      name: page.name,
      pictureUrl: page.pictureUrl,
      followers,
      posts: now.posts,
      perWeek: rhythm.perWeek,
      interactions: now.interactions,
      avgInteractions: now.avgInteractions,
      avgInteractionsChange: kpis.find((kpi) => kpi.key === 'avgInteractions')?.change ?? null,
      medianRate: now.medianRate,
      reach: kpis.find((kpi) => kpi.key === 'reach')?.current ?? null,
      netFollows: netFollows(totals[0]!),
      health: healthScore({ cadence: rhythm, kpis, followers }),
      daily: dailySeries(current, options.from, options.to, options.timeZone),
      follows: totals[0]!.follows,
      unfollows: totals[0]!.unfollows,
      previous: {
        followers: page.followersCount === null ? null : followerSnapshot?.numeric ?? null,
        posts: before.posts,
        interactions: before.interactions,
        reach: kpis.find((kpi) => kpi.key === 'reach')?.previous ?? null,
        netFollows: netFollows(totals[1]!),
        daily: dailySeries(previous, previousFrom, new Date(baseline.to.getTime() - 1), options.timeZone),
      },
      top: ranked.slice(0, 3),
      postList: current,
      findings: findings({
        kpis,
        cadence: rhythm,
        formats: formatBreakdown(current),
        times: bestTimes(current, options.timeZone),
        top: ranked.slice(0, 5),
        medianInteractions: median(current.map((post) => post.interactions)),
        lastSyncedAt: syncedAt,
        now: new Date(),
      }),
    });
  }

  return rows;
}
