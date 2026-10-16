import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { connectionState } from '@/lib/connection-status';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { decryptSecret } from '@/server/secret-crypto';
import { hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { platformFor } from '@/server/platforms/registry';
import { authorizePublishing } from './access';
import { withPublishingOperation, withPublishingTransaction } from './guard';
import type { PublishingActor } from './types';

type State = 'started' | 'uncertain' | 'remote_confirmed' | 'completed' | 'rejected';
type Journal = { id: string; workspaceId: string; targetId: string; provider: string; remoteId: string; localPostIds: string[]; localPostTargetIds: string[]; state: State };
export type PostDeletionReceipt = {
  ok: true; postId: string; localConfirmed: boolean; remoteDeletionRequested: boolean;
  state: 'none' | 'needs_review' | 'local_pending' | 'completed';
  operations: Array<{ operationId: string; targetId: string; targetName: string | null; state: State; remoteConfirmed: boolean; localConfirmed: boolean }>;
};
const managers = new Set(['owner', 'admin', 'editor']);
const writers = new Set([...managers, 'contributor']);
const missing = () => new OperationError('not_found', 'This post or deletion is unavailable in the current workspace.');
const confirmed = (row: Journal) => row.state === 'remote_confirmed' || row.state === 'completed';

async function validId(id: unknown) {
  const max = await runtimeConfig('publishing.identifierMaxCharacters');
  if (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > max || /[\u0000-\u001f\u007f]/.test(id)) throw new OperationError('invalid_request', 'Choose a valid publishing record.');
}
async function audit(tx: Prisma.TransactionClient, actorId: string, workspaceId: string, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${action}, ${JSON.stringify({ workspaceId, ...detail })}::jsonb, NOW())`;
}
async function history(actor: PublishingActor, postId: string) {
  const max = await runtimeConfig('publishing.deletionMaxAliases');
  const rows = await prisma.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localPostIds", "localPostTargetIds", state
    FROM rebuild_post_deletions WHERE "workspaceId" = ${actor.workspaceId} AND ${postId} = ANY("localPostIds") ORDER BY "createdAt" DESC, id DESC LIMIT ${max + 1}`;
  if (rows.length > max) throw new OperationError('unavailable', 'This deletion history needs administrator review.');
  if (actor.allowedTargetIds !== undefined && rows.some(row => !actor.allowedTargetIds!.includes(row.targetId))) throw missing();
  return rows;
}
async function localPost(actor: PublishingActor, postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: {
    id: true, authorId: true, targets: { select: { id: true, targetId: true, status: true, remotePostId: true,
      target: { select: { id: true, workspaceId: true, name: true, type: true, enabled: true, accessToken: true,
        socialAccount: { select: { provider: true, invalidatedAt: true, tokenExpiresAt: true, scopes: true } } } } } },
  } });
  if (post && actor.allowedTargetIds !== undefined && !post.targets.length && post.authorId !== actor.userId) throw missing();
  if (post?.targets.some(row => row.target.workspaceId !== actor.workspaceId || (actor.allowedTargetIds !== undefined && !actor.allowedTargetIds.includes(row.targetId)))) throw missing();
  return post;
}
async function result(actor: PublishingActor, postId: string): Promise<PostDeletionReceipt> {
  const [rows, post] = await Promise.all([history(actor, postId), localPost(actor, postId)]);
  if (!post && !rows.length) throw missing();
  const ids = [...new Set(rows.map(row => row.targetId))];
  const targets = ids.length ? await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  const active = rows.filter(row => row.state !== 'rejected');
  const allRemoteConfirmed = (post?.targets.filter(row => row.remotePostId) ?? []).every(row => active.some(operation => operation.targetId === row.targetId && operation.remoteId === row.remotePostId && confirmed(operation)));
  const localConfirmed = !post && active.length > 0 && active.every(row => row.state === 'completed');
  return { ok: true, postId, localConfirmed, remoteDeletionRequested: rows.length > 0,
    state: localConfirmed ? 'completed' : active.some(row => row.state === 'started' || row.state === 'uncertain') ? 'needs_review' : active.some(confirmed) && allRemoteConfirmed ? 'local_pending' : active.length ? 'needs_review' : 'none',
    operations: rows.map(row => ({ operationId: row.id, targetId: row.targetId, targetName: targets.find(target => target.id === row.targetId)?.name ?? null, state: row.state, remoteConfirmed: confirmed(row), localConfirmed: row.state === 'completed' })),
  };
}

