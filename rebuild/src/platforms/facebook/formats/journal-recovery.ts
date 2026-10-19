import { OperationError } from '@/lib/operation-error';
import { createHash } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import type { PlatformPublicationEvidence } from '@/server/platforms/host';
import { PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT } from '@/server/platforms/host';
import type { Prisma } from '../../../../generated/client';

type NativeJournalResolutionRow = {
  state: string;
  knownIds: unknown;
  remoteId: string | null;
  conflicted: boolean;
  parentProvider: string | null;
};

const conflict = () => new OperationError('conflict', 'This Facebook publication has unresolved native delivery evidence. Review its status before recording an outcome.');
const unavailable = () => new OperationError('unavailable', 'The Facebook media history limit is unavailable.');

/**
 * Hold local removal while a Facebook native publication may have reached the
 * provider, or while its receipt conflicts with the neutral publication claim.
 */
export async function assertFacebookNativeSettled(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  targetIds?: readonly string[],
): Promise<void> {
  // An explicit empty target selection means this operation touches no targets.
  if (targetIds && targetIds.length === 0) return;

  const rows = targetIds === undefined
    ? await tx.$queryRaw<Array<{ operationId: string }>>`
      SELECT j."operationId"
      FROM rebuild_facebook_native_journal j
      JOIN rebuild_publication_attempts a
        ON a."workspaceId" = j."workspaceId" AND a.id = j."operationId"
      WHERE j."workspaceId" = ${workspaceId}
        AND a.provider = 'facebook'
        AND NOT (
          (j.state = 'rejected' AND j."knownIds" = '[]'::jsonb AND NOT j.conflicted)
          OR (j.state = 'deleted' AND NOT j.conflicted)
          OR (j.state = 'confirmed' AND NOT j.conflicted
            AND a.state IN ('receipt_recorded', 'projected')
            AND j."remoteId" IS NOT NULL AND a."remotePostId" = j."remoteId")
        )
      LIMIT 1`
    : await tx.$queryRaw<Array<{ operationId: string }>>`
      SELECT j."operationId"
      FROM rebuild_facebook_native_journal j
      JOIN rebuild_publication_attempts a
        ON a."workspaceId" = j."workspaceId" AND a.id = j."operationId"
      WHERE j."workspaceId" = ${workspaceId}
        AND j."targetId" = ANY(${[...targetIds]}::text[])
        AND a.provider = 'facebook'
        AND NOT (
          (j.state = 'rejected' AND j."knownIds" = '[]'::jsonb AND NOT j.conflicted)
          OR (j.state = 'deleted' AND NOT j.conflicted)
          OR (j.state = 'confirmed' AND NOT j.conflicted
            AND a.state IN ('receipt_recorded', 'projected')
            AND j."remoteId" IS NOT NULL AND a."remotePostId" = j."remoteId")
        )
      LIMIT 1`;

  if (rows.length) throw conflict();
}

/** Preserve the shared publication outcome guard while rejecting contradictory native evidence. */
export async function assertFacebookNativeResolution(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  operationId: string,
  outcome: 'PUBLISHED' | 'ABSENT',
  remotePostId?: string,
): Promise<void> {
  const rows = await tx.$queryRaw<NativeJournalResolutionRow[]>`
    SELECT j.state, j."knownIds", j."remoteId", j.conflicted, a.provider AS "parentProvider"
    FROM rebuild_facebook_native_journal j
    LEFT JOIN rebuild_publication_attempts a
      ON a."workspaceId" = j."workspaceId" AND a.id = j."operationId"
    WHERE j."workspaceId" = ${workspaceId} AND j."operationId" = ${operationId}
    LIMIT 1 FOR UPDATE OF j`;
  const row = rows[0];
  // Feed-only and older Facebook publications have no child journal.
  if (!row) return;
  if (row.parentProvider !== 'facebook' || row.conflicted) throw conflict();

  if (outcome === 'ABSENT') {
    if (row.state === 'rejected' && Array.isArray(row.knownIds) && row.knownIds.length === 0) return;
    if (row.state === 'deleted') return;
    throw conflict();
  }

  if (row.state === 'confirmed' && typeof remotePostId === 'string' && remotePostId.length > 0 &&
    row.remoteId === remotePostId && Array.isArray(row.knownIds) && row.knownIds.includes(remotePostId)) return;
  throw conflict();
}

