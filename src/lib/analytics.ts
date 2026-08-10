import { TargetType } from '@prisma/client';

import { prisma } from './prisma';
import { decryptSecret } from './crypto';
import { parseInsights, toJson } from './json';
import { asGraphError } from './facebook/graph';
import {
  fetchInsights,
  fetchPageProfile,
  probeMetrics,
  type MetricSeries,
  type UnavailableMetric,
} from './facebook/analytics';
import {
  CATEGORY_LABELS,
  catalogueSize,
  findMetric,
  type MetricLevel,
  type MetricPeriod,
} from './facebook/metrics';
import { logActivity } from './scheduler/runner';

/**
 * Analytics: pulling Graph data in, storing it, and reading it back.
 *
 * Snapshots are kept because Graph serves only about two years of history and
 * removes metrics between versions. Once a value has been captured it is ours,
 * whatever Meta does next.
 *
 * Groups are skipped throughout: there is no insights edge for a Group, so
 * asking would produce a permission error on every sync.
 */

export interface SyncResult {
  targetId: string;
  targetName: string;
  stored: number;
  metrics: number;
  unavailable: UnavailableMetric[];
  error?: string;
}

function tokenFor(target: {
  accessToken: string | null;
  socialAccount: { accessToken: string } | null;
}): string | null {
  const encrypted = target.accessToken ?? target.socialAccount?.accessToken ?? null;
  return encrypted ? decryptSecret(encrypted) : null;
}

/** Persist one metric's points, replacing any values for the same windows. */
async function storeSeries(targetId: string, series: MetricSeries[]): Promise<number> {
  let stored = 0;

  for (const metric of series) {
    for (const point of metric.points) {
      // Graph omits end_time for some lifetime metrics; the fetch time is the
      // only sensible stamp in that case.
      const endTime = point.endTime ? new Date(point.endTime) : new Date();
      if (Number.isNaN(endTime.getTime())) continue;

      const numeric = typeof point.value === 'number' ? point.value : null;

      await prisma.pageInsight.upsert({
        where: {
          targetId_metric_period_endTime: {
            targetId,
            metric: metric.name,
            period: String(metric.period),
            endTime,
          },
        },
        create: {
          targetId,
          metric: metric.name,
          period: String(metric.period),
          endTime,
          value: toJson(point.value),
          numeric,
        },
        update: { value: toJson(point.value), numeric, fetchedAt: new Date() },
      });
      stored += 1;
    }
  }

  return stored;
}

/**
 * Sync one Page: profile counters, then insights for each period.
 *
 * `day` gives the time series, `lifetime` the standing totals and
 * demographics. Both are needed for a complete picture.
 */
export async function syncTargetAnalytics(options: {
  targetId: string;
  since?: Date;
  until?: Date;
  periods?: MetricPeriod[];
}): Promise<SyncResult> {
  const target = await prisma.target.findUniqueOrThrow({
    where: { id: options.targetId },
    include: { socialAccount: true },
  });

  const base: SyncResult = {
    targetId: target.id,
    targetName: target.name,
    stored: 0,
    metrics: 0,
    unavailable: [],
  };

  if (target.type === TargetType.group) {
    return { ...base, error: 'Facebook does not expose insights for Groups.' };
  }

  const token = tokenFor(target);
  if (!token) return { ...base, error: 'No access token stored for this destination.' };

  try {
    // Profile figures first: they need no insights permission, so they still
    // land even if everything below is refused.
    const profile = await fetchPageProfile(target.providerId, token);
    await prisma.target.update({
      where: { id: target.id },
      data: {
        fanCount: profile.fanCount,
        followersCount: profile.followersCount,
        talkingAboutCount: profile.talkingAboutCount,
        profileSyncedAt: new Date(),
      },
    });

    const periods = options.periods ?? (['day', 'lifetime'] as MetricPeriod[]);
    let stored = 0;
    let metrics = 0;
    const unavailable: UnavailableMetric[] = [];

    for (const period of periods) {
      const result = await fetchInsights({
        objectId: target.providerId,
        level: 'page',
        accessToken: token,
        period,
        // Date range applies to windowed periods only; lifetime ignores it.
        since: period === 'lifetime' ? undefined : options.since,
        until: period === 'lifetime' ? undefined : options.until,
      });

      stored += await storeSeries(target.id, result.series);
      metrics += result.series.length;
      unavailable.push(...result.unavailable);

      // Record availability so the UI can distinguish "Meta refused this" from
      // "this Page had no activity".
      for (const entry of result.unavailable) {
        await prisma.metricAvailability.upsert({
          where: {
            targetId_metric_period: { targetId: target.id, metric: entry.name, period },
          },
          create: {
            targetId: target.id,
            metric: entry.name,
            period,
            available: false,
            reason: entry.reason,
          },
          update: { available: false, reason: entry.reason, checkedAt: new Date() },
        });
      }
      for (const entry of result.series) {
        await prisma.metricAvailability.upsert({
          where: {
            targetId_metric_period: { targetId: target.id, metric: entry.name, period },
          },
          create: { targetId: target.id, metric: entry.name, period, available: true },
          update: { available: true, reason: null, checkedAt: new Date() },
        });
      }
    }

    return { ...base, stored, metrics, unavailable };
  } catch (error) {
    return { ...base, error: asGraphError(error).displayMessage };
  }
}