/** Read-only status; current feature/member/key scope applies even after local removal. */
export async function getPostDeletion(actor: PublishingActor, input: { postId: string }): Promise<PostDeletionReceipt> {
  await validId(input.postId);
  const access = await authorizePublishing(actor, 'publishing/posts', 'read');
  return result(access.actor, input.postId);
}
async function remoteJournal(workspaceId: string, provider: string, targetId: string, remoteId: string) {
  const rows = await prisma.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localPostIds", "localPostTargetIds", state FROM rebuild_post_deletions
    WHERE "workspaceId" = ${workspaceId} AND provider = ${provider} AND "targetId" = ${targetId} AND "remoteId" = ${remoteId} AND state <> 'rejected'`;
  return rows[0];
}
async function checkWriter(actor: PublishingActor, role: string, postId: string, remote: boolean) {
  if (!writers.has(role) || (remote && !managers.has(role))) throw new OperationError('forbidden', 'You do not have permission to perform this deletion.');
  const post = await localPost(actor, postId);
  if (!post) {
    if (!managers.has(role) || !(await history(actor, postId)).length) throw missing();
    return null;
  }
  if (role === 'contributor' && post.authorId !== actor.userId) throw missing();
  if (post.targets.some(row => row.status === 'processing')) throw new OperationError('conflict', 'A publishing result needs review before this post can be removed.');
  return post;
}

/** Trusted helper: callers own authority and workspace/destination exclusion. No remote dispatch. */
export async function recordPostDeletionOutcomeInTransaction(tx: Prisma.TransactionClient, actorId: string, input: { operationId: string; workspaceId: string; outcome: 'deleted' | 'not_deleted' }): Promise<{ ok: true; operationId: string; state: 'remote_confirmed' | 'rejected' }> {
  if (!['deleted', 'not_deleted'].includes(input.outcome)) throw new OperationError('invalid_request', 'Choose a valid deletion outcome.');
  const rows = await tx.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localPostIds", "localPostTargetIds", state FROM rebuild_post_deletions WHERE id = ${input.operationId} AND "workspaceId" = ${input.workspaceId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw missing();
  if (!['started', 'uncertain'].includes(row.state)) throw new OperationError('conflict', 'This deletion already has a recorded outcome.');
  const state = input.outcome === 'deleted' ? 'remote_confirmed' : 'rejected';
  await tx.$executeRaw`UPDATE rebuild_post_deletions SET state = ${state}, reason = ${input.outcome === 'deleted' ? 'local_pending' : 'external_not_deleted'}, "remoteConfirmedAt" = ${input.outcome === 'deleted' ? new Date() : null}, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${row.id} AND "workspaceId" = ${input.workspaceId}`;
  await audit(tx, actorId, input.workspaceId, 'publishing.post_deletion_outcome_recorded', { operationId: row.id, targetId: row.targetId, outcome: input.outcome, verification: 'external_human_attestation' });
  return { ok: true, operationId: row.id, state };
}

/** Atomically clear all references to confirmed remote identities; delete only the requested local post. */
async function finish(actor: PublishingActor, postId: string, signal: AbortSignal): Promise<PostDeletionReceipt> {
  const current = await result(actor, postId);
  if (current.localConfirmed || current.state !== 'local_pending') return current;
  await withPublishingTransaction(signal, async tx => {
    const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, targets: { select: { targetId: true, remotePostId: true } } } });
    const rows = await tx.$queryRaw<Journal[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localPostIds", "localPostTargetIds", state FROM rebuild_post_deletions WHERE "workspaceId" = ${actor.workspaceId} AND ${postId} = ANY("localPostIds") AND state <> 'rejected' ORDER BY id FOR UPDATE`;
    if (rows.some(row => !confirmed(row)) || post?.targets.some(target => target.remotePostId && !rows.some(row => row.targetId === target.targetId && row.remoteId === target.remotePostId && confirmed(row)))) throw new OperationError('conflict', 'Confirm every platform deletion before removing this local post.');
    const max = await runtimeConfig('publishing.deletionMaxAliases');
    const aliasPosts = new Set<string>();
    for (const row of rows) {
      const aliases = await tx.postTarget.findMany({ where: { targetId: row.targetId, remotePostId: row.remoteId, post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId, socialAccount: { provider: row.provider } } }, select: { id: true, postId: true }, take: max + 1 });
      if (aliases.length > max || new Set([...row.localPostIds, ...aliases.map(alias => alias.postId)]).size > max || new Set([...row.localPostTargetIds, ...aliases.map(alias => alias.id)]).size > max) throw new OperationError('unavailable', 'This deletion has too many stored references. Ask an administrator to review it.');
      for (const alias of aliases) aliasPosts.add(alias.postId);
      await tx.postTarget.updateMany({ where: { id: { in: aliases.map(alias => alias.id) }, targetId: row.targetId, remotePostId: row.remoteId, post: { workspaceId: actor.workspaceId } }, data: { status: 'cancelled', remotePostId: null, remoteUrl: null } });
      await tx.$executeRaw`UPDATE rebuild_post_deletions SET state = 'completed', reason = NULL, "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP,
        "localPostIds" = ARRAY(SELECT DISTINCT unnest("localPostIds" || ${aliases.map(alias => alias.postId)}::text[])), "localPostTargetIds" = ARRAY(SELECT DISTINCT unnest("localPostTargetIds" || ${aliases.map(alias => alias.id)}::text[])) WHERE id = ${row.id}`;
    }
    for (const id of aliasPosts) {
      if (id === postId) continue;
      const targets = await tx.postTarget.findMany({ where: { postId: id, post: { workspaceId: actor.workspaceId } }, select: { status: true } });
      const status = targets.every(target => target.status === 'cancelled') ? 'cancelled' : targets.some(target => target.status === 'published') ? 'partially_failed' : undefined;
      if (status) await tx.post.updateMany({ where: { id, workspaceId: actor.workspaceId }, data: { status, updatedAt: new Date() } });
    }
    await tx.postComment.deleteMany({ where: { postTarget: { postId, post: { workspaceId: actor.workspaceId } } } });
    await tx.postTarget.deleteMany({ where: { postId, post: { workspaceId: actor.workspaceId } } });
    await tx.post.deleteMany({ where: { id: postId, workspaceId: actor.workspaceId } });
    await audit(tx, actor.userId, actor.workspaceId, 'publishing.post_deleted', { postId, remoteDeletionRequested: true, operationIds: rows.map(row => row.id), retainedAliasPostCount: [...aliasPosts].filter(id => id !== postId).length });
  });
  return result(actor, postId);
}

