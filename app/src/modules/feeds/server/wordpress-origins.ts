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

/** Diagnostic (2026-11-22): feed copies whose id still differs from their app post's, and a sample of feed ids per Page. */
export async function idCheck(workspaceId: string) {
  const mismatched = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM external_posts e JOIN targets t ON t.id = e."targetId" AND t."workspaceId" = ${workspaceId}
    JOIN post_targets pt ON pt."targetId" = e."targetId" AND split_part(pt."remotePostId", '_', 2) <> '' AND split_part(pt."remotePostId", '_', 2) = split_part(e."remoteId", '_', 2) AND e."remoteId" <> pt."remotePostId"`;
  const samples = await prisma.$queryRaw<Array<{ name: string; feed: string | null; app: string | null }>>`SELECT t.name,
      (SELECT e."remoteId" FROM external_posts e WHERE e."targetId" = t.id ORDER BY e."createdTime" DESC LIMIT 1) AS feed,
      (SELECT pt."remotePostId" FROM post_targets pt WHERE pt."targetId" = t.id AND pt."remotePostId" IS NOT NULL ORDER BY pt."publishedAt" DESC NULLS LAST LIMIT 1) AS app
    FROM targets t WHERE t."workspaceId" = ${workspaceId} AND t.type = 'page' ORDER BY t.name`;
  const coverage = await prisma.$queryRaw<Array<{ name: string; published: number; withCopy: number; withReach: number; feedRows: number; feedWithReach: number }>>`SELECT t.name,
      (SELECT COUNT(*)::int FROM post_targets pt WHERE pt."targetId" = t.id AND pt.status::text = 'published' AND pt."publishedAt" > NOW() - INTERVAL '30 days') AS published,
      (SELECT COUNT(*)::int FROM post_targets pt JOIN external_posts e ON e."targetId" = pt."targetId" AND e."remoteId" = pt."remotePostId" WHERE pt."targetId" = t.id AND pt.status::text = 'published' AND pt."publishedAt" > NOW() - INTERVAL '30 days') AS "withCopy",
      (SELECT COUNT(*)::int FROM post_targets pt JOIN external_posts e ON e."targetId" = pt."targetId" AND e."remoteId" = pt."remotePostId" WHERE pt."targetId" = t.id AND pt.status::text = 'published' AND pt."publishedAt" > NOW() - INTERVAL '30 days' AND e.insights IS NOT NULL) AS "withReach",
      (SELECT COUNT(*)::int FROM external_posts e WHERE e."targetId" = t.id AND e."createdTime" > NOW() - INTERVAL '30 days') AS "feedRows",
      (SELECT COUNT(*)::int FROM external_posts e WHERE e."targetId" = t.id AND e."createdTime" > NOW() - INTERVAL '30 days' AND e.insights IS NOT NULL) AS "feedWithReach"
    FROM targets t WHERE t."workspaceId" = ${workspaceId} AND t.type = 'page' AND t.name IN ('Recettes - Faciles', 'Cuisine Pleine d’Envie', 'Recettes Sans Soucis') ORDER BY t.name`;
  return { mismatched: Number(mismatched[0]?.count ?? 0), coverage };
}
