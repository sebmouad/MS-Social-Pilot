import { enqueueChatEvent } from '@/modules/notifications/chat-channels/server/delivery';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import type { ReviewParticipant } from '@/modules/publishing/server/lifecycle';
import { audit } from './access';
import { ids } from './links';
import { sharingLimits } from './limits';
import { REVIEW_NOTE_MAX, getReviewPort } from './review-port';
import { ownerCopy, ownerText, resolveOwnerCopy } from '../ui/owner-copy';

type DeadlineLink = { id: string; workspaceId: string; title: string; targetIds: unknown; publishAnywayHours: number; createdById: string };

const autoText = async (workspaceId: string, key: 'Automatic approval' | 'Approved automatically: the client did not answer in time.') => {
  const rows = await prisma.$queryRaw<Array<{ defaultLocale: string }>>`SELECT "defaultLocale"::text AS "defaultLocale" FROM workspaces WHERE id = ${workspaceId}`;
  const locale = rows[0]?.defaultLocale === 'fr' ? 'fr' : 'en';
  try {
    const saved = await runtimeConfig('sharing.ownerCopy');
    const catalog = { ...ownerCopy, ...((saved ?? {}) as Record<string, unknown>) };
    return ownerText(resolveOwnerCopy(locale, catalog as Parameters<typeof resolveOwnerCopy>[1]))(key);
  } catch { return ownerText(resolveOwnerCopy(locale))(key); }
};

/**
 * "Publish anyway": a deciding link with a deadline approves the posts it still holds when their time
 * comes within its hours. Each approval goes through the Publishing review lifecycle as the link creator,
 * so their CURRENT approval permission, scope and workspace state decide; the stored client answer and the
 * status change commit in the same transaction. A link that was revoked, expired or rotated, a creator who
 * lost their rights, and a post that left review are skipped, never forced.
 */
export async function runShareLinkDeadlines(now = new Date()): Promise<string> {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid deadline time.');
  const limits = await sharingLimits();
  const links = await prisma.$queryRaw<DeadlineLink[]>`SELECT id, "workspaceId", title, "targetIds", "publishAnywayHours", "createdById" FROM share_links WHERE decides = true AND "publishAnywayHours" IS NOT NULL AND "revokedAt" IS NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > ${now} ORDER BY id LIMIT ${limits.deadlineBatchLinks!}`;
  let approved = 0, skipped = 0, failed = 0;
  for (const link of links) {
    const targetIds = ids(link.targetIds);
    if (!targetIds.length) { skipped += 1; continue; }
    const horizon = new Date(now.getTime() + link.publishAnywayHours * 3_600_000);
    let posts: Array<{ id: string }>;
    try {
      posts = await prisma.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p WHERE p."workspaceId" = ${link.workspaceId} AND p.status::text = 'pending_approval' AND p."scheduledAt" IS NOT NULL AND p."scheduledAt" <= ${horizon} AND EXISTS (SELECT 1 FROM post_targets pt WHERE pt."postId" = p.id AND pt."targetId" = ANY(${targetIds}::text[])) AND NOT EXISTS (SELECT 1 FROM post_targets pt WHERE pt."postId" = p.id AND NOT (pt."targetId" = ANY(${targetIds}::text[])))`;
    } catch { failed += 1; continue; }
    for (const post of posts) {
      const answerId = randomUUID();
      const participant: ReviewParticipant = {
        before: async tx => {
          const live = await tx.$queryRaw<Array<{ id: string }>>`SELECT l.id FROM share_links l JOIN memberships m ON m."userId" = l."createdById" AND m."workspaceId" = l."workspaceId" JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = l."workspaceId" WHERE l.id = ${link.id} AND l."workspaceId" = ${link.workspaceId} AND l.decides = true AND l."publishAnywayHours" = ${link.publishAnywayHours} AND l."revokedAt" IS NULL AND l."expiresAt" IS NOT NULL AND l."expiresAt" > NOW() AND w."suspendedAt" IS NULL AND u."disabledAt" IS NULL FOR SHARE OF l, m, u, w`;
          if (!live[0]) throw new OperationError('not_found', 'This link is not available.');
          const inside = await tx.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p WHERE p.id = ${post.id} AND p."workspaceId" = ${link.workspaceId} AND p.status::text = 'pending_approval' AND NOT EXISTS (SELECT 1 FROM post_targets pt WHERE pt."postId" = p.id AND NOT (pt."targetId" = ANY(${targetIds}::text[]))) FOR NO KEY UPDATE OF p`;
          if (!inside[0]) throw new OperationError('not_found', 'This post is not available.');
        },
        after: async tx => {
          const authorName = (await autoText(link.workspaceId, 'Automatic approval')).slice(0, 200);
          const stored = await tx.$executeRaw`INSERT INTO review_decisions (id, "shareLinkId", "postId", decision, comment, "authorName", "createdAt") VALUES (${answerId}, ${link.id}, ${post.id}, 'approved', NULL, ${authorName}, NOW())`;
          if (stored !== 1) throw new OperationError('unavailable', 'The answer could not be stored.');
          await enqueueChatEvent(tx, { workspaceId: link.workspaceId, eventId: answerId, event: 'reviewDecision', source: { workspaceId: link.workspaceId, eventId: answerId, kind: 'approval_decision', postId: post.id } });
          await audit(tx, { userId: link.createdById, workspaceId: link.workspaceId }, 'sharing.client_answer_recorded', { linkId: link.id, postId: post.id, decision: 'approved', applied: true, via: 'deadline', publishAnywayHours: link.publishAnywayHours });
        },
      };
      try {
        const note = (await autoText(link.workspaceId, 'Approved automatically: the client did not answer in time.')).slice(0, REVIEW_NOTE_MAX);
        await getReviewPort().review({ userId: link.createdById, workspaceId: link.workspaceId }, post.id, 'approve', note, participant);
        approved += 1;
      } catch (error) {
        if (error instanceof OperationError && ['conflict', 'not_found', 'forbidden', 'unauthorized'].includes(error.code)) skipped += 1;
        else failed += 1;
      }
    }
  }
  return `links=${links.length} approved=${approved} skipped=${skipped} failed=${failed}`;
}
