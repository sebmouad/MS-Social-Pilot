import { TargetType } from '@prisma/client';

import { prisma } from './prisma';
import { decryptSecret } from './crypto';
import { toJson } from './json';
import { asGraphError } from './facebook/graph';
import { fetchInsights, type MetricSeries } from './facebook/analytics';
import {
  IG_DEMOGRAPHIC_BREAKDOWNS,
  IG_TOTAL_VALUE_METRICS,
  fetchInstagramMedia,
  fetchInstagramProfile,
  findInstagramAccount,
} from './facebook/instagram';
import { IG_ACCOUNT_METRICS, IG_MEDIA_METRICS, findMetric, isServed } from './facebook/metrics';
import { logActivity } from './scheduler/runner';

/**
 * Instagram Business analytics.
 *
 * Discovery, storage and read-back for accounts linked to connected Pages. The
 * Graph shape is the same as Facebook's, so the resilient fetcher is reused
 * wholesale — but the vocabulary differs in three ways that each need handling:
 *
 * 1. Some metrics only exist under `metric_type=total_value`.
 * 2. Demographic metrics are refused without a `breakdown` parameter.
 * 3. Names like `impressions` collide with the media-level catalogue, so every
 *    lookup passes a level.
 */

function tokenFor(entity: {
  target: { accessToken: string | null } | null;
  socialAccount: { accessToken: string } | null;
}): string | null {
  const encrypted = entity.target?.accessToken ?? entity.socialAccount?.accessToken ?? null;
  return encrypted ? decryptSecret(encrypted) : null;
}

export interface IgSyncResult {
  accountId: string;
  username: string;
  stored: number;
  media: number;
  error?: string;
}

/**
 * Find Instagram accounts behind every connected Page in a workspace.
 *
 * Safe to re-run: an account already discovered is refreshed, not duplicated.
 * A Page with no linked account is simply skipped, which is most Pages.
 */
export async function discoverInstagramAccounts(workspaceId: string): Promise<{
  found: number;
  errors: string[];
}> {
  const targets = await prisma.target.findMany({
    where: { workspaceId, type: TargetType.page, enabled: true },
    include: { socialAccount: true },
  });

  let found = 0;
  const errors: string[] = [];

  for (const target of targets) {
    const token = tokenFor({ target, socialAccount: target.socialAccount });
    if (!token) continue;

    try {
      const ref = await findInstagramAccount(target.providerId, token);
      if (!ref) continue;

      const profile = await fetchInstagramProfile(ref.igUserId, token).catch(() => null);

      await prisma.instagramAccount.upsert({
        where: { workspaceId_igUserId: { workspaceId, igUserId: ref.igUserId } },
        create: {
          workspaceId,
          socialAccountId: target.socialAccountId,
          targetId: target.id,
          igUserId: ref.igUserId,
          username: profile?.username ?? ref.username,
          name: profile?.name ?? null,
          profilePictureUrl: profile?.profilePictureUrl ?? null,
          followersCount: profile?.followersCount ?? null,
          followsCount: profile?.followsCount ?? null,
          mediaCount: profile?.mediaCount ?? null,
        },
        update: {
          // Re-point at the Page we just read it through: the previous Page may
          // have been disconnected since.
          targetId: target.id,
          socialAccountId: target.socialAccountId,
          username: profile?.username ?? ref.username,
          name: profile?.name ?? null,
          profilePictureUrl: profile?.profilePictureUrl ?? null,
          followersCount: profile?.followersCount ?? null,
          followsCount: profile?.followsCount ?? null,
          mediaCount: profile?.mediaCount ?? null,
        },
      });

      await upsertInstagramTarget({
        workspaceId,
        page: target,
        igUserId: ref.igUserId,
        username: profile?.username ?? ref.username,
        pictureUrl: profile?.profilePictureUrl ?? null,
        followersCount: profile?.followersCount ?? null,
      });

      found += 1;
    } catch (error) {
      errors.push(`${target.name}: ${asGraphError(error).displayMessage}`);
    }
  }

  if (found > 0) await logActivity(workspaceId, 'instagram.discovered', { found });

  return { found, errors };
}