/** Sync every enabled Page in a workspace. */
export async function syncWorkspaceAnalytics(options: {
  workspaceId: string;
  since?: Date;
  until?: Date;
}): Promise<SyncResult[]> {
  const targets = await prisma.target.findMany({
    where: { workspaceId: options.workspaceId, type: TargetType.page, enabled: true },
    select: { id: true },
  });

  const results: SyncResult[] = [];
  for (const target of targets) {
    results.push(
      await syncTargetAnalytics({
        targetId: target.id,
        since: options.since,
        until: options.until,
      }),
    );
  }

  await logActivity(options.workspaceId, 'analytics.synced', {
    targets: results.length,
    stored: results.reduce((sum, result) => sum + result.stored, 0),
  });

  return results;
}

// ---------------------------------------------------------------------------
// Reading snapshots back
// ---------------------------------------------------------------------------

export interface StoredSeries {
  metric: string;
  period: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  breakdown: boolean;
  points: Array<{ endTime: string; value: number | Record<string, number> }>;
  total: number | null;
  latest: number | Record<string, number> | null;
  /** Change against the first half of the window, as a percentage. */
  trend: number | null;
}

function humanise(metric: string): string {
  return metric
    .replace(/^page_|^post_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Percentage change between the first and second half of a series.
 *
 * Returns null when the earlier half is zero: "up from nothing" is not a
 * percentage, and showing ∞% would be worse than showing nothing.
 */
export function trendOf(values: number[]): number | null {
  if (values.length < 4) return null;

  const middle = Math.floor(values.length / 2);
  const earlier = values.slice(0, middle).reduce((sum, value) => sum + value, 0);
  const later = values.slice(middle).reduce((sum, value) => sum + value, 0);

  if (earlier === 0) return null;
  return Math.round(((later - earlier) / earlier) * 100);
}

export async function readStoredAnalytics(options: {
  targetId: string;
  from: Date;
  to: Date;
  period?: string;
}): Promise<StoredSeries[]> {
  const rows = await prisma.pageInsight.findMany({
    where: {
      targetId: options.targetId,
      endTime: { gte: options.from, lte: options.to },
      ...(options.period ? { period: options.period } : {}),
    },
    orderBy: [{ metric: 'asc' }, { endTime: 'asc' }],
  });

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.metric}::${row.period}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const series: StoredSeries[] = [];

  for (const [key, bucket] of grouped) {
    const [metricName, period] = key.split('::') as [string, string];
    const definition = findMetric(metricName);

    const points = bucket.map((row) => ({
      endTime: row.endTime.toISOString(),
      value: (row.numeric ?? row.value) as number | Record<string, number>,
    }));

    const numeric = bucket
      .map((row) => row.numeric)
      .filter((value): value is number => value !== null);

    const isBreakdown = definition?.breakdown ?? numeric.length === 0;

    series.push({
      metric: metricName,
      period,
      label: humanise(metricName),
      description: definition?.description ?? '',
      category: definition?.category ?? 'engagement',
      categoryLabel: CATEGORY_LABELS[definition?.category ?? 'engagement'],
      breakdown: isBreakdown,
      points,
      total: isBreakdown ? null : numeric.reduce((sum, value) => sum + value, 0),
      latest: points.length > 0 ? points[points.length - 1]!.value : null,
      trend: isBreakdown ? null : trendOf(numeric),
    });
  }

  return series.sort((a, b) => a.category.localeCompare(b.category) || a.metric.localeCompare(b.metric));
}

/** What Graph last told us it would and would not serve for this destination. */
export async function readAvailability(targetId: string) {
  const rows = await prisma.metricAvailability.findMany({
    where: { targetId },
    orderBy: [{ available: 'desc' }, { metric: 'asc' }],
  });

  return rows.map((row) => {
    const definition = findMetric(row.metric);
    return {
      metric: row.metric,
      label: humanise(row.metric),
      period: row.period,
      available: row.available,
      reason: row.reason,
      checkedAt: row.checkedAt,
      description: definition?.description ?? '',
      category: definition?.category ?? 'engagement',
      level: definition?.level ?? 'page',
      // A metric Meta announced the removal of explains its own absence.
      deprecatedFrom: definition?.deprecatedFrom ?? null,
    };
  });
}

export interface CoverageRow {
  level: MetricLevel;
  catalogue: number;
  checked: number;
  available: number;
  unavailable: number;
}

/**
 * How much of the catalogue this destination has actually been shown to serve.
 *
 * The honest version of "all available metrics": the catalogue is what we know
 * to ask for, and this is what came back. A level with `checked: 0` has never
 * been probed, which is different from a level Meta refuses.
 */
export async function readCoverage(targetId: string): Promise<CoverageRow[]> {
  const rows = await prisma.metricAvailability.findMany({
    where: { targetId },
    select: { metric: true, available: true },
  });

  const sizes = catalogueSize();
  const levels: MetricLevel[] = ['page', 'post', 'video', 'ig_account', 'ig_media'];

  return levels.map((level) => {
    const forLevel = rows.filter((row) => findMetric(row.metric)?.level === level);
    return {
      level,
      catalogue: sizes[level],
      checked: forLevel.length,
      available: forLevel.filter((row) => row.available).length,
      unavailable: forLevel.filter((row) => !row.available).length,
    };
  });
}

/**
 * Pick the Graph object a level should be probed against.
 *
 * A post-level probe needs a real post id and a video-level probe a real video
 * id — the catalogue cannot be tested against the Page for either. Returns null
 * when the destination has nothing of that kind yet, which is a fact worth
 * reporting rather than an error.
 */
async function probeSubjectFor(
  level: MetricLevel,
  target: { id: string; providerId: string; workspaceId: string },
): Promise<string | null> {
  if (level === 'page') return target.providerId;

  if (level === 'post') {
    const row = await prisma.postTarget.findFirst({
      where: { targetId: target.id, status: 'published', remotePostId: { not: null } },
      orderBy: { publishedAt: 'desc' },
      select: { remotePostId: true },
    });
    return row?.remotePostId ?? null;
  }

  if (level === 'video') {
    const row = await prisma.pageVideo.findFirst({
      where: { targetId: target.id },
      orderBy: { createdTime: 'desc' },
      select: { remoteId: true },
    });
    return row?.remoteId ?? null;
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { targetId: target.id, enabled: true },
    select: { id: true, igUserId: true },
  });
  if (!account) return null;

  if (level === 'ig_account') return account.igUserId;

  const media = await prisma.instagramMedia.findFirst({
    where: { accountId: account.id },
    orderBy: { timestamp: 'desc' },
    select: { remoteId: true },
  });
  return media?.remoteId ?? null;
}

