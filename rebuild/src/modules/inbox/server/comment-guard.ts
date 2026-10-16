import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';

/** Lock order: workspace operation, then channel, then journal/local transaction.
 * A try-lock avoids waiting on another channel operation while holding a pool
 * connection. The committed journal, not this transient lock, prevents retries
 * after an ambiguous remote deletion or process crash.
 */
export async function withInboxChannelOperation<T>(workspaceId: string, targetId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const [timeout, maxWait, localTimeout, workspaceTimeout] = await Promise.all([
    runtimeConfig('inbox.commentOperationTimeoutMs'), runtimeConfig('inbox.commentOperationMaxWaitMs'),
    runtimeConfig('inbox.workflowTransactionTimeoutMs'),
    runtimeConfig('data.workspaceOperationTimeoutMs'),
  ]);
  const guardTimeout = timeout + 2 * localTimeout + maxWait;
  if (guardTimeout >= workspaceTimeout) throw new OperationError('unavailable', 'Comment actions are temporarily unavailable. Contact your workspace administrator.');
  return prisma.$transaction(async tx => {
    await lockInboxChannel(tx, workspaceId, targetId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const result = await operation(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally { clearTimeout(timer); }
  // Leave the original action budget plus two local transactions to persist an
  // ambiguous outcome and finish/cancel local work before releasing the lock.
  }, { timeout: guardTimeout, maxWait });
}

/** Same lock for lifecycle transactions that already own their database client. */
export async function lockInboxChannel(tx: Prisma.TransactionClient, workspaceId: string, targetId: string): Promise<void> {
  const key = JSON.stringify(['inbox-comments', workspaceId, targetId]);
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
  if (rows[0]?.acquired !== true) throw new OperationError('conflict', 'Another comment action is running for this channel. Check its outcome before continuing.');
}

/** Never discard unresolved evidence or remove the resource needed to recover. */
export async function assertInboxDeletionsSettled(tx: Prisma.TransactionClient, workspaceId: string, targetIds?: string[]): Promise<void> {
  const rows = targetIds === undefined
    ? await tx.$queryRaw<Array<{ pending: boolean }>>`SELECT EXISTS (SELECT 1 FROM rebuild_inbox_deletions WHERE "workspaceId" = ${workspaceId} AND state IN ('started', 'uncertain', 'remote_confirmed')) AS pending`
    : await tx.$queryRaw<Array<{ pending: boolean }>>`SELECT EXISTS (SELECT 1 FROM rebuild_inbox_deletions WHERE "workspaceId" = ${workspaceId} AND "targetId" = ANY(${targetIds}) AND state IN ('started', 'uncertain', 'remote_confirmed')) AS pending`;
  if (rows[0]?.pending === true) throw new OperationError('conflict', 'A comment deletion needs recovery before this data or connection can be removed. Check its deletion status first.');
}

/** Called inside a channel-locked persistence transaction, including worker sync. */
export async function inboxCommentSuppressed(tx: Prisma.TransactionClient, workspaceId: string, targetId: string, remoteId: string, parentRemoteId?: string | null): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_inbox_deletions WHERE "workspaceId" = ${workspaceId} AND "targetId" = ${targetId}
    AND state <> 'rejected' AND ("remoteId" = ${remoteId} OR "remoteId" = ${parentRemoteId ?? remoteId}
      OR ${remoteId} = ANY("suppressedRemoteIds") OR ${parentRemoteId ?? remoteId} = ANY("suppressedRemoteIds"))`;
  if (!rows.length) return false;
  // Retain newly observed stale descendants too, so later sync windows cannot
  // restore their children after the original local rows have disappeared.
  for (const row of rows) await tx.$executeRaw`UPDATE rebuild_inbox_deletions SET "suppressedRemoteIds" = array_append("suppressedRemoteIds", ${remoteId})
    WHERE id = ${row.id} AND "workspaceId" = ${workspaceId} AND NOT (${remoteId} = ANY("suppressedRemoteIds"))`;
  return true;
}

/** Parent-first ordering lets tombstones propagate across an unordered batch. */
export function orderInboxCommentBatch<T extends { id: string; parentId?: string | null }>(items: readonly T[]): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length) throw new OperationError('upstream_failure', 'Comment history could not be safely synchronized.');
  const children = new Map<string, T[]>();
  const ready: T[] = [];
  for (const item of items) {
    if (!item.parentId || !byId.has(item.parentId)) ready.push(item);
    else children.set(item.parentId, [...children.get(item.parentId) ?? [], item]);
  }
  const ordered: T[] = [];
  for (let index = 0; index < ready.length; index++) {
    const item = ready[index]!; ordered.push(item);
    ready.push(...children.get(item.id) ?? []);
  }
  if (ordered.length !== items.length) throw new OperationError('upstream_failure', 'Comment history could not be safely synchronized.');
  return ordered;
}