/**
 * Make the Instagram account a place a post can be sent.
 *
 * An Instagram account is reached through the Page it is linked to, using that
 * Page's token — so the destination row is a copy of the Page's credentials
 * pointed at a different id. Keeping it as a Target rather than a special case
 * means the composer, the calendar, the queue, the post list and per-destination
 * failure reporting all work on it without knowing what it is.
 *
 * `canPublish` starts false. Publishing to Instagram needs
 * `instagram_content_publish`, which is a separate App Review from the one that
 * lets us read insights, and offering a destination that will be refused is
 * worse than not offering it. The connections screen turns it on once the
 * permission is actually granted.
 */
async function upsertInstagramTarget(options: {
  workspaceId: string;
  page: { id: string; socialAccountId: string | null; accessToken: string | null };
  igUserId: string;
  username: string;
  pictureUrl: string | null;
  followersCount: number | null;
}): Promise<void> {
  const shared = {
    name: `@${options.username}`,
    pictureUrl: options.pictureUrl,
    // The Page's own token, because that is what reads and writes this account.
    accessToken: options.page.accessToken,
    socialAccountId: options.page.socialAccountId,
    followersCount: options.followersCount,
  };

  await prisma.target.upsert({
    where: {
      workspaceId_providerId: { workspaceId: options.workspaceId, providerId: options.igUserId },
    },
    create: {
      workspaceId: options.workspaceId,
      type: TargetType.instagram,
      providerId: options.igUserId,
      canPublish: false,
      publishBlocker: INSTAGRAM_PUBLISH_BLOCKER,
      publishBlockerCode: 'instagram_permission',
      ...shared,
    },
    // Deliberately not touching `enabled`, `canPublish` or `publishBlocker`:
    // those are decisions somebody made on the connections screen, and a
    // routine rediscovery must not quietly undo them.
    update: shared,
  });
}

/**
 * Why an Instagram destination starts unavailable.
 *
 * Shown in the composer's destination list, so it has to say what to do rather
 * than only what is wrong.
 */
export const INSTAGRAM_PUBLISH_BLOCKER =
  'Publishing to Instagram needs instagram_content_publish from Meta. Turn this destination on once it is granted.';

