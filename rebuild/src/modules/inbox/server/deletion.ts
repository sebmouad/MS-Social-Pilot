import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { platformInbox } from '@/server/platforms/registry';
import { authorizeInbox } from './access';
import { withInboxChannelOperation } from './comment-guard';
import type { InboxReadActor, InboxReadConstraints } from './types';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
type DeletionState = 'started' | 'uncertain' | 'remote_confirmed' | 'completed' | 'rejected';
type Journal = { id: string; workspaceId: string; targetId: string; provider: string; remoteId: string; localItemId: string; state: DeletionState };
function receipt(row: Journal) {
  return { ok: true as const, operationId: row.id, itemId: row.localItemId, state: row.state,
    remoteConfirmed: row.state === 'remote_confirmed' || row.state === 'completed', localConfirmed: row.state === 'completed' };
}
const missing = () => new OperationError('not_found', 'This comment or deletion is unavailable in the current workspace.');

async function findJournal(workspaceId: string, itemId: string) {
  const rows = await prisma.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localItemId", state
    FROM rebuild_inbox_deletions WHERE "workspaceId" = ${workspaceId} AND ("localItemId" = ${itemId} OR ${itemId} = ANY("localAliases")) ORDER BY "createdAt" DESC, id DESC LIMIT 1`;
  return rows[0];
}

/** Traverse stored descendants without crossing workspace/channel boundaries.
 * UNION deduplicates cycles; the configured transaction bounds the query.
 */
async function storedFamily(tx: Prisma.TransactionClient, workspaceId: string, targetId: string, remoteId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; remoteId: string }>>`WITH RECURSIVE family("remoteId") AS (
    SELECT ${remoteId}::text
    UNION
    SELECT c."remoteId" FROM post_comments c
      JOIN post_targets pt ON pt.id = c."postTargetId"
      JOIN posts p ON p.id = pt."postId"
      JOIN targets t ON t.id = pt."targetId"
      JOIN family f ON c."parentRemoteId" = f."remoteId"
      WHERE t.id = ${targetId} AND t."workspaceId" = ${workspaceId} AND p."workspaceId" = ${workspaceId}
  ) SELECT c.id, c."remoteId" FROM post_comments c
    JOIN post_targets pt ON pt.id = c."postTargetId" JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
    WHERE t.id = ${targetId} AND t."workspaceId" = ${workspaceId} AND p."workspaceId" = ${workspaceId} AND c."remoteId" IN (SELECT "remoteId" FROM family)`;
  return { aliases: rows.filter(row => row.remoteId === remoteId).map(row => row.id), remoteIds: [...new Set([remoteId, ...rows.map(row => row.remoteId)])] };
}

async function findRemoteJournal(workspaceId: string, provider: string, targetId: string, remoteId: string) {
  const rows = await prisma.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localItemId", state FROM rebuild_inbox_deletions
    WHERE "workspaceId" = ${workspaceId} AND provider = ${provider} AND "targetId" = ${targetId} AND "remoteId" = ${remoteId}`;
  return rows[0];
}

export async function getInboxDeletion(actor: InboxReadActor, input: { itemId: string }, constraints: InboxReadConstraints = {}) {
  const parsed = idSchema.safeParse(input.itemId);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose a valid comment.');
  const access = await authorizeInbox(actor, constraints);
  let row = await findJournal(actor.workspaceId, parsed.data);
  if (row && !access.channelIds.includes(row.targetId)) throw missing();
  if (!row) {
    const comment = await prisma.postComment.findFirst({ where: { id: parsed.data,
      postTarget: { targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } },
      select: { id: true, remoteId: true, postTarget: { select: { targetId: true, target: { select: { socialAccount: { select: { provider: true } } } } } } } });
    if (!comment) throw missing();
    const provider = comment.postTarget.target.socialAccount?.provider;
    if (provider) row = await findRemoteJournal(actor.workspaceId, provider, comment.postTarget.targetId, comment.remoteId);
  }
  // Bind the receipt to this authorized local alias; the operation ID remains
  // stable for every alias of the same remote object.
  return { operation: row ? { ...receipt(row), itemId: parsed.data } : null };
}

