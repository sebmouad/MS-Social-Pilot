import { rootRecoveryFields } from '@/lib/config/root-recovery-policy';
import { z } from 'zod';
import type { Prisma } from '../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { lockPublishingTargets } from '@/modules/publishing/server/guard';
import { recordPostDeletionOutcomeInTransaction } from '@/modules/publishing/server/deletion';
import { requireActiveRoot } from './operations';

type DeletionRow = {
  id: string; workspaceId: string; targetId: string; provider: string; remoteId: string;
  localPostIds: string[]; localPostTargetIds: string[]; state: string;
  createdAt: Date; updatedAt: Date; remoteConfirmedAt: Date | null; completedAt: Date | null;
  workspaceName: string | null; targetName: string | null;
};

const inputSchema = (fields: ReturnType<typeof rootRecoveryFields>) => z.object({
  ...fields,
  outcome: z.enum(['deleted', 'not_deleted']),
  verifiedOnPlatform: z.literal(true),
}).strict();
const forbidden = () => new OperationError('forbidden', 'Installation-owner access is required.');

async function recoveryLimits() {
  const [identifierMaxCharacters, confirmationMaxCharacters] = await Promise.all([
    runtimeConfig('root.identifierMaxCharacters'), runtimeConfig('root.confirmationMaxCharacters'),
  ]);
  return { identifierMaxCharacters, confirmationMaxCharacters };
}

/** Bounded private Root view. No post text, credentials, or provider errors are selected. */
export async function listRootPostDeletions(userId: string, cap?: number) {
  await requireActiveRoot(userId);
  if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1)) throw new OperationError('invalid_request', 'Choose a valid Publishing recovery result limit.');
  const [limit, timeZone] = await Promise.all([
    runtimeConfig('publishing.deletionHistoryLimit'), runtimeConfig('root.operationalTimezone'),
  ]);
  const rows = await prisma.$queryRaw<DeletionRow[]>`
    SELECT d.id, d."workspaceId", d."targetId", d.provider, d."remoteId",
      d."localPostIds", d."localPostTargetIds", d.state, d."createdAt", d."updatedAt",
      d."remoteConfirmedAt", d."completedAt", w.name AS "workspaceName", t.name AS "targetName"
    FROM rebuild_post_deletions d
    LEFT JOIN workspaces w ON w.id = d."workspaceId"
    LEFT JOIN targets t ON t.id = d."targetId" AND t."workspaceId" = d."workspaceId"
    ORDER BY d."updatedAt" DESC, d.id DESC LIMIT ${Math.min(limit, cap ?? limit)}
  `;
  return { timeZone, limits: await recoveryLimits(), items: rows.map(row => ({
    operationId: row.id, workspaceId: row.workspaceId, workspaceName: row.workspaceName ?? row.workspaceId,
    targetId: row.targetId, targetName: row.targetName, provider: row.provider,
    remotePostId: row.remoteId, localPostIds: row.localPostIds, localPostTargetIds: row.localPostTargetIds,
    state: row.state, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    remoteConfirmedAt: row.remoteConfirmedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null,
  })) };
}

/** Record a Root human attestation. This never calls a provider or performs local cleanup. */
export async function recordRootPostDeletionOutcome(userId: string, input: unknown) {
  await requireActiveRoot(userId);
  const parsed = inputSchema(rootRecoveryFields(await recoveryLimits())).safeParse(input);
  const expected = parsed.success
    ? `ROOT RECORD POST DELETION ${parsed.data.operationId} ${parsed.data.outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}`
    : '';
  if (!parsed.success || parsed.data.confirmation !== expected) {
    throw new OperationError('invalid_request', 'Verify the current platform result and enter its exact confirmation.');
  }
  const found = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; targetId: string; state: string }>>`
    SELECT id, "workspaceId", "targetId", state FROM rebuild_post_deletions WHERE id = ${parsed.data.operationId}
  `;
  const initial = found[0];
  if (!initial) throw new OperationError('not_found', 'This deletion operation is unavailable.');
  if (!['started', 'uncertain'].includes(initial.state)) throw new OperationError('conflict', 'This deletion can no longer be manually attested.');

  return withWorkspaceOperation(initial.workspaceId, async () => {
    await requireActiveRoot(userId);
    const [timeout, maxWait] = await Promise.all([
      runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs'),
    ]);
    return prisma.$transaction(async tx => {
      await lockPublishingTargets(tx, initial.workspaceId, [initial.targetId]);
      const actors = await tx.$queryRaw<Array<{ isInstanceOwner: boolean; disabledAt: Date | null }>>`
        SELECT "isInstanceOwner", "disabledAt" FROM users WHERE id = ${userId} FOR SHARE
      `;
      if (!actors[0]?.isInstanceOwner || actors[0].disabledAt) throw forbidden();
      // The shared domain helper locks/rechecks the journal row and atomically writes its state and audit.
      return recordPostDeletionOutcomeInTransaction(tx as Prisma.TransactionClient, userId, {
        operationId: parsed.data.operationId, workspaceId: initial.workspaceId, outcome: parsed.data.outcome,
      });
    }, { timeout, maxWait });
  });
}
