import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';

export type PostReach = { value: number | null; measured: number };

/**
 * Stored per-post reach for the posts list. Each published destination contributes the reach from its own
 * snapshot, or the one stored on the linked synced remote copy when the destination has never synced (the same
 * fallback as the destination-measures cohort). Reads stored data only, never the provider. A post with no
 * measured destination reports null, never zero. A failure returns an empty map: reach is decoration and must
 * never stop Posts from loading.
 */
export async function loadPostReach(workspaceId: string, postIds: readonly string[]): Promise<Map<string, PostReach>> {
  const result = new Map<string, PostReach>();
  const ids = [...new Set(postIds)].filter(id => typeof id === 'string' && id.length > 0);
  if (!ids.length) return result;
  try {
    const rows = await prisma.$queryRaw<Array<{ postId: string; reach: string | null; measured: string }>>(Prisma.sql`
      SELECT "postId", SUM("reachValue")::text AS reach, COUNT(*) FILTER (WHERE "reachValue" IS NOT NULL)::text AS measured FROM (
        SELECT pt."postId" AS "postId",
          CASE WHEN (COALESCE(CASE WHEN pt."insightsSyncedAt" IS NULL THEN ep.insights ELSE pt.insights END, '{}'::jsonb)->>'reach') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (COALESCE(CASE WHEN pt."insightsSyncedAt" IS NULL THEN ep.insights ELSE pt.insights END, '{}'::jsonb)->>'reach')::double precision END AS "reachValue"
        FROM post_targets pt JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
        LEFT JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
        WHERE pt."postId" IN (${Prisma.join(ids)}) AND p."workspaceId" = ${workspaceId} AND t."workspaceId" = ${workspaceId} AND pt.status = 'published'
      ) targets GROUP BY "postId"`);
    for (const row of rows) {
      const measured = Number.parseInt(row.measured, 10);
      const value = row.reach === null ? null : Number(row.reach);
      result.set(row.postId, {
        value: measured > 0 && value !== null && Number.isFinite(value) ? value : null,
        measured: Number.isSafeInteger(measured) && measured > 0 ? measured : 0,
      });
    }
  } catch {
    return new Map();
  }
  return result;
}