async function finish(row: Journal, actor: InboxReadActor) {
  if (row.state !== 'remote_confirmed') return receipt(row);
  const [timeout, maxWait] = await Promise.all([runtimeConfig('inbox.workflowTransactionTimeoutMs'), runtimeConfig('inbox.workflowTransactionMaxWaitMs')]);
  // All local aliases and recursively stored replies belong to this channel.
  // Completion, cleanup and its domain audit either all commit or all roll back.
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localItemId", state
      FROM rebuild_inbox_deletions WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const current = locked[0];
    if (!current) throw missing();
    if (current.state !== 'remote_confirmed') return receipt(current);
    const family = await storedFamily(tx, actor.workspaceId, current.targetId, current.remoteId);
    await tx.postComment.deleteMany({ where: {
      postTarget: { targetId: current.targetId, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } },
      remoteId: { in: family.remoteIds },
    } });
    await tx.$executeRaw`UPDATE rebuild_inbox_deletions SET state = 'completed', reason = NULL, "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP,
      "localAliases" = ARRAY(SELECT DISTINCT unnest("localAliases" || ${family.aliases}::text[])),
      "suppressedRemoteIds" = ARRAY(SELECT DISTINCT unnest("suppressedRemoteIds" || ${family.remoteIds}::text[]))
      WHERE id = ${current.id} AND "workspaceId" = ${actor.workspaceId}`;
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, 'inbox.comment_deleted', ${JSON.stringify({ workspaceId: actor.workspaceId, targetId: current.targetId, itemId: current.localItemId, operationId: current.id })}::jsonb, NOW())`;
    return receipt({ ...current, state: 'completed' });
  }, { timeout, maxWait });
}

/** One committed intent and at most one outbound attempt per remote identity.
 * Any provider exception is conservatively uncertain: permission/not-found text
 * is never interpreted here as proof of absence or as safe to repeat.
 */
export async function deleteInboxCommentDurably(actor: InboxReadActor, input: { id: string; confirmation: string }, constraints: InboxReadConstraints = {}) {
  if (!idSchema.safeParse(input.id).success || input.confirmation !== `DELETE COMMENT ${input.id}`) throw new OperationError('invalid_request', 'Confirm deletion of this exact comment.');
  await authorizeInbox(actor, constraints, 'write');
  if (await runtimeConfig('inbox.deletionRetention') !== 'until_workspace_erasure') throw new OperationError('unavailable', 'Comment deletion is unavailable.');
  return withWorkspaceOperation(actor.workspaceId, async () => {
    const access = await authorizeInbox(actor, constraints, 'write');
    const previous = await findJournal(actor.workspaceId, input.id);
    if (previous) {
      if (!access.channelIds.includes(previous.targetId)) throw missing();
      return withInboxChannelOperation(actor.workspaceId, previous.targetId, async () => {
        const current = await authorizeInbox(actor, constraints, 'write');
        if (!current.channelIds.includes(previous.targetId)) throw missing();
        return { ...await finish(previous, actor), itemId: input.id };
      });
    }
    const item = await prisma.postComment.findFirst({ where: { id: input.id,
      postTarget: { targetId: { in: access.channelIds }, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } },
      select: { remoteId: true, postTarget: { select: { targetId: true, target: { select: { socialAccount: { select: { provider: true } } } } } } } });
    const provider = item?.postTarget.target.socialAccount?.provider;
    if (!item || !provider) throw missing();
    const targetId = item.postTarget.targetId;
    return withInboxChannelOperation(actor.workspaceId, targetId, async signal => {
      const refreshed = await authorizeInbox(actor, constraints, 'write');
      if (!refreshed.channelIds.includes(targetId)) throw missing();
      const existingRemote = await findRemoteJournal(actor.workspaceId, provider, targetId, item.remoteId);
      if (existingRemote) return { ...await finish(existingRemote, actor), itemId: input.id };
      const stillPresent = await prisma.postComment.findFirst({ where: { id: input.id, remoteId: item.remoteId,
        postTarget: { targetId, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } }, select: { id: true } });
      if (!stillPresent) {
        const concurrent = await findJournal(actor.workspaceId, input.id);
        if (concurrent && concurrent.targetId === targetId) return finish(concurrent, actor);
        throw missing();
      }
      const host = await platformInbox(provider);
      if (!host?.prepareDeleteComment) throw new OperationError('unavailable', 'Comment deletion is unavailable for this channel.');
      // Preparation validates current remote credentials before a durable intent.
      const dispatch = await host.prepareDeleteComment(actor, { targetId, remoteId: item.remoteId });
      const operationId = randomUUID();
      const [timeout, maxWait] = await Promise.all([runtimeConfig('inbox.workflowTransactionTimeoutMs'), runtimeConfig('inbox.workflowTransactionMaxWaitMs')]);
      const inserted = await prisma.$transaction(async tx => {
        const family = await storedFamily(tx, actor.workspaceId, targetId, item.remoteId);
        const rows = await tx.$queryRaw<Journal[]>`INSERT INTO rebuild_inbox_deletions (id, "workspaceId", "targetId", provider, "remoteId", "localItemId", "actorId", state, "localAliases", "suppressedRemoteIds")
          VALUES (${operationId}, ${actor.workspaceId}, ${targetId}, ${provider}, ${item.remoteId}, ${input.id}, ${actor.userId}, 'started', ${family.aliases}::text[], ${family.remoteIds}::text[])
          ON CONFLICT ("workspaceId", provider, "targetId", "remoteId") DO NOTHING
          RETURNING id, "workspaceId", "targetId", provider, "remoteId", "localItemId", state`;
        if (rows.length) await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, 'inbox.comment_deletion_started', ${JSON.stringify({ workspaceId: actor.workspaceId, targetId, itemId: input.id, operationId })}::jsonb, NOW())`;
        return rows;
      }, { timeout, maxWait });
      const claimed = inserted[0];
      if (!claimed) {
        const existing = await findRemoteJournal(actor.workspaceId, provider, targetId, item.remoteId);
        if (!existing) throw missing();
        return { ...await finish(existing, actor), itemId: input.id };
      }
      // Intent is committed before dispatch. No timer clears it for another try.
      try { signal.throwIfAborted(); await dispatch(signal); }
      catch {
        await prisma.$executeRaw`UPDATE rebuild_inbox_deletions SET state = 'uncertain', reason = 'transport_unconfirmed', "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${operationId} AND state = 'started'`;
        return receipt({ ...claimed, state: 'uncertain' });
      }
      await prisma.$executeRaw`UPDATE rebuild_inbox_deletions SET state = 'remote_confirmed', reason = 'local_pending', "remoteConfirmedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${operationId} AND state = 'started'`;
      const confirmed = { ...claimed, state: 'remote_confirmed' as const };
      try { return await finish(confirmed, actor); }
      catch { return receipt(confirmed); }
    });
  });
}

/** Recovery never contacts a provider: only a persisted confirmation can finish. */
export async function finishInboxDeletion(actor: InboxReadActor, input: { operationId: string; confirmation: string }, constraints: InboxReadConstraints = {}) {
  if (!idSchema.safeParse(input.operationId).success || input.confirmation !== `FINISH DELETION ${input.operationId}`) throw new OperationError('invalid_request', 'Confirm this exact deletion recovery.');
  await authorizeInbox(actor, constraints, 'write');
  return withWorkspaceOperation(actor.workspaceId, async () => {
    const access = await authorizeInbox(actor, constraints, 'write');
    const rows = await prisma.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localItemId", state FROM rebuild_inbox_deletions WHERE id = ${input.operationId} AND "workspaceId" = ${actor.workspaceId}`;
    const row = rows[0];
    if (!row || !access.channelIds.includes(row.targetId)) throw missing();
    return withInboxChannelOperation(actor.workspaceId, row.targetId, async () => {
      const current = await authorizeInbox(actor, constraints, 'write');
      if (!current.channelIds.includes(row.targetId)) throw missing();
      return finish(row, actor);
    });
  });
}