/**
 * Live probe against Graph, bypassing stored snapshots.
 *
 * Answers the question no amount of reading Meta's docs will: what this app, on
 * this pinned Graph version, with the permissions it was actually granted, can
 * retrieve for this destination today. Results are written to
 * `MetricAvailability`, so the UI can distinguish "Meta refused this" from
 * "this Page had no activity" without re-probing on every render.
 */
export async function probeTarget(
  targetId: string,
  period?: MetricPeriod,
  level: MetricLevel = 'page',
) {
  const target = await prisma.target.findUniqueOrThrow({
    where: { id: targetId },
    include: { socialAccount: true },
  });

  if (target.type === TargetType.group) {
    throw new Error('Facebook does not expose insights for Groups.');
  }

  const token = tokenFor(target);
  if (!token) throw new Error('No access token stored for this destination.');

  const objectId = await probeSubjectFor(level, target);
  if (!objectId) return [];

  const results = await probeMetrics({ objectId, level, accessToken: token, period });

  for (const entry of results) {
    await prisma.metricAvailability.upsert({
      where: {
        targetId_metric_period: {
          targetId: target.id,
          metric: entry.name,
          period: String(entry.period),
        },
      },
      create: {
        targetId: target.id,
        metric: entry.name,
        period: String(entry.period),
        available: entry.available,
        reason: entry.reason,
      },
      update: { available: entry.available, reason: entry.reason, checkedAt: new Date() },
    });
  }

  return results;
}