/** Store one metric's points against an Instagram account. */
async function storeIgSeries(accountId: string, series: MetricSeries[]): Promise<number> {
  let stored = 0;

  for (const metric of series) {
    for (const point of metric.points) {
      const endTime = point.endTime ? new Date(point.endTime) : new Date();
      if (Number.isNaN(endTime.getTime())) continue;

      const numeric = typeof point.value === 'number' ? point.value : null;

      await prisma.instagramInsight.upsert({
        where: {
          accountId_metric_period_endTime: {
            accountId,
            metric: metric.name,
            period: String(metric.period),
            endTime,
          },
        },
        create: {
          accountId,
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
 * Sync one Instagram account: profile, insights and recent media.
 *
 * The account catalogue is fetched in three passes, because Instagram refuses
 * to serve the three families together: plain time series, `total_value`
 * metrics, and demographics that each need their own `breakdown`.
 */
export async function syncInstagramAccount(options: {
  accountId: string;
  since?: Date;
  until?: Date;
}): Promise<IgSyncResult> {
  const account = await prisma.instagramAccount.findUniqueOrThrow({
    where: { id: options.accountId },
    include: { target: true, socialAccount: true },
  });

  const base: IgSyncResult = {
    accountId: account.id,
    username: account.username,
    stored: 0,
    media: 0,
  };

  const token = tokenFor(account);
  if (!token) return { ...base, error: 'No access token stored for this account.' };

  try {
    const profile = await fetchInstagramProfile(account.igUserId, token);
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: {
        username: profile.username,
        name: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
        followersCount: profile.followersCount,
        followsCount: profile.followsCount,
        mediaCount: profile.mediaCount,
        lastSyncedAt: new Date(),
      },
    });

    // Only what Meta still serves: a retired name is an error that costs the
    // whole request, not an empty column.
    const plain = IG_ACCOUNT_METRICS.filter(
      (metric) =>
        isServed(metric) &&
        metric.periods.includes('day') &&
        !IG_TOTAL_VALUE_METRICS.has(metric.name) &&
        !IG_DEMOGRAPHIC_BREAKDOWNS[metric.name],
    ).map((metric) => metric.name);

    const totalValue = IG_ACCOUNT_METRICS.filter(
      (metric) => isServed(metric) && IG_TOTAL_VALUE_METRICS.has(metric.name) && metric.periods.includes('day'),
    ).map((metric) => metric.name);

    let stored = 0;

    const timeSeries = await fetchInsights({
      objectId: account.igUserId,
      level: 'ig_account',
      accessToken: token,
      period: 'day',
      since: options.since,
      until: options.until,
      only: plain,
    });
    stored += await storeIgSeries(account.id, timeSeries.series);

    if (totalValue.length > 0) {
      const totals = await fetchInsights({
        objectId: account.igUserId,
        level: 'ig_account',
        accessToken: token,
        period: 'day',
        since: options.since,
        until: options.until,
        only: totalValue,
        extraParams: { metric_type: 'total_value' },
      });
      stored += await storeIgSeries(account.id, totals.series);
    }

    // Demographics, one breakdown at a time. The breakdown is folded into the
    // stored metric name so `follower_demographics` by city and by country do
    // not overwrite each other.
    for (const [metric, breakdowns] of Object.entries(IG_DEMOGRAPHIC_BREAKDOWNS)) {
      for (const breakdown of breakdowns) {
        const result = await fetchInsights({
          objectId: account.igUserId,
          level: 'ig_account',
          accessToken: token,
          period: 'lifetime',
          only: [metric],
          extraParams: { metric_type: 'total_value', breakdown, timeframe: 'this_month' },
        }).catch(() => null);

        if (!result) continue;
        stored += await storeIgSeries(
          account.id,
          result.series.map((entry) => ({ ...entry, name: `${entry.name}__${breakdown}` })),
        );
      }
    }

    const media = await syncInstagramMedia(account.id, token, options.since);

    return { ...base, stored, media };
  } catch (error) {
    return { ...base, error: asGraphError(error).displayMessage };
  }
}

/** Store recent media and their per-media insights. */
async function syncInstagramMedia(
  accountId: string,
  token: string,
  since?: Date,
): Promise<number> {
  const account = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: accountId } });
  const items = await fetchInstagramMedia(account.igUserId, token, { since });

  const mediaMetrics = IG_MEDIA_METRICS.filter((metric) => isServed(metric)).map((metric) => metric.name);

  for (const item of items) {
    const insights = await fetchInsights({
      objectId: item.remoteId,
      level: 'ig_media',
      accessToken: token,
      period: 'lifetime',
      only: mediaMetrics,
    }).catch(() => null);

    const metrics: Record<string, number | Record<string, number>> = {};
    for (const entry of insights?.series ?? []) {
      if (entry.latest !== null) metrics[entry.name] = entry.latest;
    }

    await prisma.instagramMedia.upsert({
      where: { accountId_remoteId: { accountId, remoteId: item.remoteId } },
      create: {
        accountId,
        ...item,
        insights: insights ? toJson(metrics) : undefined,
        insightsSyncedAt: insights ? new Date() : null,
      },
      update: {
        caption: item.caption,
        likeCount: item.likeCount,
        commentsCount: item.commentsCount,
        ...(insights ? { insights: toJson(metrics), insightsSyncedAt: new Date() } : {}),
        fetchedAt: new Date(),
      },
    });
  }

  return items.length;
}

/** Sync every enabled Instagram account in a workspace. */
export async function syncWorkspaceInstagram(options: {
  workspaceId: string;
  since?: Date;
  until?: Date;
}): Promise<IgSyncResult[]> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: options.workspaceId, enabled: true },
    select: { id: true },
  });

  const results: IgSyncResult[] = [];
  for (const account of accounts) {
    results.push(
      await syncInstagramAccount({
        accountId: account.id,
        since: options.since,
        until: options.until,
      }),
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

export interface IgAccountSummary {
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  lastSyncedAt: Date | null;
  linkedPage: string | null;
}

export async function listInstagramAccounts(workspaceId: string): Promise<IgAccountSummary[]> {
  const rows = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    include: { target: { select: { name: true } } },
    orderBy: { username: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    name: row.name,
    profilePictureUrl: row.profilePictureUrl,
    followersCount: row.followersCount,
    followsCount: row.followsCount,
    mediaCount: row.mediaCount,
    lastSyncedAt: row.lastSyncedAt,
    linkedPage: row.target?.name ?? null,
  }));
}

