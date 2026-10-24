import type { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { lockPublishingTargets } from '@/modules/publishing/server/guard';
import { requireActiveRoot } from './operations';

type Scope = { workspaceId: string; postId: string; targetId: string };
function positive(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new OperationError('unavailable', 'The publishing operation limits are unavailable.');
}

/** Shared private owner, workspace and publication locks. Remote callers commit
 * their own intent/receipt transactions; never lock those rows in this outer tx. */
export async function withRootPublicationOperation<T>(userId: string, scope: Scope,
  run: (tx: Prisma.TransactionClient, signal: AbortSignal) => Promise<T>, options: { remote?: boolean } = {}): Promise<T> {
  await requireActiveRoot(userId);
  const [transactionTimeout, transactionMaxWait, maxId] = await Promise.all([
    runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs'), runtimeConfig('publishing.identifierMaxCharacters'),
  ]);
  positive(transactionTimeout); positive(transactionMaxWait); positive(maxId);
  if (Object.values(scope).some(id => typeof id !== 'string' || !id || id.length > maxId || /[\u0000-\u001f\u007f]/.test(id))) throw new OperationError('invalid_request', 'Choose a valid publication operation.');
  let timeout = transactionTimeout, maxWait = transactionMaxWait, budget = transactionTimeout;
  if (options.remote) {
    const [operationTimeout, operationMaxWait, workspaceTimeout] = await Promise.all([
      runtimeConfig('publishing.operationTimeoutMs'), runtimeConfig('publishing.operationMaxWaitMs'), runtimeConfig('data.workspaceOperationTimeoutMs'),
    ]);
    positive(operationTimeout); positive(operationMaxWait); positive(workspaceTimeout);
    budget = operationTimeout;
    timeout = operationTimeout + 2 * (transactionTimeout + transactionMaxWait) + operationMaxWait;
    maxWait = operationMaxWait;
    if (timeout >= workspaceTimeout) throw new OperationError('unavailable', 'Publishing operation limits need review.');
  }
  return withWorkspaceOperation(scope.workspaceId, async () => {
    await requireActiveRoot(userId);
    return prisma.$transaction(async tx => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), budget);
      try {
        const key = JSON.stringify(['publishing-post', scope.workspaceId, scope.postId]);
        const locks = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
        if (locks[0]?.acquired !== true) throw new OperationError('conflict', 'Another action is running for this post. Check its outcome before continuing.');
        await lockPublishingTargets(tx, scope.workspaceId, [scope.targetId]);
        const actors = await tx.$queryRaw<Array<{ isInstanceOwner: boolean; disabledAt: Date | null }>>`SELECT "isInstanceOwner", "disabledAt" FROM users WHERE id=${userId} FOR SHARE`;
        if (!actors[0]?.isInstanceOwner || actors[0].disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
        controller.signal.throwIfAborted();
        return await run(tx, controller.signal);
      } finally { clearTimeout(timer); }
    }, { timeout, maxWait });
  });
}
