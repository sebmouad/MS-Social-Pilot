import { createHash } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { classifyCommentSentiment, sentimentAvailable } from '@/modules/ai/server/sentiment';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { inboxTargetWhere } from './providers';
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';

const eventId = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Each person's cursor and intents commit together; concurrent workers skip locked cursors. */
export async function runInboxAlertProducers(now = new Date()) {
  const sentiment = await classifyCommentSentiment(now);
  const limit = await runtimeConfig('sync.maxItemsPerJob') as number;
  return prisma.$transaction(async tx => {
    const settings = await tx.$queryRaw<Array<{ id: string; userId: string; workspaceId: string; inboxDigestAt: Date | null }>>`
      SELECT s.id, s."userId", s."workspaceId", s."inboxDigestAt" FROM notification_settings s
      JOIN workspaces w ON w.id = s."workspaceId"
      WHERE s."onNewInbox" = true AND w."suspendedAt" IS NULL
        AND (s."inboxDigestAt" IS NULL OR s."inboxDigestAt" <= ${new Date(now.getTime() - HOUR)})
      ORDER BY s."inboxDigestAt" NULLS FIRST, s.id LIMIT ${limit} FOR UPDATE OF s SKIP LOCKED`;
    let digests = 0;
    for (const setting of settings) {
      if (setting.inboxDigestAt) {
        const targets = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT t.id FROM targets t WHERE t."workspaceId" = ${setting.workspaceId} AND t.enabled = true AND (
            EXISTS (SELECT 1 FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId"
              WHERE pt."targetId" = t.id AND c."firstSeenAt" > ${setting.inboxDigestAt} AND c."firstSeenAt" <= ${now}
                AND c."resolvedAt" IS NULL AND c."sentById" IS NULL AND c."fromId" IS DISTINCT FROM t."providerId")
            OR EXISTS (SELECT 1 FROM conversation_messages m JOIN conversations cv ON cv.id = m."conversationId"
              WHERE cv."targetId" = t.id AND m."firstSeenAt" > ${setting.inboxDigestAt} AND m."firstSeenAt" <= ${now}
                AND m."fromId" IS DISTINCT FROM t."providerId")) ORDER BY t.id LIMIT ${limit + 1}`;
        if (targets.length > limit) throw new OperationError('unavailable', 'The inbox digest channel limit needs review.');
        for (const target of targets) {
          await emitWorkspaceAlert(tx, { workspaceId: setting.workspaceId, recipientId: setting.userId, eventId: eventId('inbox', setting.id, now.toISOString(), target.id), kind: 'inbox_digest', targetId: target.id });
          digests++;
        }
      }
      await tx.$executeRaw`UPDATE notification_settings SET "inboxDigestAt" = ${now} WHERE id = ${setting.id} AND "onNewInbox" = true`;
    }
    // No AI means no spike computation, even when old labels exist.
    if (!sentiment.available || !await sentimentAvailable()) return { digests, spikes: null };
    // Require complete inbound coverage and an observed historical baseline.
    const targets = await tx.$queryRaw<Array<{ id: string; workspaceId: string; provider: string }>>`
      SELECT t.id, t."workspaceId", a.provider FROM targets t JOIN workspaces w ON w.id = t."workspaceId"
      JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId"
      WHERE a."invalidatedAt" IS NULL AND w."aiEnabled" = true AND t.enabled = true AND w."suspendedAt" IS NULL AND w."watchNegativeComments" = true
        AND NOT EXISTS (SELECT 1 FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId" JOIN posts p ON p.id = pt."postId"
          WHERE pt."targetId" = t.id AND (p."workspaceId" IS DISTINCT FROM t."workspaceId" OR
            (c."sentById" IS NULL AND c."fromId" IS DISTINCT FROM t."providerId"
            AND c."createdTime" >= ${new Date(now.getTime() - 15 * DAY)} AND c."createdTime" < ${now}
            AND (c.sentiment IS NULL OR c."sentimentProvenance" IS NULL))))
        AND EXISTS (SELECT 1 FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId"
          WHERE pt."targetId" = t.id AND c."sentById" IS NULL AND c."fromId" IS DISTINCT FROM t."providerId"
            AND c."sentimentProvenance" IS NOT NULL AND c."createdTime" >= ${new Date(now.getTime() - 15 * DAY)} AND c."createdTime" < ${new Date(now.getTime() - DAY)})
        AND (t."negativeAlertAt" IS NULL OR t."negativeAlertAt" < ${new Date(now.getTime() - DAY)})
        AND (SELECT COUNT(*) FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId"
          WHERE pt."targetId" = t.id AND c.sentiment = 'negative' AND c."sentimentProvenance" IS NOT NULL AND c."sentById" IS NULL AND c."fromId" IS DISTINCT FROM t."providerId" AND c."createdTime" >= ${new Date(now.getTime() - DAY)} AND c."createdTime" < ${now}) >= 3
        AND (SELECT COUNT(*) FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId"
          WHERE pt."targetId" = t.id AND c.sentiment = 'negative' AND c."sentimentProvenance" IS NOT NULL AND c."sentById" IS NULL AND c."fromId" IS DISTINCT FROM t."providerId" AND c."createdTime" >= ${new Date(now.getTime() - DAY)} AND c."createdTime" < ${now}) * 7 >=
          (SELECT COUNT(*) FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId"
          WHERE pt."targetId" = t.id AND c.sentiment = 'negative' AND c."sentimentProvenance" IS NOT NULL AND c."sentById" IS NULL AND c."fromId" IS DISTINCT FROM t."providerId" AND c."createdTime" >= ${new Date(now.getTime() - 15 * DAY)} AND c."createdTime" < ${new Date(now.getTime() - DAY)})
      ORDER BY t."negativeAlertAt" NULLS FIRST, t.id LIMIT ${limit} FOR UPDATE OF t SKIP LOCKED`;
    let spikes = 0;
    for (const target of targets) {
      try { await assertWorkspaceJobAccess(target.workspaceId, { provider: target.provider, anyFeatureOf: ['inbox/conversations'] }); }
      catch { continue; }
      if (!await prisma.target.findFirst({ where: { AND: [await inboxTargetWhere(target.workspaceId), { id: target.id }] }, select: { id: true } })) continue;
      await emitWorkspaceAlert(tx, { workspaceId: target.workspaceId, eventId: eventId('negative', target.id, now.toISOString()), kind: 'negative_spike', targetId: target.id });
      await tx.$executeRaw`UPDATE targets SET "negativeAlertAt" = ${now} WHERE id = ${target.id} AND "workspaceId" = ${target.workspaceId}`;
      spikes++;
    }
    return { digests, spikes };
  });
}