/**
 * Probe every level in one pass.
 *
 * This is what fills the coverage panel: 354 catalogue names checked against a
 * real Page, a real post, a real video and, where linked, a real Instagram
 * account and media item.
 */
export async function probeAllLevels(targetId: string): Promise<
  Array<{ level: MetricLevel; period: MetricPeriod; checked: number; available: number; skipped?: string }>
> {
  const passes: Array<{ level: MetricLevel; period: MetricPeriod }> = [
    { level: 'page', period: 'day' },
    { level: 'page', period: 'lifetime' },
    { level: 'post', period: 'lifetime' },
    { level: 'video', period: 'lifetime' },
    { level: 'ig_account', period: 'day' },
    { level: 'ig_media', period: 'lifetime' },
  ];

  const summary = [];

  for (const pass of passes) {
    try {
      const results = await probeTarget(targetId, pass.period, pass.level);
      summary.push({
        ...pass,
        checked: results.length,
        available: results.filter((entry) => entry.available).length,
        // Nothing of that kind exists yet: no post, no video, no linked
        // Instagram account. Worth saying, rather than reporting zero coverage.
        ...(results.length === 0 ? { skipped: 'Nothing of this kind to probe against.' } : {}),
      });
    } catch (error) {
      summary.push({
        ...pass,
        checked: 0,
        available: 0,
        skipped: asGraphError(error).displayMessage,
      });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Post-level analytics
// ---------------------------------------------------------------------------

/** Pull a named number out of a Graph series list. */
function numberOf(series: MetricSeries[], name: string): number | null {
  const entry = series.find((item) => item.name === name);
  return typeof entry?.latest === 'number' ? entry.latest : null;
}

/** Pull a named breakdown map out of a Graph series list. */
function mapOf(series: MetricSeries[], name: string): Record<string, number> | undefined {
  const entry = series.find((item) => item.name === name);
  return entry && entry.latest && typeof entry.latest === 'object' ? entry.latest : undefined;
}

/**
 * Read the whole post catalogue for one Facebook post id.
 *
 * Shared by scheduled posts and by posts found on the Page that never went
 * through this app: the numbers mean the same thing either way, and having one
 * reader is what keeps the two from drifting into different definitions of
 * "impressions".
 */
export async function readPostCatalogue(options: {
  remotePostId: string;
  accessToken: string;
  /** Groups have no insights edge, so only the object counters are attempted. */
  isPage: boolean;
}): Promise<{ payload: ReturnType<typeof buildPostInsights>; permalink: string | null; count: number }> {
  const { fetchInsights, fetchPostEngagement } = await import('./facebook/analytics');

  const [engagement, insights] = await Promise.all([
    fetchPostEngagement(options.remotePostId, options.accessToken).catch(() => null),
    options.isPage
      ? fetchInsights({
          objectId: options.remotePostId,
          level: 'post',
          accessToken: options.accessToken,
          period: 'lifetime',
        })
      : Promise.resolve({ series: [] as MetricSeries[], unavailable: [], empty: [] }),
  ]);

  return {
    payload: buildPostInsights(insights.series, engagement),
    permalink: engagement?.permalink ?? null,
    count: insights.series.length,
  };
}

/** Flatten a Graph series list into the stored PostInsights shape. */
function buildPostInsights(
  series: MetricSeries[],
  engagement: { reactions: number | null; comments: number | null; shares: number | null } | null,
) {
  const metrics: Record<string, number | Record<string, number>> = {};
  for (const entry of series) {
    if (entry.latest !== null) metrics[entry.name] = entry.latest;
  }

  return {
    impressions: numberOf(series, 'post_impressions'),
    reach: numberOf(series, 'post_impressions_unique'),
    engagedUsers: numberOf(series, 'post_engaged_users'),
    reactions: engagement?.reactions ?? null,
    comments: engagement?.comments ?? null,
    shares: engagement?.shares ?? null,
    clicks: numberOf(series, 'post_clicks'),

    impressionsOrganic: numberOf(series, 'post_impressions_organic'),
    impressionsPaid: numberOf(series, 'post_impressions_paid'),
    impressionsViral: numberOf(series, 'post_impressions_viral'),
    impressionsFan: numberOf(series, 'post_impressions_fan'),
    negativeFeedback: numberOf(series, 'post_negative_feedback'),
    videoViews: numberOf(series, 'post_video_views'),
    videoViewTime: numberOf(series, 'post_video_view_time'),
    videoAvgTimeWatched: numberOf(series, 'post_video_avg_time_watched'),

    reactionsByType: mapOf(series, 'post_reactions_by_type_total'),
    clicksByType: mapOf(series, 'post_clicks_by_type'),
    metrics,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Read everything Graph has about one published destination and store it.
 *
 * The named fields on PostInsights stay populated for lists and reports; the
 * complete response goes into `metrics` so the explorer can show the rest
 * without a second round trip.
 */
export async function syncPostInsights(postTargetId: string): Promise<{
  ok: boolean;
  metrics: number;
  error?: string;
}> {
  const row = await prisma.postTarget.findUniqueOrThrow({
    where: { id: postTargetId },
    include: { target: { include: { socialAccount: true } } },
  });

  if (!row.remotePostId) return { ok: false, metrics: 0, error: 'Post has no Facebook id.' };

  const token = tokenFor(row.target);
  if (!token) return { ok: false, metrics: 0, error: 'No access token stored.' };

  try {
    const result = await readPostCatalogue({
      remotePostId: row.remotePostId,
      accessToken: token,
      isPage: row.target.type === TargetType.page,
    });

    await prisma.postTarget.update({
      where: { id: postTargetId },
      data: {
        insights: toJson(result.payload),
        insightsSyncedAt: new Date(),
        ...(result.permalink && !row.remoteUrl ? { remoteUrl: result.permalink } : {}),
      },
    });

    return { ok: true, metrics: result.count };
  } catch (error) {
    return { ok: false, metrics: 0, error: asGraphError(error).displayMessage };
  }
}

/**
 * Read the post catalogue for a post that never went through this app.
 *
 * Without this the "other posts" list is a bare list of text: it can say a
 * colleague posted from the Facebook app, but not whether anyone saw it — and
 * a Page-level report that counts only our own posts understates the Page.
 */
export async function syncExternalPostInsights(externalPostId: string): Promise<{
  ok: boolean;
  metrics: number;
  error?: string;
}> {
  const row = await prisma.externalPost.findUniqueOrThrow({
    where: { id: externalPostId },
    include: { target: { include: { socialAccount: true } } },
  });

  const token = tokenFor(row.target);
  if (!token) return { ok: false, metrics: 0, error: 'No access token stored.' };

  try {
    const result = await readPostCatalogue({
      remotePostId: row.remoteId,
      accessToken: token,
      isPage: row.target.type === TargetType.page,
    });

    await prisma.externalPost.update({
      where: { id: externalPostId },
      data: {
        insights: toJson(result.payload),
        insightsSyncedAt: new Date(),
        ...(result.permalink && !row.permalink ? { permalink: result.permalink } : {}),
      },
    });

    return { ok: true, metrics: result.count };
  } catch (error) {
    return { ok: false, metrics: 0, error: asGraphError(error).displayMessage };
  }
}

export interface PostMetricRow {
  metric: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  value: number | Record<string, number>;
  breakdown: boolean;
  deprecatedFrom: string | null;
}

/**
 * Every catalogue metric stored against one post, ready for the explorer.
 *
 * The headline fields answer "how did this post do". This answers "what else
 * does Facebook know about it", which is the whole reason the full response is
 * kept rather than the seven numbers a table can show.
 */
export async function readPostMetrics(options: {
  postTargetId?: string;
  externalPostId?: string;
  workspaceId: string;
}): Promise<{
  message: string;
  targetName: string;
  publishedAt: Date | null;
  url: string | null;
  syncedAt: Date | null;
  metrics: PostMetricRow[];
} | null> {
  const source = options.postTargetId
    ? await prisma.postTarget
        .findFirst({
          where: { id: options.postTargetId, post: { workspaceId: options.workspaceId } },
          include: { target: { select: { name: true } }, post: { select: { message: true } } },
        })
        .then((row) =>
          row
            ? {
                message: row.post.message,
                targetName: row.target.name,
                publishedAt: row.publishedAt,
                url: row.remoteUrl,
                syncedAt: row.insightsSyncedAt,
                insights: row.insights,
              }
            : null,
        )
    : options.externalPostId
      ? await prisma.externalPost
          .findFirst({
            where: { id: options.externalPostId, target: { workspaceId: options.workspaceId } },
            include: { target: { select: { name: true } } },
          })
          .then((row) =>
            row
              ? {
                  message: row.message ?? '(no text)',
                  targetName: row.target.name,
                  publishedAt: row.createdTime,
                  url: row.permalink,
                  syncedAt: row.insightsSyncedAt,
                  insights: row.insights,
                }
              : null,
          )
      : null;

  if (!source) return null;

  const stored = parseInsights(source.insights)?.metrics ?? {};

  const metrics: PostMetricRow[] = Object.entries(stored).map(([name, value]) => {
    const definition = findMetric(name, 'post');
    return {
      metric: name,
      label: humanise(name),
      description: definition?.description ?? '',
      category: definition?.category ?? 'engagement',
      categoryLabel: CATEGORY_LABELS[definition?.category ?? 'engagement'],
      value,
      breakdown: typeof value === 'object',
      deprecatedFrom: definition?.deprecatedFrom ?? null,
    };
  });

  return {
    message: source.message,
    targetName: source.targetName,
    publishedAt: source.publishedAt,
    url: source.url,
    syncedAt: source.syncedAt,
    metrics: metrics.sort(
      (a, b) => a.category.localeCompare(b.category) || a.metric.localeCompare(b.metric),
    ),
  };
}

export interface PostAnalyticsRow {
  postTargetId: string;
  postId: string;
  message: string;
  targetName: string;
  publishedAt: Date | null;
  url: string | null;
  impressions: number;
  reach: number;
  engagedUsers: number;
  reactions: number;
  comments: number;
  shares: number;
  clicks: number;
  negativeFeedback: number;
  videoViews: number;
  organic: number;
  paid: number;
  reactionsByType: Record<string, number>;
  clicksByType: Record<string, number>;
  /** Engaged users as a share of reach, or null when reach is unknown. */
  engagementRate: number | null;
  syncedAt: Date | null;
}

/**
 * Every published post in a window, with its numbers.
 *
 * This is the "impressions by post" view: one row per post per destination,
 * because the same post can perform very differently on two Pages.
 */
export async function readPostAnalytics(options: {
  workspaceId: string;
  from: Date;
  to: Date;
  targetId?: string;
  limit?: number;
}): Promise<PostAnalyticsRow[]> {
  const rows = await prisma.postTarget.findMany({
    where: {
      status: 'published',
      publishedAt: { gte: options.from, lte: options.to },
      post: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    include: {
      target: { select: { name: true } },
      post: { select: { id: true, message: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: options.limit ?? 200,
  });

  return rows.map((row) => {
    const insights = parseInsights(row.insights);
    const value = (key: keyof NonNullable<typeof insights>): number => {
      const raw = insights?.[key];
      return typeof raw === 'number' ? raw : 0;
    };

    const reach = value('reach');
    const engaged = value('engagedUsers');

    return {
      postTargetId: row.id,
      postId: row.post.id,
      message: row.post.message,
      targetName: row.target.name,
      publishedAt: row.publishedAt,
      url: row.remoteUrl,
      impressions: value('impressions'),
      reach,
      engagedUsers: engaged,
      reactions: value('reactions'),
      comments: value('comments'),
      shares: value('shares'),
      clicks: value('clicks'),
      negativeFeedback: value('negativeFeedback'),
      videoViews: value('videoViews'),
      organic: value('impressionsOrganic'),
      paid: value('impressionsPaid'),
      reactionsByType: insights?.reactionsByType ?? {},
      clicksByType: insights?.clicksByType ?? {},
      // Rate against reach, not impressions: the same person seeing a post
      // three times is one opportunity to engage, not three.
      engagementRate: reach > 0 ? Math.round((engaged / reach) * 1000) / 10 : null,
      syncedAt: row.insightsSyncedAt,
    };
  });
}

export interface InteractionSummary {
  reactionsByType: Record<string, number>;
  clicksByType: Record<string, number>;
  totals: {
    reactions: number;
    comments: number;
    shares: number;
    clicks: number;
    negativeFeedback: number;
    engagedUsers: number;
  };
}

/** How people interacted, aggregated across a window. */
export async function readInteractions(options: {
  workspaceId: string;
  from: Date;
  to: Date;
  targetId?: string;
}): Promise<InteractionSummary> {
  const posts = await readPostAnalytics({ ...options, limit: 1000 });
  const { mergeBreakdowns } = await import('./facebook/insights');

  return {
    reactionsByType: mergeBreakdowns(posts.map((post) => post.reactionsByType)),
    clicksByType: mergeBreakdowns(posts.map((post) => post.clicksByType)),
    totals: {
      reactions: posts.reduce((sum, post) => sum + post.reactions, 0),
      comments: posts.reduce((sum, post) => sum + post.comments, 0),
      shares: posts.reduce((sum, post) => sum + post.shares, 0),
      clicks: posts.reduce((sum, post) => sum + post.clicks, 0),
      negativeFeedback: posts.reduce((sum, post) => sum + post.negativeFeedback, 0),
      engagedUsers: posts.reduce((sum, post) => sum + post.engagedUsers, 0),
    },
  };
}

export interface AudienceSummary {
  /** Standing totals, straight off the Page object. */
  fans: number | null;
  followers: number | null;
  talkingAbout: number | null;
  /** Lifetime demographic breakdowns, most recent snapshot. */
  byCountry: Record<string, number>;
  byCity: Record<string, number>;
  byLocale: Record<string, number>;
  byGenderAge: Record<string, number>;
  /** Daily gains and losses over the window. */
  adds: number;
  removes: number;
  net: number;
}

/**
 * Who the audience is.
 *
 * Demographics are lifetime snapshots rather than windowed series, so the most
 * recent capture is the answer — averaging them would be meaningless.
 */
export async function readAudience(options: {
  targetId: string;
  from: Date;
  to: Date;
}): Promise<AudienceSummary> {
  const target = await prisma.target.findUniqueOrThrow({ where: { id: options.targetId } });

  const latestOf = async (metric: string): Promise<Record<string, number>> => {
    const row = await prisma.pageInsight.findFirst({
      where: { targetId: options.targetId, metric },
      orderBy: { endTime: 'desc' },
    });
    const value = row?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, number>)
      : {};
  };

  const sumOf = async (metric: string): Promise<number> => {
    const result = await prisma.pageInsight.aggregate({
      where: {
        targetId: options.targetId,
        metric,
        endTime: { gte: options.from, lte: options.to },
      },
      _sum: { numeric: true },
    });
    return Math.round(result._sum.numeric ?? 0);
  };

  const [byCountry, byCity, byLocale, byGenderAge, adds, removes] = await Promise.all([
    latestOf('page_fans_country'),
    latestOf('page_fans_city'),
    latestOf('page_fans_locale'),
    latestOf('page_fans_gender_age'),
    sumOf('page_fan_adds'),
    sumOf('page_fan_removes'),
  ]);

  return {
    fans: target.fanCount,
    followers: target.followersCount,
    talkingAbout: target.talkingAboutCount,
    byCountry,
    byCity,
    byLocale,
    byGenderAge,
    adds,
    removes,
    net: adds - removes,
  };
}
