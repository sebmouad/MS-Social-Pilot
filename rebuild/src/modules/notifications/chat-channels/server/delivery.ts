import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../../generated/client';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { notificationRecipientEligible } from '@/modules/settings/notifications/server';
import type { NotificationEnqueueInput } from '@/modules/settings/notifications/contracts';
import { CHAT_CHANNELS_FEATURE } from '../manifest';
import type { ChatEvent } from '../contracts';
import { chatCopy, chatPolicy } from './policy';
import { deliverChat, type ChatSecret } from './transport';

type Tx = Prisma.TransactionClient;
type Event = { eventId: string; workspaceId: string; event: ChatEvent; source?: Omit<NotificationEnqueueInput, 'userId'> };

/** Called inside the originating state transition. Only opaque identities enter the outbox. */
export async function enqueueChatEvent(tx: Tx, input: Event): Promise<number> {
  if (!input.eventId || !input.workspaceId) return 0;
  const policy = await chatPolicy();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM chat_channels WHERE "workspaceId" = ${input.workspaceId} AND enabled = true AND ${input.event} = ANY(events) ORDER BY id LIMIT ${policy.maxChannels + 1}`;
  if (rows.length > policy.maxChannels) throw new Error('Chat destination policy exceeded.');
  let inserted = 0;
  for (const row of rows) inserted += await tx.$executeRaw`INSERT INTO rebuild_chat_deliveries (id, "workspaceId", "channelId", "eventId", event, "operatorOnly", source) VALUES (${randomUUID()}, ${input.workspaceId}, ${row.id}, ${input.eventId}, ${input.event}, ${input.event === 'operatorIncident'}, ${input.source ? JSON.stringify(input.source) : null}::jsonb) ON CONFLICT ("workspaceId", "channelId", "eventId", event) DO NOTHING`;
  return inserted;
}

/** Root chooses one workspace; ordinary customer subscriptions never receive global incidents. */
export async function enqueueOperatorIncident(tx: Tx, input: { eventId: string; state: 'open' | 'resolved' | 'test'; workspaceId: string }): Promise<number> {
  if (!input.workspaceId) return 0;
  const eligible = await tx.$queryRaw<Array<{ id: string }>>`SELECT w.id FROM workspaces w WHERE w.id = ${input.workspaceId} AND w."suspendedAt" IS NULL AND EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = w.id AND m.role::text = 'owner' AND u."isInstanceOwner" = true AND u."disabledAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed')`;
  if (!eligible.length) return 0;
  return enqueueChatEvent(tx, { workspaceId: input.workspaceId, eventId: input.eventId, event: 'operatorIncident' });
}

type Candidate = { id: string; channelId: string; workspaceId: string; event: ChatEvent; operatorOnly: boolean; source: Omit<NotificationEnqueueInput, 'userId'> | null };

/** Existing notifications worker owns the outer lease. Per-message committed claims
 * additionally protect manual overlap/crashes and prevent uncertain transport replay. */
