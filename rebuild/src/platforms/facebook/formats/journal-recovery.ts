import { OperationError } from '@/lib/operation-error';
import { createHash } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import type { PlatformPublicationEvidence } from '@/server/platforms/host';
import { PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT } from '@/server/platforms/host';
import type { Prisma } from '../../../../generated/client';
import { facebookNativeEvidenceId, facebookNativeStatusConfirmation, facebookNativeStatusEligible } from './status-recovery-contract';

type NativeJournalResolutionRow = {
  state: string;
  knownIds: unknown;
  remoteId: string | null;
  conflicted: boolean;
  parentProvider: string | null;
  hasAcceptedProof: boolean;
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
            AND j."remoteId" IS NOT NULL AND a."remotePostId" = j."remoteId"
            AND EXISTS (SELECT 1 FROM rebuild_facebook_native_status_proofs p
              WHERE p."workspaceId" = j."workspaceId" AND p."operationId" = j."operationId"
                AND p."payloadHash" = j."payloadHash" AND p.format = j.format
                AND p."remoteTargetId" = j."remoteTargetId" AND p."remoteId" = j."remoteId"
                AND p.accepted AND p.outcome = 'published' AND p."appliedRevision" = j.revision))
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
            AND j."remoteId" IS NOT NULL AND a."remotePostId" = j."remoteId"
            AND EXISTS (SELECT 1 FROM rebuild_facebook_native_status_proofs p
              WHERE p."workspaceId" = j."workspaceId" AND p."operationId" = j."operationId"
                AND p."payloadHash" = j."payloadHash" AND p.format = j.format
                AND p."remoteTargetId" = j."remoteTargetId" AND p."remoteId" = j."remoteId"
                AND p.accepted AND p.outcome = 'published' AND p."appliedRevision" = j.revision))
        )
      LIMIT 1`;

  if (rows.length) throw conflict();

  // A provider-held schedule cancel/reschedule that may have reached Facebook
  // (started or uncertain) also holds removal; the table exists only once its
  // additive migration is applied, so absence means there is nothing to hold.
  const present = await tx.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('rebuild_facebook_native_schedule_changes') IS NOT NULL AS present`;
  if (present[0]?.present !== true) return;
  const pending = targetIds === undefined
    ? await tx.$queryRaw<Array<{ changeId: string }>>`
      SELECT c."changeId"
      FROM rebuild_facebook_native_schedule_changes c
      WHERE c."workspaceId" = ${workspaceId} AND c.state IN ('started', 'uncertain')
      LIMIT 1`
    : await tx.$queryRaw<Array<{ changeId: string }>>`
      SELECT c."changeId"
      FROM rebuild_facebook_native_schedule_changes c
      JOIN rebuild_facebook_native_journal j
        ON j."workspaceId" = c."workspaceId" AND j."operationId" = c."publishOperationId"
      WHERE c."workspaceId" = ${workspaceId} AND j."targetId" = ANY(${[...targetIds]}::text[])
        AND c.state IN ('started', 'uncertain')
      LIMIT 1`;
  if (pending.length) throw conflict();
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
    SELECT j.state, j."knownIds", j."remoteId", j.conflicted, a.provider AS "parentProvider",
      EXISTS (SELECT 1 FROM rebuild_facebook_native_status_proofs p
        WHERE p."workspaceId" = j."workspaceId" AND p."operationId" = j."operationId"
          AND p."payloadHash" = j."payloadHash" AND p.format = j.format
          AND p."remoteTargetId" = j."remoteTargetId" AND p."remoteId" = j."remoteId"
          AND p.accepted AND p.outcome = 'published' AND p."appliedRevision" = j.revision) AS "hasAcceptedProof"
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

  if (row.state === 'confirmed' && row.hasAcceptedProof === true && typeof remotePostId === 'string' && remotePostId.length > 0 &&
    row.remoteId === remotePostId && Array.isArray(row.knownIds) && row.knownIds.includes(remotePostId)) return;
  throw conflict();
}

