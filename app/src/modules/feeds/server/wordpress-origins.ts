import { prisma } from '@/server/data';

/**
 * How posts did by the way they went out (2026-11-21, owner: « my manual posts from the Facebook app get better reach;
 * compare Facebook's planner with holding in the app »). For each Page, over the last `days`: posts handed to Facebook's
 * own scheduler (`nativeScheduledFor`), posts the app held and published itself, and posts made outside the app (by hand
 * on the phone, another tool). Each post's reach is also read against its Page's median, so Pages can be pooled.
 * Read-only.
 */
export type OriginRow = { targetId: string; name: string; origin: 'facebook_scheduler' | 'app_held' | 'outside'; posts: number; median: number; relative: number;
  /** Reach at 24 hours (2026-11-22): the fair comparison between posts of different ages; null until read. */
  at24h: number | null; read24h: number };
export async function reachByOrigin(workspaceId: string, now: Date, days = 30): Promise<OriginRow[]> {
  return prisma.$queryRaw<OriginRow[]>`
    WITH ep AS (
      SELECT e."targetId", e."remoteId", e."reach24h", COALESCE((e.insights->>'post_total_media_view_unique')::numeric, (e.insights->>'reach')::numeric) AS reach
      FROM external_posts e JOIN targets t ON t.id = e."targetId" AND t."workspaceId" = ${workspaceId}
      WHERE e."createdTime" > ${new Date(now.getTime() - days * 86_400_000)} AND e."createdTime" < ${new Date(now.getTime() - 86_400_000)}
        AND e."remoteMissingAt" IS NULL AND COALESCE(e.insights->>'post_total_media_view_unique', e.insights->>'reach') ~ '^[0-9.]+$'),
    tagged AS (
      SELECT ep.*, CASE WHEN pt.id IS NULL THEN 'outside' WHEN pt."nativeScheduledFor" IS NOT NULL THEN 'facebook_scheduler' ELSE 'app_held' END AS origin
      FROM ep LEFT JOIN post_targets pt ON pt."targetId" = ep."targetId" AND pt."remotePostId" = ep."remoteId"),
    usual AS (SELECT "targetId", percentile_cont(0.5) WITHIN GROUP (ORDER BY reach) AS median FROM tagged GROUP BY 1)
    SELECT g."targetId", t.name, g.origin, COUNT(*)::int AS posts,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY g.reach)::float AS median,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY g.reach / NULLIF(u.median, 0))::float AS relative,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY g."reach24h")::float AS at24h, COUNT(g."reach24h")::int AS read24h
    FROM tagged g JOIN usual u ON u."targetId" = g."targetId" JOIN targets t ON t.id = g."targetId"
    GROUP BY g."targetId", t.name, g.origin ORDER BY t.name, g.origin`;
}


/** Each post of the last `days` with its reach at 3 and 24 hours (2026-11-22), for tests read at the same age. */
export async function postsAtAge(workspaceId: string, now: Date, days = 10) {
  return prisma.$queryRaw<Array<{ name: string; at: Date; origin: string; caption: string | null; reach3h: number | null; reach24h: number | null }>>`
    SELECT t.name, e."createdTime" AS at,
      CASE WHEN pt.id IS NULL THEN 'outside' WHEN pt."nativeScheduledFor" IS NOT NULL THEN 'facebook_scheduler' ELSE 'app_held' END AS origin,
      left(e.message, 300) AS caption, e."reach3h", e."reach24h"
    FROM external_posts e JOIN targets t ON t.id = e."targetId" AND t."workspaceId" = ${workspaceId}
    LEFT JOIN post_targets pt ON pt."targetId" = e."targetId" AND pt."remotePostId" = e."remoteId"
    WHERE e."createdTime" > ${new Date(now.getTime() - days * 86_400_000)} AND e."remoteMissingAt" IS NULL
    ORDER BY e."createdTime" DESC`;
}

/**
 * TEMPORARY diagnostic (2026-11-26, owner: why do posts made outside the app reach far more on Recettes - Faciles?).
 * Asks Facebook, read-only, which app made each recent post of one Page and what kind of post it is. Remove once read.
 */
export async function postMakers(workspaceId: string, pageName: string, now: Date, limit = 16) {
  const rows = await prisma.$queryRaw<Array<{ remoteId: string; at: Date; origin: string; token: string | null; accountToken: string | null; reach: number | null }>>`
    SELECT e."remoteId", e."createdTime" AS at, CASE WHEN pt.id IS NULL THEN 'outside' WHEN pt."nativeScheduledFor" IS NOT NULL THEN 'facebook_scheduler' ELSE 'app_held' END AS origin,
      t."accessToken" AS token, sa."accessToken" AS "accountToken", COALESCE((e.insights->>'post_total_media_view_unique')::numeric, (e.insights->>'reach')::numeric)::float AS reach
    FROM external_posts e JOIN targets t ON t.id = e."targetId" AND t."workspaceId" = ${workspaceId} AND t.name = ${pageName}
    JOIN social_accounts sa ON sa.id = t."socialAccountId"
    LEFT JOIN post_targets pt ON pt."targetId" = e."targetId" AND pt."remotePostId" = e."remoteId"
    WHERE e."createdTime" > ${new Date(now.getTime() - 4 * 86_400_000)} AND e."remoteMissingAt" IS NULL
    ORDER BY e."createdTime" DESC LIMIT ${limit}`;
  const { configuredFacebookConfig } = await import('@/platforms/facebook/runtime');
  const { graphObjectUrl, facebookAppSecretProof } = await import('@/platforms/facebook/protocol');
  const { decryptSecret } = await import('@/server/secret-crypto');
  const config = await configuredFacebookConfig();
  const out = [];
  for (const row of rows) {
    const sealed = row.token ?? row.accountToken; if (!sealed) continue;
    const token = decryptSecret(sealed);
    const url = graphObjectUrl(config, encodeURIComponent(row.remoteId));
    url.searchParams.set('fields', 'application,status_type,is_published,created_time,attachments{media_type,type}');
    url.searchParams.set('access_token', token);
    if (config.appSecretProofEnabled && config.appSecret) url.searchParams.set('appsecret_proof', facebookAppSecretProof(token, config.appSecret));
    const payload = await fetch(url, { signal: AbortSignal.timeout(10_000) }).then(r => r.json()).catch(() => null) as Record<string, unknown> | null;
    const app = payload?.application as { name?: string; id?: string } | undefined;
    const attachments = (payload?.attachments as { data?: Array<{ media_type?: string; type?: string }> } | undefined)?.data ?? [];
    out.push({ at: row.at, origin: row.origin, reach: row.reach, application: app?.name ?? (payload?.error ? 'error: ' + String((payload.error as { message?: string }).message ?? '').slice(0, 80) : null),
      applicationId: app?.id ?? null, statusType: payload?.status_type ?? null, attachment: attachments.map(a => `${a.media_type ?? ''}/${a.type ?? ''}`).join(',') || null });
  }
  return out;
}
