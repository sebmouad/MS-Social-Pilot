import { Prisma } from '../../../generated/client';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import type { DestinationMeasures } from '@/server/platforms/host';

/**
 * Facebook per-destination totals from the insights snapshots stored for a channel's posts in a window (the legacy
 * report's per-destination table). The cohort is every post published to the channel in the window, each remote post
 * counted once: app-published posts (their own snapshot, or the one stored on the linked synced remote copy) plus synced
 * external posts that no published app post already covers. A measure no post has stored is unknown (null), never zero;
 * `measuredPosts` shows how many posts the sum is based on. Reads stored data only.
 */
const MEASURES: Array<[key: string, label: string]> = [
  ['impressions', 'Impressions'], ['reach', 'Reach (sum per post; people may repeat)'], ['reactions', 'Reactions'], ['comments', 'Comments'], ['shares', 'Shares'],
];
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function facebookDestinationMeasures(insightRows: unknown[], coverage?: { posts: number; truncated: boolean }): DestinationMeasures {
  const objects = insightRows.map(row => row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {});
  return {
    measures: MEASURES.map(([key, label]) => {
      const values = objects.map(row => num(row[key])).filter((value): value is number => value !== null);
      return { key, label, value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, measuredPosts: values.length };
    }),
    ...(coverage ? { coverage } : {}),
  };
}

export type FacebookPostCohort = { insights: unknown[]; posts: number; truncated: boolean };

/** Snapshots of the posts published to one authorized channel in [from, to), deduplicated across remote ids, bounded by `meta.postCohortMaxPosts`. */
export async function readFacebookPostCohort(request: { workspaceId: string; targetId: string; from: Date; to: Date }): Promise<FacebookPostCohort> {
  const max = (await runtimeConfig('meta.postCohortMaxPosts')) as number;
  const rows = await prisma.$queryRaw<Array<{ insights: unknown }>>(Prisma.sql`
    WITH app AS (
      -- One row per remote post: a retried or duplicated target never counts twice. Current insights may live on the synced remote copy.
      SELECT DISTINCT ON (COALESCE(pt."remotePostId", pt.id)) COALESCE(pt."remotePostId", pt.id) AS key, pt."publishedAt" AS at,
        CASE WHEN pt."insightsSyncedAt" IS NULL AND ep."insightsSyncedAt" IS NOT NULL THEN ep.insights ELSE pt.insights END AS insights
      FROM post_targets pt JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
      LEFT JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
      WHERE pt."targetId" = ${request.targetId} AND t."workspaceId" = ${request.workspaceId} AND p."workspaceId" = ${request.workspaceId}
        AND pt.status = 'published' AND pt."publishedAt" >= ${request.from} AND pt."publishedAt" < ${request.to}
      ORDER BY COALESCE(pt."remotePostId", pt.id), pt."publishedAt" DESC
    ), external AS (
      SELECT ep."remoteId" AS key, ep."createdTime" AS at, ep.insights
      FROM external_posts ep JOIN targets t ON t.id = ep."targetId"
      WHERE ep."targetId" = ${request.targetId} AND t."workspaceId" = ${request.workspaceId}
        AND ep."createdTime" >= ${request.from} AND ep."createdTime" < ${request.to}
        AND NOT EXISTS (SELECT 1 FROM post_targets pt JOIN posts p ON p.id = pt."postId" WHERE pt."targetId" = ep."targetId" AND p."workspaceId" = t."workspaceId" AND pt."remotePostId" = ep."remoteId" AND pt.status = 'published')
    )
    SELECT insights FROM (SELECT key, at, insights FROM app UNION ALL SELECT key, at, insights FROM external) cohort
    ORDER BY at DESC, key ASC LIMIT ${max + 1}`);
  const truncated = rows.length > max;
  const kept = truncated ? rows.slice(0, max) : rows;
  return { insights: kept.map(row => row.insights), posts: kept.length, truncated };
}

export async function readFacebookDestinationMeasures(request: { workspaceId: string; targetId: string; from: Date; to: Date }): Promise<DestinationMeasures> {
  const cohort = await readFacebookPostCohort(request);
  return facebookDestinationMeasures(cohort.insights, { posts: cohort.posts, truncated: cohort.truncated });
}