type NativeJournalEvidenceRow = {
  operationId: string;
  workspaceId: string;
  targetId: string;
  remoteTargetId: string;
  format: string;
  state: string;
  remoteId: string | null;
  knownIds: unknown;
  steps: unknown;
  revision: number;
  parentState: string;
  parentRemoteId: string | null;
  conflicted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type NativeStatusProofEvidenceRow = {
  id: string; operationId: string; workspaceId: string; format: string; remoteTargetId: string; remoteId: string;
  actorId: string; outcome: string; detail: string | null; observedRevision: number; appliedRevision: number | null;
  accepted: boolean; observedAt: Date; createdAt: Date;
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
      SELECT j."operationId", j."workspaceId", j."targetId", j."remoteTargetId", j.format, j.state,
        j."remoteId", j."knownIds", j.steps, j.revision, j.conflicted, j."createdAt", j."updatedAt", a.state AS "parentState", a."remotePostId" AS "parentRemoteId"
      FROM rebuild_facebook_native_journal j
      JOIN rebuild_publication_attempts a
        ON a."workspaceId" = j."workspaceId" AND a.id = j."operationId"
      WHERE a.provider = 'facebook'
      ORDER BY j."updatedAt" DESC, j."operationId" DESC
      LIMIT ${limit + 1}`
    : await prisma.$queryRaw<NativeJournalEvidenceRow[]>`
      SELECT j."operationId", j."workspaceId", j."targetId", j."remoteTargetId", j.format, j.state,
        j."remoteId", j."knownIds", j.steps, j.revision, j.conflicted, j."createdAt", j."updatedAt", a.state AS "parentState", a."remotePostId" AS "parentRemoteId"
      FROM rebuild_facebook_native_journal j
      JOIN rebuild_publication_attempts a
        ON a."workspaceId" = j."workspaceId" AND a.id = j."operationId"
      WHERE a.provider = 'facebook' AND j."operationId" = ${operationId}
      ORDER BY j."updatedAt" DESC, j."operationId" DESC
      LIMIT ${limit + 1}`;

  const statusRecoveryEnabled = await runtimeConfig('facebook.native.statusRecoveryEnabled') === true;
  const journalItems = rows.slice(0, limit).map(row => ({
    id: facebookNativeEvidenceId(row.operationId), operationId: row.operationId,
    workspaceId: row.workspaceId, targetId: row.targetId, format: row.format,
    state: row.state === 'published' ? 'submitted' : row.state, recordType: 'native',
    remoteId: row.remoteId, knownIds: evidenceIdSummary(row.knownIds), conflicted: row.conflicted ? 'Yes' : 'No',
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }));
  const items = journalItems;
  const actions = statusRecoveryEnabled ? rows.slice(0, limit).flatMap(row => {
    if (!facebookNativeStatusEligible(row) || !(['started', 'uncertain'].includes(row.parentState) && row.parentRemoteId === null ||
      ['submitted', 'receipt_recorded', 'projected'].includes(row.parentState) && row.parentRemoteId === row.remoteId)) return [];
    const rowId = facebookNativeEvidenceId(row.operationId);
    return [{ intent: 'inspect' as const, rowId, actionId: 'refresh_native_status', subjectId: row.operationId,
      label: 'Check final publication status',
      description: 'Read the final publication status and Page identity. This checks status only; it will not resend or remove content.',
      acknowledgmentLabel: 'I acknowledge this checks status only and will not resend content.',
      confirmation: facebookNativeStatusConfirmation(row.operationId, row.revision),
      context: [
        { label: 'Workspace', value: row.workspaceId }, { label: 'Target', value: row.targetId },
        { label: 'Facebook Page', value: row.remoteTargetId }, { label: 'Format', value: row.format },
        { label: 'Final publication ID', value: row.remoteId ?? '' }, { label: 'Journal revision', value: String(row.revision) },
      ],
    }];
  }).filter(action => items.some(item => item.id === action.rowId)) : [];

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
    items,
    rowIdKey: 'id',
    actions,
    truncated: rows.length > limit,
  };
}

/** Read bounded Root-only content-free status proof records. */
export async function readFacebookNativeProofEvidence(operationId?: string, resultCap?: number): Promise<PlatformPublicationEvidence> {
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
    ? await prisma.$queryRaw<NativeStatusProofEvidenceRow[]>`
      SELECT p.id, p."operationId", p."workspaceId", p.format, p."remoteTargetId", p."remoteId", p."actorId",
        p.outcome, p.detail, p."observedRevision", p."appliedRevision", p.accepted, p."observedAt", p."createdAt"
      FROM rebuild_facebook_native_status_proofs p
      ORDER BY p."createdAt" DESC, p.id DESC LIMIT ${limit + 1}`
    : await prisma.$queryRaw<NativeStatusProofEvidenceRow[]>`
      SELECT p.id, p."operationId", p."workspaceId", p.format, p."remoteTargetId", p."remoteId", p."actorId",
        p.outcome, p.detail, p."observedRevision", p."appliedRevision", p.accepted, p."observedAt", p."createdAt"
      FROM rebuild_facebook_native_status_proofs p
      WHERE p."operationId" = ${operationId}
      ORDER BY p."createdAt" DESC, p.id DESC LIMIT ${limit + 1}`;
  const items = rows.slice(0, limit).map(row => ({
    id: `native-proof:${createHash('sha256').update(`${row.operationId}:${row.id}`).digest('hex')}`,
    operationId: row.operationId, workspaceId: row.workspaceId, format: row.format,
    state: row.outcome, recordType: 'native_status_proof', remoteId: row.remoteId,
    remoteTargetId: row.remoteTargetId, actorId: row.actorId, detail: row.detail,
    accepted: row.accepted ? 'Accepted at recorded revision' : 'Observed only', observedRevision: row.observedRevision,
    appliedRevision: row.appliedRevision, observedAt: row.observedAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.createdAt.toISOString(),
  }));
  return {
    title: 'Facebook native status observations',
    description: 'Content-free final publication status observations. Acceptance records describe their recorded revision. Later conflicts can keep the publication held; observed-only records did not resolve it.',
    columns: [
      { key: 'id', label: 'Evidence row' }, { key: 'operationId', label: 'Publication operation' },
      { key: 'workspaceId', label: 'Workspace' }, { key: 'format', label: 'Format' },
      { key: 'remoteTargetId', label: 'Facebook Page ID' }, { key: 'remoteId', label: 'Final publication ID' },
      { key: 'state', label: 'Observed status' }, { key: 'recordType', label: 'Record type' }, { key: 'updatedAt', label: 'Updated (UTC)' }, { key: 'accepted', label: 'Proof use' },
      { key: 'detail', label: 'Status detail' }, { key: 'observedRevision', label: 'Observed revision' },
      { key: 'appliedRevision', label: 'Applied revision' }, { key: 'actorId', label: 'Root operator' },
      { key: 'observedAt', label: 'Observed (UTC)' }, { key: 'createdAt', label: 'Recorded (UTC)' },
    ],
    items, rowIdKey: 'id', actions: [], truncated: rows.length > limit,
  };
}

type NativeScheduleChangeEvidenceRow = {
  changeId: string; workspaceId: string; publishOperationId: string; kind: string;
  scheduledUnix: bigint | number | null; remoteId: string; remoteTargetId: string;
  revision: number; state: string; createdAt: Date; updatedAt: Date;
};

/**
 * Read bounded Root-only, content-free provider-held schedule change records
 * (cancel / reschedule of a native Video). A deployment that has not applied the
 * schedule-change migration yet reports an empty list instead of failing the
 * whole evidence read.
 */
export async function readFacebookNativeScheduleEvidence(operationId?: string, resultCap?: number): Promise<PlatformPublicationEvidence> {
  if (resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook media history limit.');
  }
  if (operationId !== undefined && (!operationId.trim() || operationId.length > 2048 || /[\u0000-\u001f\u007f]/.test(operationId))) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook publication operation.');
  }
  const configuredLimit = await runtimeConfig('meta.mediaHistoryLimit');
  if (typeof configuredLimit !== 'number' || !Number.isSafeInteger(configuredLimit) || configuredLimit < 1) throw unavailable();
  const limit = Math.min(configuredLimit, resultCap ?? configuredLimit);
  const present = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('rebuild_facebook_native_schedule_changes') IS NOT NULL AS present`;
  const rows = present[0]?.present !== true ? [] : operationId === undefined
    ? await prisma.$queryRaw<NativeScheduleChangeEvidenceRow[]>`
      SELECT c."changeId", c."workspaceId", c."publishOperationId", c.kind, c."scheduledUnix", c."remoteId",
        c."remoteTargetId", c.revision, c.state, c."createdAt", c."updatedAt"
      FROM rebuild_facebook_native_schedule_changes c
      ORDER BY c."updatedAt" DESC, c."changeId" DESC LIMIT ${limit + 1}`
    : await prisma.$queryRaw<NativeScheduleChangeEvidenceRow[]>`
      SELECT c."changeId", c."workspaceId", c."publishOperationId", c.kind, c."scheduledUnix", c."remoteId",
        c."remoteTargetId", c.revision, c.state, c."createdAt", c."updatedAt"
      FROM rebuild_facebook_native_schedule_changes c
      WHERE c."publishOperationId" = ${operationId}
      ORDER BY c."updatedAt" DESC, c."changeId" DESC LIMIT ${limit + 1}`;
  const items = rows.slice(0, limit).map(row => ({
    id: `native-schedule:${createHash('sha256').update(`${row.workspaceId}:${row.changeId}`).digest('hex')}`,
    operationId: row.publishOperationId, workspaceId: row.workspaceId, format: 'video',
    state: row.state, recordType: 'native_schedule_change', remoteId: row.remoteId, remoteTargetId: row.remoteTargetId,
    changeKind: row.kind === 'cancel' ? 'Cancel scheduled publication' : 'Reschedule',
    newScheduleUnix: row.scheduledUnix === null ? 'Not applicable' : String(row.scheduledUnix),
    revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }));
  return {
    title: 'Facebook native schedule changes',
    description: 'Content-free records of provider-held schedule cancellations and reschedules. An uncertain change is never repeated automatically.',
    columns: [
      { key: 'id', label: 'Evidence row' }, { key: 'operationId', label: 'Publication operation' },
      { key: 'workspaceId', label: 'Workspace' }, { key: 'format', label: 'Format' },
      { key: 'state', label: 'Change state' }, { key: 'recordType', label: 'Record type' },
      { key: 'changeKind', label: 'Change' }, { key: 'newScheduleUnix', label: 'New schedule (Unix)' },
      { key: 'remoteId', label: 'Final publication ID' }, { key: 'remoteTargetId', label: 'Facebook Page ID' },
      { key: 'revision', label: 'Revision' }, { key: 'createdAt', label: 'Started (UTC)' }, { key: 'updatedAt', label: 'Updated (UTC)' },
    ],
    items, rowIdKey: 'id', actions: [], truncated: rows.length > limit,
  };
}
