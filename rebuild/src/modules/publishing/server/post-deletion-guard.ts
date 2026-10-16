import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';

const ACTIVE_DELETION_STATES = ['started', 'uncertain', 'remote_confirmed'];

/** Preserve remote-deletion evidence as a tombstone until an operator settles it. */
export async function assertNoPendingPostDeletionForAliases(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  postIds: readonly string[],
  postTargetIds: readonly string[],
): Promise<void> {
  const uniquePostIds = [...new Set(postIds)];
  const uniquePostTargetIds = [...new Set(postTargetIds)];
  if (!uniquePostIds.length && !uniquePostTargetIds.length) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM rebuild_post_deletions
    WHERE "workspaceId" = ${workspaceId}
      AND state = ANY(${ACTIVE_DELETION_STATES}::text[])
      AND (
        "localPostIds" && ${uniquePostIds}::text[]
        OR "localPostTargetIds" && ${uniquePostTargetIds}::text[]
      )
    LIMIT 1`;
  if (rows.length) throw new OperationError('conflict', 'A remote deletion needs review before this post can be changed. Check its deletion status first.');
}

/** Get only destination aliases recorded for this workspace and removed local post. */
export async function loadPostDeletionTargetIds(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  postId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ targetId: string }>>`
    SELECT DISTINCT "targetId" FROM rebuild_post_deletions
    WHERE "workspaceId" = ${workspaceId}
      AND "localPostIds" @> ARRAY[${postId}]::text[]`;
  return [...new Set(rows.map(row => row.targetId))];
}

/** Refuse erasure while any remote deletion outcome in the selected scope is unresolved. */
export async function assertPostDeletionTargetsSettled(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  targetIds?: readonly string[],
): Promise<void> {
  if (targetIds?.length === 0) return;
  const rows = targetIds === undefined
    ? await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rebuild_post_deletions
      WHERE "workspaceId" = ${workspaceId} AND state = ANY(${ACTIVE_DELETION_STATES}::text[])
      LIMIT 1`
    : await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rebuild_post_deletions
      WHERE "workspaceId" = ${workspaceId} AND state = ANY(${ACTIVE_DELETION_STATES}::text[])
        AND "targetId" = ANY(${[...new Set(targetIds)]}::text[])
      LIMIT 1`;
  if (rows.length) throw new OperationError('conflict', 'A remote deletion needs review before this data or connection can be removed. Check its deletion status first.');
}

/** Prevent background status sync from reviving any non-rejected remote deletion identity. */
export async function assertNoPostDeletionForRemoteIdentity(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  targetId: string,
  remoteId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM rebuild_post_deletions
    WHERE "workspaceId" = ${workspaceId} AND "targetId" = ${targetId} AND "remoteId" = ${remoteId}
      AND state <> 'rejected'
    LIMIT 1`;
  if (rows.length) throw new OperationError('conflict', 'This remote post has a deletion record and cannot be restored by status sync.');
}
