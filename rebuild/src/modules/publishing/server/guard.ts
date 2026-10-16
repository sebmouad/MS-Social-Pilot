import { assertInboxDeletionsSettled, lockInboxChannel } from '@/modules/inbox/server/comment-guard';
import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizePublishing } from './access';
import { assertNoPendingPostDeletionForAliases, assertPostDeletionTargetsSettled, loadPostDeletionTargetIds } from './post-deletion-guard';
import type { PublishingActor, PublishingFeature } from './types';

type PublishingOperationContext = {
  actor: PublishingActor;
  role: string;
  signal: AbortSignal;
  lockTargets(ids: readonly string[]): Promise<void>;
};
type PublishingOperationOptions = { postId?: string; targetIds?: readonly string[]; feature?: PublishingFeature; includeInbox?: boolean; access?: 'read' | 'write'; allowDeletionRecovery?: boolean; allowMissingPost?: boolean };

function validateIds(ids: readonly string[], maxTargets: number, maxIdCharacters: number): string[] {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > maxIdCharacters || /[\u0000-\u001f\u007f]/.test(id))) {
    throw new OperationError('invalid_request', 'Choose valid destinations for this post.');
  }
  const unique = [...new Set(ids)].sort();
  if (unique.length > maxTargets) throw new OperationError('invalid_request', 'Choose fewer destinations for this publishing action.');
  return unique;
}

function requirePositiveInteger(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new OperationError('unavailable', 'Publishing is temporarily unavailable. Contact your workspace administrator.');
  }
}

/** Fail-fast transaction advisory locks shared with publishing lifecycle operations. */
export async function lockPublishingTargets(tx: Prisma.TransactionClient, workspaceId: string, ids: readonly string[]): Promise<void> {
  const [configuredMax, maxIdCharacters] = await Promise.all([
    runtimeConfig('publishing.maxTargetsPerOperation'), runtimeConfig('publishing.identifierMaxCharacters'),
  ]);
  requirePositiveInteger(configuredMax);
  requirePositiveInteger(maxIdCharacters);
  const targetIds = validateIds(ids, configuredMax, maxIdCharacters);
  for (const targetId of targetIds) {
    const key = JSON.stringify(['publishing-targets', workspaceId, targetId]);
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
    if (rows[0]?.acquired !== true) throw new OperationError('conflict', 'Another publishing action is running for this destination. Check its outcome before continuing.');
  }
}

/** Refuse lifecycle cleanup while a publishing result may still need reconciliation. */
export async function assertPublishingTargetsSettled(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  targetIds?: readonly string[],
): Promise<void> {
  if (targetIds?.length === 0) return;
  const pending = await tx.postTarget.findFirst({
    where: {
      status: 'processing',
      post: { workspaceId },
      ...(targetIds === undefined ? {} : { targetId: { in: [...new Set(targetIds)] } }),
    },
    select: { id: true },
  });
  if (pending) throw new OperationError('conflict', 'A publishing result needs review before this data or connection can be removed. Check the post status first.');
  await assertPostDeletionTargetsSettled(tx, workspaceId, targetIds);
}

