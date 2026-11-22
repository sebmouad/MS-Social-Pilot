import { prisma } from '@/server/data';

/**
 * How posts did by the way they went out (2026-11-21, owner: « my manual posts from the Facebook app get better reach;
 * compare Facebook's planner with holding in the app »). For each Page, over the last `days`: posts handed to Facebook's
 * own scheduler (`nativeScheduledFor`), posts the app held and published itself, and posts made outside the app (by hand
 * on the phone, another tool). Each post's reach is also read against its Page's median, so Pages can be pooled.
 * Read-only.
 */
export type OriginRow = { targetId: string; name: string; origin: 'facebook_scheduler' | 'app_held' | 'outside'; posts: number; median: number; relative: number };
export async function reachByOrigin(workspaceId: string, now: Date, days = 30): Promise<OriginRow[]> {
  return prisma.$queryRaw<OriginRow[]>`
    WITH ep AS (
      SELECT e."targetId", e."remoteId", COALESCE((e.insights->>'post_total_media_view_unique')::numeric, (e.insights->>'reach')::numeric) AS reach
      FROM external_posts e JOIN targets t ON t.id = e."targetId" AND t."workspaceId" = ${workspaceId}
      WHERE e."createdTime" > ${new Date(now.getTime() - days * 86_400_000)} AND e."createdTime" < ${new Date(now.getTime() - 86_400_000)}
        AND e."remoteMissingAt" IS NULL AND COALESCE(e.insights->>'post_total_media_view_unique', e.insights->>'reach') ~ '^[0-9.]+$'),
    tagged AS (
      SELECT ep.*, CASE WHEN pt.id IS NULL THEN 'outside' WHEN pt."nativeScheduledFor" IS NOT NULL THEN 'facebook_scheduler' ELSE 'app_held' END AS origin
      FROM ep LEFT JOIN post_targets pt ON pt."targetId" = ep."targetId" AND pt."remotePostId" = ep."remoteId"),
    usual AS (SELECT "targetId", percentile_cont(0.5) WITHIN GROUP (ORDER BY reach) AS median FROM tagged GROUP BY 1)
    SELECT g."targetId", t.name, g.origin, COUNT(*)::int AS posts,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY g.reach)::float AS median,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY g.reach / NULLIF(u.median, 0))::float AS relative
    FROM tagged g JOIN usual u ON u."targetId" = g."targetId" JOIN targets t ON t.id = g."targetId"
    GROUP BY g."targetId", t.name, g.origin ORDER BY t.name, g.origin`;
}

