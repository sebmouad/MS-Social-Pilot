import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';

/**
 * « AI info » on the autopilot's recipe posts (2026-11-19, owner: all recipe photos are AI-made, tag them). The AI
 * marker written into the photos (IPTC DigitalSourceType) is not what Facebook labels from when a photo is uploaded
 * through the API; Graph API v27.0 added `is_ai_generated`, accepted only when editing a post that already exists.
 * So each recipe post is marked once, after it is published, newest first and `limit` a run (all of them since
 * 2026-11-21, not only the last 7 days); each success is recorded in the audit trail (`autopilot.ai_disclosed`), a
 * refusal too, with Facebook's reason, and a refused post is tried once more a day later; the first refusal of a run
 * is returned for the activity log.
 */
export async function discloseAiPosts(workspaceId: string, sourceId: string, now: Date, limit = 60, skipTargetIds: readonly string[] = []): Promise<{ done: number; problem: string | null }> {
  // Every autopilot post, not only the last 7 days (2026-11-21, owner: posts on every Page missed the label): never tried,
  // or refused once more than a day ago (Facebook refused 13 posts with a passing permission error); newest first.
  const rows = await prisma.$queryRaw<Array<{ id: string; remotePostId: string; targetId: string; token: string | null; accountToken: string | null }>>`
    WITH tried AS (
      SELECT detail->>'postTargetId' AS id, COUNT(*) AS n, bool_or(detail->>'error' IS NULL) AS ok, MAX("createdAt") AS last
      FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'autopilot.ai_disclosed' GROUP BY 1)
    SELECT pt.id, pt."remotePostId", pt."targetId", t."accessToken" AS token, sa."accessToken" AS "accountToken"
    FROM wordpress_recipe_plans l
    JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published' AND pt."remotePostId" IS NOT NULL AND pt."remoteMissingAt" IS NULL
    JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = ${workspaceId} AND t.enabled = true
    JOIN social_accounts sa ON sa.id = t."socialAccountId" AND sa.provider = 'facebook' AND sa."invalidatedAt" IS NULL
    LEFT JOIN tried ON tried.id = pt.id
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND NOT (pt."targetId" = ANY(${[...skipTargetIds]}::text[]))
      AND (tried.id IS NULL OR (NOT tried.ok AND tried.n < 2 AND tried.last <= ${new Date(now.getTime() - 86_400_000)}))
    ORDER BY COALESCE(pt."publishedAt", l."slotAt") DESC LIMIT ${limit}`;
  if (!rows.length) return { done: 0, problem: null };
  const { configuredFacebookEngine } = await import('@/platforms/facebook/runtime');
  const engine = await configuredFacebookEngine({});
  if (!engine.discloseAiGenerated) return { done: 0, problem: 'not supported' };
  let done = 0; let problem: string | null = null;
  for (const row of rows) {
    const sealed = row.token ?? row.accountToken;
    if (!sealed) continue;
    let error: string | null = null;
    try { await engine.discloseAiGenerated(decryptSecret(sealed), row.remotePostId); }
    catch (caught) { error = String(caught instanceof Error ? caught.message : caught).slice(0, 200); }
    // A post Facebook refuses is recorded with its reason and not tried again; the others carry on (2026-11-19).
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, NULL, 'autopilot.ai_disclosed', ${JSON.stringify({ postTargetId: row.id, remotePostId: row.remotePostId, ...(error ? { error } : {}) })}::jsonb, NOW())`;
    if (error) problem ??= error; else done += 1;
  }
  return { done, problem };
}

/**
 * Where the « AI info » label stands on the autopilot's posts of the last `days` (2026-11-21, owner: some posts miss it):
 * labelled, refused (grouped by Facebook's reason, with the Page) and not tried yet. Read-only.
 */
export async function aiLabelFigures(workspaceId: string, sourceId: string, now: Date, days = 365) {
  const rows = await prisma.$queryRaw<Array<{ targetId: string; name: string | null; publishedAt: Date | null; error: string | null; tried: boolean }>>`
    SELECT pt."targetId", t.name, pt."publishedAt", a.detail->>'error' AS error, (a.id IS NOT NULL) AS tried
    FROM wordpress_recipe_plans l
    JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published' AND pt."remotePostId" IS NOT NULL AND pt."remoteMissingAt" IS NULL
    JOIN targets t ON t.id = pt."targetId"
    LEFT JOIN LATERAL (SELECT id, detail FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'autopilot.ai_disclosed' AND detail->>'postTargetId' = pt.id ORDER BY "createdAt" DESC LIMIT 1) a ON true
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND COALESCE(pt."publishedAt", l."slotAt") > ${new Date(now.getTime() - days * 86_400_000)}`;
  const reasons = new Map<string, { count: number; pages: Set<string>; latest: string }>();
  for (const row of rows) if (row.tried && row.error) {
    const key = row.error.slice(0, 160); const r = reasons.get(key) ?? { count: 0, pages: new Set<string>(), latest: '' };
    r.count += 1; r.pages.add(row.name ?? row.targetId); const at = row.publishedAt?.toISOString() ?? ''; if (at > r.latest) r.latest = at; reasons.set(key, r);
  }
  const deleted = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM wordpress_recipe_plans l
    JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" WHERE l."sourceId" = ${sourceId} AND pt."remoteMissingAt" IS NOT NULL`;
  return {
    deleted: Number(deleted[0]?.count ?? 0),
    posts: rows.length, labelled: rows.filter(row => row.tried && !row.error).length, pending: rows.filter(row => !row.tried).length,
    refused: [...reasons].map(([reason, r]) => ({ reason, count: r.count, pages: [...r.pages], latest: r.latest })).sort((a, b) => b.count - a.count),
  };
}
