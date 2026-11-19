import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';

/**
 * « AI info » on the autopilot's recipe posts (2026-11-19, owner: all recipe photos are AI-made, tag them). The AI
 * marker written into the photos (IPTC DigitalSourceType) is not what Facebook labels from when a photo is uploaded
 * through the API; Graph API v27.0 added `is_ai_generated`, accepted only when editing a post that already exists.
 * So each recipe post published in the last 7 days is marked once, after it is published; each success is recorded
 * in the audit trail (`autopilot.ai_disclosed`). The first failure stops the batch and is returned, so a missing
 * permission costs one request per run, not one per post.
 */
export async function discloseAiPosts(workspaceId: string, sourceId: string, now: Date, limit = 20): Promise<{ done: number; problem: string | null }> {
  const rows = await prisma.$queryRaw<Array<{ id: string; remotePostId: string; targetId: string; token: string | null; accountToken: string | null }>>`
    SELECT pt.id, pt."remotePostId", pt."targetId", t."accessToken" AS token, sa."accessToken" AS "accountToken"
    FROM wordpress_recipe_plans l
    JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published' AND pt."remotePostId" IS NOT NULL
    JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = ${workspaceId} AND t.enabled = true
    JOIN social_accounts sa ON sa.id = t."socialAccountId" AND sa.provider = 'facebook' AND sa."invalidatedAt" IS NULL
    WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND COALESCE(pt."publishedAt", l."slotAt") > ${new Date(now.getTime() - 7 * 86_400_000)}
      AND NOT EXISTS (SELECT 1 FROM activity_logs a WHERE a."workspaceId" = ${workspaceId} AND a.action = 'autopilot.ai_disclosed' AND a.detail->>'postTargetId' = pt.id)
    ORDER BY COALESCE(pt."publishedAt", l."slotAt") DESC LIMIT ${limit}`;
  if (!rows.length) return { done: 0, problem: null };
  const { configuredFacebookEngine } = await import('@/platforms/facebook/runtime');
  const engine = await configuredFacebookEngine({});
  if (!engine.discloseAiGenerated) return { done: 0, problem: 'not supported' };
  let done = 0;
  for (const row of rows) {
    const sealed = row.token ?? row.accountToken;
    if (!sealed) continue;
    try { await engine.discloseAiGenerated(decryptSecret(sealed), row.remotePostId); }
    catch (error) { return { done, problem: String(error instanceof Error ? error.message : error).slice(0, 200) }; }
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, NULL, 'autopilot.ai_disclosed', ${JSON.stringify({ postTargetId: row.id, remotePostId: row.remotePostId })}::jsonb, NOW())`;
    done += 1;
  }
  return { done, problem: null };
}
