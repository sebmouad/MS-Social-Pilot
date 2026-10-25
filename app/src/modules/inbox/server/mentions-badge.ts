import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { authorizeInbox } from './access';
import { NOT_OWN_COMMENT, quickConditions } from './read';

/**
 * Open conversations and visible top-level comments mentioning the page, for the
 * Engage hub badge. It uses the same channel scope and the same mention rule as
 * the Inbox Mentions quick filter, so the badge never counts items the list
 * would hide. The count is capped; any refusal or failure returns 0: a badge
 * must never block a page.
 */
export async function openMentionCount(actor: { userId: string; workspaceId: string }, cap = 100): Promise<number> {
  try {
    const [access, prefix] = await Promise.all([authorizeInbox(actor), runtimeConfig('inbox.mentionPrefix')]);
    if (!access.channelIds.length || typeof prefix !== 'string' || !prefix) return 0;
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM (
        SELECT c.id FROM conversations c JOIN targets t ON t.id = c."targetId"
        WHERE t."workspaceId" = ${actor.workspaceId} AND t.id IN (${Prisma.join(access.channelIds)}) AND c."resolvedAt" IS NULL ${quickConditions(['mentions'], prefix, 'message')}
        UNION ALL
        SELECT pc.id FROM post_comments pc
          JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
        WHERE pc."parentRemoteId" IS NULL ${NOT_OWN_COMMENT} AND t."workspaceId" = ${actor.workspaceId} AND p."workspaceId" = ${actor.workspaceId}
          AND t.id IN (${Prisma.join(access.channelIds)}) AND pc."resolvedAt" IS NULL AND pc."isHidden" = false ${quickConditions(['mentions'], prefix, 'comment')}
        LIMIT ${cap + 1}
      ) AS mentions`);
    return Math.min(Number(rows[0]?.count ?? 0), cap + 1);
  } catch {
    return 0;
  }
}
