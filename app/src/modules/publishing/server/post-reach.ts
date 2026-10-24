import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';

export interface DestinationMetric {
  targetId: string;
  targetName: string;
  targetType: string;
  targetPictureUrl: string | null;
  remotePostId: string | null;
  remoteUrl: string | null;
  status: string;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  views: number;
  clicks: number;
  engagement: number;
  syncedAt: Date | null;
  rawInsights?: Record<string, unknown>;
}

export interface PostPerformanceMetrics {
  /** Total reactions and likes across all published destinations */
  likes: number;
  /** Total comments count */
  comments: number;
  /** Total shares count */
  shares: number;
  /** Total reach / unique impressions across destinations */
  reach: number;
  /** Total views / media plays / impressions */
  views: number;
  /** Total link and media clicks */
  clicks: number;
  /** Total engagements (likes + comments + shares + clicks) */
  engagement: number;
  /** Engagement rate percentage (engagement / reach * 100) */
  engagementRate: number;

  /** Backwards compatible reach value for existing callers: reach if positive, or null */
  value: number | null;
  /** Number of destinations with recorded metrics */
  measured: number;

  /** Detailed per-destination breakdown */
  destinations: DestinationMetric[];
  /** When metrics were last synced from provider */
  lastSyncedAt: Date | null;
}

export type PostReach = PostPerformanceMetrics;

type TargetMetricRow = {
  postId: string;
  postTargetId: string;
  targetId: string;
  targetName: string;
  targetType: string;
  targetPictureUrl: string | null;
  status: string;
  remotePostId: string | null;
  remoteUrl: string | null;
  likes: string;
  comments: string;
  shares: string;
  reach: string;
  views: string;
  clicks: string;
  rawInsights: unknown;
  syncedAt: Date | null;
};

/**
 * Loads real platform metrics (likes, comments, reach, views, shares, clicks)
 * across all published destinations for the given posts.
 * Extracts metrics from both post_targets.insights and synced external_posts.insights.
 */
export async function loadPostReach(workspaceId: string, postIds: readonly string[]): Promise<Map<string, PostPerformanceMetrics>> {
  const result = new Map<string, PostPerformanceMetrics>();
  const ids = [...new Set(postIds)].filter(id => typeof id === 'string' && id.length > 0);
  if (!ids.length) return result;

  try {
    const rows = await prisma.$queryRaw<TargetMetricRow[]>(Prisma.sql`
      SELECT
        pt."postId" AS "postId",
        pt.id AS "postTargetId",
        pt."targetId" AS "targetId",
        t.name AS "targetName",
        t.type AS "targetType",
        t."pictureUrl" AS "targetPictureUrl",
        pt.status AS "status",
        pt."remotePostId" AS "remotePostId",
        COALESCE(pt."remoteUrl", ep.permalink) AS "remoteUrl",
        COALESCE(
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'reactions') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'reactions')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'reactions_like') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'reactions_like')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'likes') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'likes')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'likeCount') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'likeCount')::double precision END,
          0
        )::text AS likes,
        COALESCE(
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'comments') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'comments')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'commentsCount') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'commentsCount')::double precision END,
          0
        )::text AS comments,
        COALESCE(
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'shares') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'shares')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'sharesCount') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'sharesCount')::double precision END,
          0
        )::text AS shares,
        COALESCE(
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'post_total_media_view_unique') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'post_total_media_view_unique')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'reach') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'reach')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'post_impressions_unique') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'post_impressions_unique')::double precision END,
          0
        )::text AS reach,
        COALESCE(
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'post_media_view') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'post_media_view')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'post_impressions') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'post_impressions')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'impressions') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'impressions')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'views') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'views')::double precision END,
          0
        )::text AS views,
        COALESCE(
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'clicks') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'clicks')::double precision END,
          CASE WHEN (COALESCE(pt.insights, ep.insights)->>'post_clicks') ~ '^[0-9]+(\.[0-9]+)?$' THEN (COALESCE(pt.insights, ep.insights)->>'post_clicks')::double precision END,
          0
        )::text AS clicks,
        COALESCE(pt.insights, ep.insights) AS "rawInsights",
        COALESCE(pt."insightsSyncedAt", ep."insightsSyncedAt") AS "syncedAt"
      FROM post_targets pt
      JOIN posts p ON p.id = pt."postId"
      JOIN targets t ON t.id = pt."targetId"
      LEFT JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
      WHERE pt."postId" IN (${Prisma.join(ids)})
        AND p."workspaceId" = ${workspaceId}
        AND t."workspaceId" = ${workspaceId}
        AND pt.status = 'published'
    `);

    // Group by postId
    const grouped = new Map<string, TargetMetricRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.postId) ?? [];
      list.push(row);
      grouped.set(row.postId, list);
    }

    for (const [postId, targetRows] of grouped.entries()) {
      let totalLikes = 0;
      let totalComments = 0;
      let totalShares = 0;
      let totalReach = 0;
      let totalViews = 0;
      let totalClicks = 0;
      let measuredCount = 0;
      let latestSync: Date | null = null;

      const destinations: DestinationMetric[] = [];

      for (const row of targetRows) {
        const likes = Number(row.likes) || 0;
        const comments = Number(row.comments) || 0;
        const shares = Number(row.shares) || 0;
        let reach = Number(row.reach) || 0;
        const views = Number(row.views) || 0;
        const clicks = Number(row.clicks) || 0;

        // If reach is 0 but views exist, fallback to views
        if (reach === 0 && views > 0) reach = views;

        const engagement = likes + comments + shares + clicks;
        const hasData = row.syncedAt !== null || likes > 0 || comments > 0 || reach > 0 || views > 0;
        if (hasData) measuredCount++;

        if (row.syncedAt && (!latestSync || row.syncedAt > latestSync)) {
          latestSync = row.syncedAt;
        }

        totalLikes += likes;
        totalComments += comments;
        totalShares += shares;
        totalReach += reach;
        totalViews += views;
        totalClicks += clicks;

        destinations.push({
          targetId: row.targetId,
          targetName: row.targetName,
          targetType: row.targetType,
          targetPictureUrl: row.targetPictureUrl,
          remotePostId: row.remotePostId,
          remoteUrl: row.remoteUrl,
          status: row.status,
          likes,
          comments,
          shares,
          reach,
          views,
          clicks,
          engagement,
          syncedAt: row.syncedAt,
          rawInsights: (row.rawInsights as Record<string, unknown>) ?? undefined,
        });
      }

      // If totalReach is 0 but totalViews > 0, fallback
      if (totalReach === 0 && totalViews > 0) totalReach = totalViews;

      const totalEngagement = totalLikes + totalComments + totalShares + totalClicks;
      const rateBase = totalReach > 0 ? totalReach : totalViews;
      const engagementRate = rateBase > 0 ? Number(((totalEngagement / rateBase) * 100).toFixed(1)) : 0;

      const value = measuredCount > 0 && totalReach > 0 ? totalReach : (measuredCount > 0 ? 0 : null);

      result.set(postId, {
        likes: totalLikes,
        comments: totalComments,
        shares: totalShares,
        reach: totalReach,
        views: totalViews,
        clicks: totalClicks,
        engagement: totalEngagement,
        engagementRate,
        value,
        measured: measuredCount,
        destinations,
        lastSyncedAt: latestSync,
      });
    }
  } catch (err) {
    console.warn('[loadPostReach] Error loading post metrics:', err);
    return new Map();
  }

  return result;
}