export async function finishPostDeletion(actor: PublishingActor, input: { postId: string; confirmation: string }): Promise<PostDeletionReceipt> {
  if (input.confirmation !== `FINISH POST DELETION ${input.postId}`) throw new OperationError('invalid_request', 'Confirm recovery for this exact post.');
  return withPublishingOperation(actor, { postId: input.postId, includeInbox: true, allowDeletionRecovery: true, allowMissingPost: true }, async context => {
    await checkWriter(context.actor, context.role, input.postId, true);
    return finish(context.actor, input.postId, context.signal);
  });
}
export async function recordPostDeletionOutcome(actor: PublishingActor, input: { postId: string; operationId: string; outcome: 'deleted' | 'not_deleted'; confirmation: string; verifiedOnPlatform: true }): Promise<PostDeletionReceipt> {
  await validId(input.operationId);
  if (input.verifiedOnPlatform !== true || !['deleted', 'not_deleted'].includes(input.outcome) || input.confirmation !== `RECORD POST DELETION ${input.operationId} ${input.outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}`) throw new OperationError('invalid_request', 'Verify the platform result and confirm this exact deletion outcome.');
  return withPublishingOperation(actor, { postId: input.postId, includeInbox: true, allowDeletionRecovery: true, allowMissingPost: true }, async context => {
    await checkWriter(context.actor, context.role, input.postId, true);
    const rows = await history(context.actor, input.postId);
    if (!rows.some(row => row.id === input.operationId)) throw missing();
    await withPublishingTransaction(context.signal, tx => recordPostDeletionOutcomeInTransaction(tx, context.actor.userId, { ...input, workspaceId: actor.workspaceId }));
    return result(context.actor, input.postId);
  });
}

