import { rootRecoveryFields } from '@/lib/config/root-recovery-policy';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { withInboxChannelOperation } from '@/modules/inbox/server/comment-guard';
import { requireActiveRoot } from './operations';

type DeletionRow = {
  id: string;
  workspaceId: string;
  targetId: string;
  localItemId: string;
  provider?: string;
  remoteId?: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  remoteConfirmedAt: Date | null;
  completedAt: Date | null;
  workspaceName?: string;
  targetName?: string | null;
};

const inputSchema = (fields: ReturnType<typeof rootRecoveryFields>) => z.object({
  ...fields,
  verifiedOnPlatform: z.literal(true),
}).strict();
const forbidden = () => new OperationError('forbidden', 'Installation-owner access is required.');

async function recoveryLimits() {
  const [identifierMaxCharacters, confirmationMaxCharacters] = await Promise.all([
    runtimeConfig('root.identifierMaxCharacters'), runtimeConfig('root.confirmationMaxCharacters'),
  ]);
  return { identifierMaxCharacters, confirmationMaxCharacters };
}

/** Bounded operator view. Remote identities, provider details, reasons and actors stay private. */
export async function listRootInboxDeletions(userId: string, cap?: number) {
  await requireActiveRoot(userId);
  if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1)) throw new OperationError('invalid_request', 'Choose a valid Inbox recovery result limit.');
  const [limit, timeZone] = await Promise.all([
    runtimeConfig('inbox.deletionHistoryLimit'), runtimeConfig('root.operationalTimezone'),
  ]);
  const rows = await prisma.$queryRaw<Array<DeletionRow>>`
    SELECT d.id, d."workspaceId", d."targetId", d."localItemId", d.provider, d."remoteId", d.state,
      d."createdAt", d."updatedAt", d."remoteConfirmedAt", d."completedAt",
      w.name AS "workspaceName", t.name AS "targetName"
    FROM rebuild_inbox_deletions d
    JOIN workspaces w ON w.id = d."workspaceId"
    LEFT JOIN targets t ON t.id = d."targetId" AND t."workspaceId" = d."workspaceId"
    ORDER BY d."updatedAt" DESC, d.id DESC
    LIMIT ${Math.min(limit, cap ?? limit)}
  `;
  return { timeZone, limits: await recoveryLimits(), items: rows.map(row => ({
    operationId: row.id, workspaceId: row.workspaceId, workspaceName: row.workspaceName ?? row.workspaceId,
    targetId: row.targetId, targetName: row.targetName ?? null, provider: row.provider ?? 'unknown', remoteObjectId: row.remoteId ?? '', localItemId: row.localItemId, state: row.state,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    remoteConfirmedAt: row.remoteConfirmedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null,
  })) };
}

/** Record an explicit operator attestation; this never calls a provider or removes local rows. */
export async function confirmRootInboxDeletion(userId: string, input: unknown) {
  await requireActiveRoot(userId);
  const parsed = inputSchema(rootRecoveryFields(await recoveryLimits())).safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== `CONFIRM REMOTE DELETION ${parsed.data.operationId}`) {
    throw new OperationError('invalid_request', 'Verify the remote deletion and enter its exact confirmation.');
  }

  const found = await prisma.$queryRaw<Array<Pick<DeletionRow, 'id' | 'workspaceId' | 'targetId' | 'state'>>>`
    SELECT id, "workspaceId", "targetId", state FROM rebuild_inbox_deletions WHERE id = ${parsed.data.operationId}
  `;
  const initial = found[0];
  if (!initial) throw new OperationError('not_found', 'This deletion operation is unavailable.');
  if (initial.state !== 'started' && initial.state !== 'uncertain') throw new OperationError('conflict', 'This deletion can no longer be manually confirmed.');

  return withWorkspaceOperation(initial.workspaceId, async () => withInboxChannelOperation(initial.workspaceId, initial.targetId, async () => {
    await requireActiveRoot(userId);
    const [timeout, maxWait] = await Promise.all([
      runtimeConfig('inbox.workflowTransactionTimeoutMs'), runtimeConfig('inbox.workflowTransactionMaxWaitMs'),
    ]);
    return prisma.$transaction(async tx => {
      const actors = await tx.$queryRaw<Array<{ isInstanceOwner: boolean; disabledAt: Date | null }>>`
        SELECT "isInstanceOwner", "disabledAt" FROM users WHERE id = ${userId} FOR SHARE
      `;
      if (!actors[0]?.isInstanceOwner || actors[0].disabledAt) throw forbidden();
      const rows = await tx.$queryRaw<Array<Pick<DeletionRow, 'id' | 'workspaceId' | 'targetId' | 'localItemId' | 'state'>>>`
        SELECT id, "workspaceId", "targetId", "localItemId", state FROM rebuild_inbox_deletions
        WHERE id = ${parsed.data.operationId} AND "workspaceId" = ${initial.workspaceId} FOR UPDATE
      `;
      const current = rows[0];
      if (!current || current.targetId !== initial.targetId) throw new OperationError('not_found', 'This deletion operation is unavailable.');
      if (current.state !== 'started' && current.state !== 'uncertain') throw new OperationError('conflict', 'This deletion changed state. Reload recovery history before continuing.');
      await tx.$executeRaw`UPDATE rebuild_inbox_deletions SET state = 'remote_confirmed', reason = 'local_pending', "remoteConfirmedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${current.id} AND "workspaceId" = ${initial.workspaceId} AND state IN ('started', 'uncertain')`;
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt")
        VALUES (${randomUUID()}, ${userId}, 'inbox.comment_deletion_verified', ${JSON.stringify({ workspaceId: current.workspaceId, targetId: current.targetId, itemId: current.localItemId, operationId: current.id })}::jsonb, NOW())`;
      return { ok: true as const, operationId: current.id, workspaceId: current.workspaceId, targetId: current.targetId, localItemId: current.localItemId, state: 'remote_confirmed' as const };
    }, { timeout, maxWait });
  }));
}