export interface IgStoredSeries {
  metric: string;
  label: string;
  description: string;
  category: string;
  period: string;
  breakdown: boolean;
  points: Array<{ endTime: string; value: number | Record<string, number> }>;
  total: number | null;
  latest: number | Record<string, number> | null;
}

function humanise(metric: string): string {
  return metric
    .replace(/__/g, ' by ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function readInstagramInsights(options: {
  accountId: string;
  from: Date;
  to: Date;
}): Promise<IgStoredSeries[]> {
  const rows = await prisma.instagramInsight.findMany({
    where: { accountId: options.accountId, endTime: { gte: options.from, lte: options.to } },
    orderBy: [{ metric: 'asc' }, { endTime: 'asc' }],
  });

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.metric}::${row.period}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const series: IgStoredSeries[] = [];

  for (const [key, bucket] of grouped) {
    const [metricName, period] = key.split('::') as [string, string];
    // Demographic rows carry a `__breakdown` suffix that is not in the
    // catalogue; the base name is what has a definition.
    const definition = findMetric(metricName.split('__')[0]!, 'ig_account');

    const numeric = bucket
      .map((row) => row.numeric)
      .filter((value): value is number => value !== null);
    const isBreakdown = definition?.breakdown ?? numeric.length === 0;

    const points = bucket.map((row) => ({
      endTime: row.endTime.toISOString(),
      value: (row.numeric ?? row.value) as number | Record<string, number>,
    }));

    series.push({
      metric: metricName,
      label: humanise(metricName),
      description: definition?.description ?? '',
      category: definition?.category ?? 'engagement',
      period,
      breakdown: isBreakdown,
      points,
      total: isBreakdown ? null : numeric.reduce((sum, value) => sum + value, 0),
      latest: points.length > 0 ? points[points.length - 1]!.value : null,
    });
  }

  return series.sort((a, b) => a.category.localeCompare(b.category) || a.metric.localeCompare(b.metric));
}

export interface IgMediaRow {
  id: string;
  caption: string;
  mediaType: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: Date;
  likeCount: number | null;
  commentsCount: number | null;
  reach: number | null;
  impressions: number | null;
  saved: number | null;
  videoViews: number | null;
  totalInteractions: number | null;
  metrics: Record<string, number | Record<string, number>>;
}

export async function readInstagramMedia(options: {
  accountId: string;
  limit?: number;
}): Promise<IgMediaRow[]> {
  const rows = await prisma.instagramMedia.findMany({
    where: { accountId: options.accountId },
    orderBy: { timestamp: 'desc' },
    take: options.limit ?? 100,
  });

  return rows.map((row) => {
    const metrics =
      row.insights && typeof row.insights === 'object' && !Array.isArray(row.insights)
        ? (row.insights as Record<string, number | Record<string, number>>)
        : {};

    const number = (name: string): number | null =>
      typeof metrics[name] === 'number' ? (metrics[name] as number) : null;

    return {
      id: row.id,
      caption: row.caption ?? '(no caption)',
      mediaType: row.mediaType,
      permalink: row.permalink,
      thumbnailUrl: row.thumbnailUrl ?? row.mediaUrl,
      timestamp: row.timestamp,
      likeCount: row.likeCount,
      commentsCount: row.commentsCount,
      reach: number('reach'),
      impressions: number('impressions') ?? number('views'),
      saved: number('saved'),
      videoViews: number('video_views') ?? number('plays'),
      totalInteractions: number('total_interactions'),
      metrics,
    };
  });
}