/** One persisted intent per remote identity. An unconfirmed result never causes another automatic request. */
export async function deletePostDurably(actor: PublishingActor, postId: string, deleteRemote: boolean): Promise<PostDeletionReceipt> {
  if (typeof deleteRemote !== 'boolean') throw new OperationError('invalid_request', 'Choose whether to remove remote publications.');
  return withPublishingOperation(actor, { postId, includeInbox: true, allowDeletionRecovery: true, allowMissingPost: true }, async context => {
    const { actor, role, signal } = context;
    const post = await checkWriter(actor, role, postId, deleteRemote);
    if (!post) return result(actor, postId);
    const previous = await history(actor, postId);
    if (previous.some(row => row.state === 'started' || row.state === 'uncertain')) return result(actor, postId);
    if (!deleteRemote && previous.some(row => row.state === 'remote_confirmed')) return result(actor, postId);
    if (!deleteRemote || !post.targets.some(row => row.remotePostId)) {
      await withPublishingTransaction(signal, async tx => {
        await tx.postComment.deleteMany({ where: { postTarget: { postId, post: { workspaceId: actor.workspaceId } } } });
        await tx.postTarget.deleteMany({ where: { postId, post: { workspaceId: actor.workspaceId } } });
        await tx.post.deleteMany({ where: { id: postId, workspaceId: actor.workspaceId } });
        await audit(tx, actor.userId, actor.workspaceId, 'publishing.post_deleted', { postId, remoteDeletionRequested: deleteRemote, remoteDeletedCount: 0 });
      });
      return { ok: true, postId, localConfirmed: true, remoteDeletionRequested: deleteRemote, state: 'completed', operations: [] };
    }
    const entitlements = await loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false });
    const max = await runtimeConfig('publishing.deletionMaxAliases');
    const prepared: Array<{ row: (typeof post.targets)[number]; provider: string; dispatch: () => Promise<void>; aliases: Array<{ id: string; postId: string }> }> = [];
    // Complete preflight of every fresh destination before dispatching any request.
    for (const row of post.targets.filter(row => row.remotePostId)) {
      const source = row.target.socialAccount;
      const provider = source?.provider;
      if (!provider) throw new OperationError('unavailable', 'A destination connection needs review before remote deletion.');
      const existing = await remoteJournal(actor.workspaceId, provider, row.targetId, row.remotePostId!);
      if (existing) {
        // Attach a newly encountered local alias without creating another remote request.
        await withPublishingTransaction(signal, async tx => {
          if (new Set([...existing.localPostIds, postId]).size > max || new Set([...existing.localPostTargetIds, row.id]).size > max) throw new OperationError('unavailable', 'This deletion has too many stored references.');
          await tx.$executeRaw`UPDATE rebuild_post_deletions SET "localPostIds" = ARRAY(SELECT DISTINCT unnest("localPostIds" || ARRAY[${postId}])), "localPostTargetIds" = ARRAY(SELECT DISTINCT unnest("localPostTargetIds" || ARRAY[${row.id}])), "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${existing.id}`;
        });
        if (!confirmed(existing)) return result(actor, postId);
        continue;
      }
      const adapter = await platformFor(provider, 'remoteDelete');
      if (!source || !entitlements || !hasPlatformCapability(entitlements, provider) || !adapter?.deleteRemote || !row.target.enabled || connectionState(source) !== 'connected' || !row.target.accessToken) throw new OperationError('reconnect_required', 'Reconnect each selected destination before remote deletion. The local post is preserved.');
      const credential = { accessToken: decryptSecret(row.target.accessToken), grantedScopes: source.scopes.split(',').map(scope => scope.trim()).filter(Boolean) };
      if (adapter.canUseCredential?.(credential, 'remoteDelete') === false) throw new OperationError('reconnect_required', 'Reconnect this destination before remote deletion.');
      const aliases = await prisma.postTarget.findMany({ where: { targetId: row.targetId, remotePostId: row.remotePostId, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } }, select: { id: true, postId: true }, take: max + 1 });
      if (aliases.length > max) throw new OperationError('unavailable', 'This publication has too many stored references. Ask an administrator to review it.');
      prepared.push({ row, provider, aliases, dispatch: () => adapter.deleteRemote!({ credential, remoteId: row.remotePostId!, signal }) });
    }
    for (const item of prepared) {
      const operationId = randomUUID();
      await withPublishingTransaction(signal, async tx => {
        await tx.$executeRaw`INSERT INTO rebuild_post_deletions (id, "workspaceId", "targetId", provider, "remoteId", "actorId", "localPostIds", "localPostTargetIds", state)
          VALUES (${operationId}, ${actor.workspaceId}, ${item.row.targetId}, ${item.provider}, ${item.row.remotePostId}, ${actor.userId}, ${[...new Set([postId, ...item.aliases.map(alias => alias.postId)])]}::text[], ${[...new Set([item.row.id, ...item.aliases.map(alias => alias.id)])]}::text[], 'started')`;
        await audit(tx, actor.userId, actor.workspaceId, 'publishing.post_deletion_started', { postId, postTargetId: item.row.id, operationId });
      });
      try { signal.throwIfAborted(); await item.dispatch(); }
      catch {
        try { await withPublishingTransaction(signal, async tx => {
          await tx.$executeRaw`UPDATE rebuild_post_deletions SET state = 'uncertain', reason = 'transport_unconfirmed', "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${operationId} AND state = 'started'`;
          await audit(tx, actor.userId, actor.workspaceId, 'publishing.post_deletion_uncertain', { postId, operationId });
        }); } catch { /* The committed started intent remains non-repeatable. */ }
        return result(actor, postId);
      }
      try { await withPublishingTransaction(signal, async tx => {
        await tx.$executeRaw`UPDATE rebuild_post_deletions SET state = 'remote_confirmed', reason = 'local_pending', "remoteConfirmedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${operationId} AND state = 'started'`;
        await audit(tx, actor.userId, actor.workspaceId, 'publishing.remote_post_deleted', { postId, postTargetId: item.row.id, operationId });
      }); } catch { return result(actor, postId); }
    }
    try { return await finish(actor, postId, signal); }
    catch { return result(actor, postId); }
  });
}