export async function runChatDeliveries(now = new Date()) {
  const policy = await chatPolicy();
  const copy = await chatCopy();
  const rows = await prisma.$transaction(async tx => {
    await tx.$executeRaw`UPDATE rebuild_chat_deliveries SET status = 'uncertain', "finishedAt" = ${now} WHERE status = 'sending' AND "claimedAt" < ${new Date(now.getTime() - policy.deliveryLeaseSeconds * 1000)}`;
    return tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_chat_deliveries WHERE status = 'pending' ORDER BY "createdAt", id LIMIT ${policy.deliveryBatchSize}`;
  });
  const result = { accepted: 0, rejected: 0, uncertain: 0, cancelled: 0 };
  for (const pending of rows) {
    // Claim each item immediately before I/O; a large batch never ages later claims.
    const token = randomUUID();
    const claimedAt = new Date(Math.max(now.getTime(), Date.now()));
    const claims = await prisma.$transaction(tx => tx.$queryRaw<Candidate[]>`WITH candidates AS (SELECT id FROM rebuild_chat_deliveries WHERE id = ${pending.id} AND status = 'pending' FOR UPDATE SKIP LOCKED) UPDATE rebuild_chat_deliveries d SET status = 'sending', "claimedAt" = ${claimedAt}, "claimToken" = ${token} FROM candidates c WHERE d.id = c.id RETURNING d.id, d."channelId", d."workspaceId", d.event, d."operatorOnly", d.source`);
    const row = claims[0];
    if (!row) continue;
    let outcome: keyof typeof result = 'cancelled';
    try {
      outcome = await prisma.$transaction(async tx => {
        // Workspace lock serializes purge/suspension; destination lock serializes pause/delete.
        const workspace = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces w WHERE id = ${row.workspaceId} AND "suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed') FOR SHARE OF w`;
        if (!workspace.length) return 'cancelled' as const;
        const channels = await tx.$queryRaw<Array<{ id: string; kind: string; secret: string }>>`SELECT c.id, c.kind, c.secret FROM chat_channels c JOIN rebuild_chat_deliveries d ON d."channelId" = c.id AND d."workspaceId" = c."workspaceId" WHERE c.id = ${row.channelId} AND c."workspaceId" = ${row.workspaceId} AND c.enabled = true AND ${row.event} = ANY(c.events) AND d.id = ${row.id} AND d.status = 'sending' AND d."claimToken" = ${token} FOR SHARE OF c`;
        if (!channels[0]) return 'cancelled' as const;
        const owners = await tx.$queryRaw<Array<{ userId: string; locale: string }>>`SELECT m."userId", u.locale::text AS locale FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${row.workspaceId} AND m.role::text = 'owner' AND u."disabledAt" IS NULL AND (${row.operatorOnly} = false OR u."isInstanceOwner" = true) ORDER BY m.id LIMIT ${policy.ownerLimit + 1} FOR SHARE OF m, u`;
        if (owners.length > policy.ownerLimit) return 'cancelled' as const;
        for (const owner of owners) {
          const [entitlements, permissions] = await Promise.all([loadEntitlements(owner.userId, row.workspaceId, { allowInstallationInspection: false }), loadPermissions(owner.userId, row.workspaceId)]);
          if (!entitlements || entitlements.workspaceId !== row.workspaceId || !permissions?.pageScope.all || !canUseFeature(entitlements, CHAT_CHANNELS_FEATURE) || !canAccessFeature(permissions, CHAT_CHANNELS_FEATURE, 'read')) continue;
          // Reuse notification service policy for current resource selection,
          // provider grants, post visibility and event-specific permissions.
          if (row.source && !await notificationRecipientEligible(tx, { ...row.source, workspaceId: row.workspaceId, userId: owner.userId })) continue;
          const channel = channels[0];
          let status: 'accepted' | 'rejected' | 'uncertain' = 'rejected';
          try { status = await deliverChat(channel.kind, JSON.parse(decryptSecret(channel.secret)) as ChatSecret, copy[owner.locale === 'fr' ? 'fr' : 'en'][`${row.event}Message`], policy); } catch { /* corrupt stored credential */ }
          await tx.$executeRaw`UPDATE chat_channels SET "lastError" = ${status === 'accepted' ? null : status}, "lastSentAt" = CASE WHEN ${status === 'accepted'} THEN ${now} ELSE "lastSentAt" END WHERE id = ${row.channelId} AND "workspaceId" = ${row.workspaceId}`;
          await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${row.workspaceId}, ${owner.userId}, 'notifications.chat.event_finished', ${JSON.stringify({ deliveryId: row.id, event: row.event, outcome: status })}::jsonb, ${now})`;
          return status;
        }
        return 'cancelled' as const;
      }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs });
    } catch { outcome = 'uncertain'; }
    await prisma.$executeRaw`UPDATE rebuild_chat_deliveries SET status = ${outcome}, "finishedAt" = ${now} WHERE id = ${row.id} AND status = 'sending' AND "claimToken" = ${token}`;
    result[outcome]++;
  }
  return result;
}