type NativeJournalEvidenceRow = {
  operationId: string;
  workspaceId: string;
  targetId: string;
  format: string;
  state: string;
  remoteId: string | null;
  knownIds: unknown;
  conflicted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function evidenceIdSummary(value: unknown): string {
  let ids: unknown = value;
  if (typeof value === 'string') {
    try { ids = JSON.parse(value); } catch { return 'Unavailable'; }
  }
  if (!Array.isArray(ids)) return 'Unavailable';
  if (ids.length === 0) return 'None';

  if (ids.length > 16 || ids.some(id => typeof id !== 'string' || !id.length || id.length > 2048 || /[\u0000-\u001f\u007f]/.test(id))) return 'Unavailable';
  if (!ids.length) return 'None';
  const joined = ids.join(', ');
  return joined.length <= PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT ? joined : `${ids.length} known IDs (list summarized)`;
}

/**
 * Read Root-only, content-free Facebook native receipt evidence. The caller
 * supplies the cap after external Root authorization; this query intentionally
 * spans tenants for that private operator surface.
 */
export async function readFacebookNativeEvidence(operationId?: string, resultCap?: number): Promise<PlatformPublicationEvidence> {
  if (resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook media history limit.');
  }
  if (operationId !== undefined && (!operationId.trim() || operationId.length > 2048 || /[\u0000-\u001f\u007f]/.test(operationId))) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook publication operation.');
  }

  const configuredLimit = await runtimeConfig('meta.mediaHistoryLimit');
  if (typeof configuredLimit !== 'number' || !Number.isSafeInteger(configuredLimit) || configuredLimit < 1) throw unavailable();
  const limit = Math.min(configuredLimit, resultCap ?? configuredLimit);
  const rows = operationId === undefined
    ? await prisma.$queryRaw<NativeJournalEvidenceRow[]>`
      SELECT j."operationId", j."workspaceId", j."targetId", j.format, j.state,
        j."remoteId", j."knownIds", j.conflicted, j."createdAt", j."updatedAt"
      FROM rebuild_facebook_native_journal j
      JOIN rebuild_publication_attempts a
        ON a."workspaceId" = j."workspaceId" AND a.id = j."operationId"
      WHERE a.provider = 'facebook'
      ORDER BY j."updatedAt" DESC, j."operationId" DESC
      LIMIT ${limit + 1}`
    : await prisma.$queryRaw<NativeJournalEvidenceRow[]>`
      SELECT j."operationId", j."workspaceId", j."targetId", j.format, j.state,
        j."remoteId", j."knownIds", j.conflicted, j."createdAt", j."updatedAt"
      FROM rebuild_facebook_native_journal j
      JOIN rebuild_publication_attempts a
        ON a."workspaceId" = j."workspaceId" AND a.id = j."operationId"
      WHERE a.provider = 'facebook' AND j."operationId" = ${operationId}
      ORDER BY j."updatedAt" DESC, j."operationId" DESC
      LIMIT ${limit + 1}`;

  return {
    title: 'Facebook native publication receipts',
    description: 'Content-free native delivery identifiers and receipt states. Review unresolved or conflicting entries before another action. Long identifier lists are summarized.',
    columns: [
      { key: 'id', label: 'Evidence row' },
      { key: 'operationId', label: 'Publication operation' },
      { key: 'workspaceId', label: 'Workspace' },
      { key: 'targetId', label: 'Target' },
      { key: 'format', label: 'Format' },
      { key: 'state', label: 'Receipt state' },
      { key: 'recordType', label: 'Record type' },
      { key: 'remoteId', label: 'Final remote ID' },
      { key: 'knownIds', label: 'Known remote IDs' },
      { key: 'conflicted', label: 'Conflicting evidence' },
      { key: 'createdAt', label: 'Started (UTC)' },
      { key: 'updatedAt', label: 'Updated (UTC)' },
    ],
    items: rows.slice(0, limit).map(row => ({
      id: `native:${createHash('sha256').update(row.operationId).digest('hex')}`,
      operationId: row.operationId,
      workspaceId: row.workspaceId,
      targetId: row.targetId,
      format: row.format,
      state: row.state === 'published' ? 'submitted' : row.state,
      recordType: 'native',
      remoteId: row.remoteId,
      knownIds: evidenceIdSummary(row.knownIds),
      conflicted: row.conflicted ? 'Yes' : 'No',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    rowIdKey: 'id',
    truncated: rows.length > limit,
  };
}