/** Holds the workspace operation boundary and fail-fast post/destination locks for one publishing action. */
export async function withPublishingOperation<T>(
  actor: PublishingActor,
  options: PublishingOperationOptions,
  work: (context: PublishingOperationContext) => Promise<T>,
): Promise<T> {
  const [operationTimeout, operationMaxWait, transactionTimeout, transactionMaxWait, workspaceTimeout, maxTargets, maxIdCharacters] = await Promise.all([
    runtimeConfig('publishing.operationTimeoutMs'), runtimeConfig('publishing.operationMaxWaitMs'),
    runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs'),
    runtimeConfig('data.workspaceOperationTimeoutMs'), runtimeConfig('publishing.maxTargetsPerOperation'), runtimeConfig('publishing.identifierMaxCharacters'),
  ]);
  requirePositiveInteger(operationTimeout);
  requirePositiveInteger(operationMaxWait);
  requirePositiveInteger(transactionTimeout);
  requirePositiveInteger(transactionMaxWait);
  requirePositiveInteger(workspaceTimeout);
  requirePositiveInteger(maxTargets);
  requirePositiveInteger(maxIdCharacters);

  const targetIds = validateIds(options.targetIds ?? [], maxTargets, maxIdCharacters);
  if (options.postId !== undefined && (!options.postId || options.postId.length > maxIdCharacters || /[\u0000-\u001f\u007f]/.test(options.postId))) {
    throw new OperationError('invalid_request', 'Choose a valid post.');
  }
  const guardTimeout = operationTimeout + 2 * (transactionTimeout + transactionMaxWait) + operationMaxWait;
  if (guardTimeout >= workspaceTimeout) throw new OperationError('unavailable', 'Publishing is temporarily unavailable. Contact your workspace administrator.');

  return withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), operationTimeout);
    try {
      const assertActive = () => controller.signal.throwIfAborted();
      assertActive();
      const initial = await authorizePublishing(actor, options.feature, options.access);
      assertActive();
      let postTargetIds: string[] = [];
      if (options.postId) {
        const postKey = JSON.stringify(['publishing-post', actor.workspaceId, options.postId]);
        const postLock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${postKey}, 0)) AS acquired`;
        assertActive();
        if (postLock[0]?.acquired !== true) throw new OperationError('conflict', 'Another action is running for this post. Check its outcome before continuing.');
        const post = await prisma.post.findFirst({
          where: { id: options.postId, workspaceId: actor.workspaceId },
          select: { id: true, targets: { select: { id: true, targetId: true } } },
        });
        assertActive();
        if (!post) {
          if (!options.allowDeletionRecovery || !options.allowMissingPost) throw new OperationError('not_found', 'This post is unavailable.');
          postTargetIds = await loadPostDeletionTargetIds(tx, actor.workspaceId, options.postId);
          assertActive();
          if (!postTargetIds.length) throw new OperationError('not_found', 'This post is unavailable.');
        } else {
          postTargetIds = post.targets.map(target => target.targetId);
          if (!options.allowDeletionRecovery) {
            await assertNoPendingPostDeletionForAliases(tx, actor.workspaceId, [post.id], post.targets.map(target => target.id));
            assertActive();
          }
        }
      }

      const requestedIds = [...new Set([...postTargetIds, ...targetIds])];
      const initialAllowedTargetIds = initial.actor.allowedTargetIds;
      const initiallyAllowedIds = initialAllowedTargetIds === undefined
        ? requestedIds
        : requestedIds.filter(id => initialAllowedTargetIds.includes(id));
      const scopedTargets = requestedIds.length === 0 ? [] : await prisma.target.findMany({
        where: { workspaceId: actor.workspaceId, id: { in: initiallyAllowedIds } },
        select: { id: true },
      });
      assertActive();
      const scopedIds = scopedTargets.map(target => target.id);
      if (requestedIds.some(id => !scopedIds.includes(id))) throw new OperationError('forbidden', 'You do not have access to one or more selected destinations.');
      await lockPublishingTargets(tx, actor.workspaceId, scopedIds);
      assertActive();
      if (options.includeInbox) {
        for (const targetId of [...scopedIds].sort()) { await lockInboxChannel(tx, actor.workspaceId, targetId); assertActive(); }
        await assertInboxDeletionsSettled(tx, actor.workspaceId, scopedIds);
        assertActive();
      }

      const current = await authorizePublishing(actor, options.feature, options.access);
      assertActive();
      if (requestedIds.some(id => current.actor.allowedTargetIds !== undefined && !current.actor.allowedTargetIds.includes(id))) {
        throw new OperationError('forbidden', 'You do not have access to one or more selected destinations.');
      }

      assertActive();
      const result = await work({
        actor: current.actor,
        role: current.role,
        signal: controller.signal,
        lockTargets: async ids => {
          assertActive();
          const checkedIds = validateIds(ids, maxTargets, maxIdCharacters);
          const allowedIds = current.actor.allowedTargetIds === undefined
            ? checkedIds
            : checkedIds.filter(id => current.actor.allowedTargetIds!.includes(id));
          const visible = checkedIds.length === 0 ? [] : await prisma.target.findMany({
            where: {
              workspaceId: actor.workspaceId,
              id: { in: allowedIds },
            },
            select: { id: true },
          });
          assertActive();
          if (visible.length !== checkedIds.length) throw new OperationError('forbidden', 'You do not have access to one or more selected destinations.');
          await lockPublishingTargets(tx, actor.workspaceId, visible.map(target => target.id));
          assertActive();
        },
      });
      controller.signal.throwIfAborted();
      return result;
    } finally {
      clearTimeout(timer);
    }
  }, { timeout: guardTimeout, maxWait: operationMaxWait }));
}

/** Atomic local writes and audit must settle inside the outer operation lease. */
export async function withPublishingTransaction<T>(signal: AbortSignal, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const [timeout, maxWait] = await Promise.all([runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs')]);
  signal.throwIfAborted();
  return prisma.$transaction(async tx => {
    signal.throwIfAborted();
    const result = await work(tx);
    signal.throwIfAborted();
    return result;
  }, { timeout, maxWait });
}
