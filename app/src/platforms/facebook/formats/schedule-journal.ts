import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import type { FacebookNativeAttemptRecord, FacebookNativeAttemptStore } from './types';

/*
 * Durable, tenant-bound store for provider-held schedule changes (cancel / reschedule of a native Video).
 * It implements the same attempt port as the publication journal so schedule.ts needs no change: the publication
 * operation id reads the parent journal row, `<op>:cancel` and `<op>:reschedule:<unix>` read/write child rows in
 * facebook_native_schedule_changes. Each child is bound to the parent journal row, workspace and remote id,
 * is created at most once, and only its creator may settle it. A confirmed cancel is the only thing that can move
 * the parent journal to `deleted`. Trusted host port: the caller has already authorized the operation.
 */
export interface FacebookNativeScheduleScope { workspaceId: string; publishOperationId: string }
type Database = Pick<PrismaClient, '$transaction'>;
type Limits = { timeout: number; maxWait: number };
type Journal = { operationId: string; format: 'video' | 'reel' | 'story_photo' | 'story_video'; state: FacebookNativeAttemptRecord['state'];
  knownIds: string[]; remoteTargetId: string; remoteId: string | null; conflicted: boolean };
type Change = { changeId: string; kind: 'cancel' | 'reschedule'; remoteId: string; remoteTargetId: string; ownerToken: string;
  revision: number; state: FacebookNativeAttemptRecord['state'] };
const conflict = () => new OperationError('conflict', 'This schedule change no longer matches its saved publication. Review its status before trying again.');
const CHILD_STATES = ['started', 'published', 'rejected', 'uncertain', 'deleted'] as const;

async function configuredLimits(): Promise<Limits> {
  const values = await runtimeConfigBatch(['publishing.transactionTimeoutMs', 'publishing.transactionMaxWaitMs']);
  const limits = { timeout: values['publishing.transactionTimeoutMs'], maxWait: values['publishing.transactionMaxWaitMs'] };
  if (![limits.timeout, limits.maxWait].every(value => Number.isSafeInteger(value) && (value as number) > 0)) {
    throw new OperationError('unavailable', 'Publishing storage is temporarily unavailable.');
  }
  return limits as Limits;
}

export function createFacebookNativeScheduleStore(input: FacebookNativeScheduleScope, options: { database?: Database; limits?: () => Promise<Limits> } = {}): FacebookNativeAttemptStore {
  const scope = Object.freeze({ ...input });
  for (const value of [scope.workspaceId, scope.publishOperationId]) {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw conflict();
  }
  const database = options.database ?? prisma;
  const loadLimits = options.limits ?? configuredLimits;
  const ownerToken = randomUUID();
  const owned = new Map<string, number>(); // child id -> revision this instance last wrote
  const cancelId = `${scope.publishOperationId}:cancel`;
  const rescheduleId = /^[1-9][0-9]{0,11}$/;
  /** Cancel, or reschedule to a positive whole unix second; anything else is not a schedule child. */
  function kindOf(id: string): { kind: 'cancel' | 'reschedule'; unix: number | null } | null {
    if (id === cancelId) return { kind: 'cancel', unix: null };
    const prefix = `${scope.publishOperationId}:reschedule:`;
    if (id.startsWith(prefix) && rescheduleId.test(id.slice(prefix.length))) return { kind: 'reschedule', unix: Number(id.slice(prefix.length)) };
    return null;
  }
  const transaction = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
    const limits = await loadLimits();
    if (![limits.timeout, limits.maxWait].every(value => Number.isSafeInteger(value) && value > 0)) throw conflict();
    return database.$transaction(work, limits);
  };
  async function journal(tx: Prisma.TransactionClient): Promise<Journal | null> {
    const rows = await tx.$queryRaw<Journal[]>`SELECT "operationId", format, state, "knownIds", "remoteTargetId", "remoteId", conflicted
      FROM facebook_native_journal WHERE "workspaceId"=${scope.workspaceId} AND "operationId"=${scope.publishOperationId} FOR UPDATE`;
    return rows[0] ?? null;
  }
  async function change(tx: Prisma.TransactionClient, id: string): Promise<Change | null> {
    const rows = await tx.$queryRaw<Change[]>`SELECT "changeId", kind, "remoteId", "remoteTargetId", "ownerToken", revision, state
      FROM facebook_native_schedule_changes WHERE "workspaceId"=${scope.workspaceId} AND "changeId"=${id} FOR UPDATE`;
    return rows[0] ?? null;
  }
  const childRecord = (row: Change): FacebookNativeAttemptRecord => ({ operationId: row.changeId, format: 'video', state: row.state,
    knownIds: [row.remoteId], targetId: row.remoteTargetId, remoteId: null });
  const parentRecord = (row: Journal): FacebookNativeAttemptRecord => ({ operationId: row.operationId, format: row.format,
    state: row.conflicted ? 'uncertain' : row.state, knownIds: [...row.knownIds], targetId: row.remoteTargetId, remoteId: row.remoteId });

  return {
    async begin(proposed) {
      const parsed = kindOf(proposed.operationId);
      if (!parsed || proposed.format !== 'video' || proposed.state !== 'started' || proposed.knownIds.length !== 1 ||
        proposed.steps?.length || proposed.remoteId != null || typeof proposed.targetId !== 'string') throw conflict();
      const remoteId = proposed.knownIds[0];
      const targetId = proposed.targetId;
      const result = await transaction(async tx => {
        const parent = await journal(tx);
        if (!parent || parent.format !== 'video' || parent.remoteId !== remoteId || parent.remoteTargetId !== targetId) throw conflict();
        const existing = await change(tx, proposed.operationId);
        if (existing) {
          if (existing.remoteId !== remoteId) throw conflict();
          return { created: false as const, existing: childRecord(existing) };
        }
        if (parent.conflicted || (parent.state !== 'published' && parent.state !== 'confirmed')) throw conflict();
        await tx.$executeRaw`INSERT INTO facebook_native_schedule_changes
          ("changeId","workspaceId","publishOperationId",kind,"scheduledUnix","remoteId","remoteTargetId","ownerToken")
          VALUES (${proposed.operationId},${scope.workspaceId},${scope.publishOperationId},${parsed.kind},${parsed.unix}::bigint,${remoteId},${targetId},${ownerToken}::uuid)`;
        return { created: true as const };
      });
      if (result.created) owned.set(proposed.operationId, 0);
      return result;
    },
    async update(operationId, patch, expectedStates) {
      if (operationId === scope.publishOperationId) {
        // The only parent change this store may make: a verified cancel moves a published Video to deleted.
        if (patch.state !== 'deleted' || patch.knownIds || patch.steps || patch.remoteId !== undefined) throw conflict();
        return transaction(async tx => {
          const parent = await journal(tx);
          if (!parent || parent.format !== 'video' || parent.conflicted) return false;
          if (expectedStates && !expectedStates.includes(parent.state)) return false;
          if (parent.state !== 'published' && parent.state !== 'confirmed') return false;
          const cancelled = await change(tx, cancelId);
          if (!cancelled || cancelled.state !== 'deleted' || cancelled.remoteId !== parent.remoteId) return false;
          const changed = await tx.$executeRaw`UPDATE facebook_native_journal
            SET state='deleted', revision=revision+1, "updatedAt"=clock_timestamp()
            WHERE "workspaceId"=${scope.workspaceId} AND "operationId"=${scope.publishOperationId} AND state=${parent.state}`;
          return changed === 1;
        });
      }
      const parsed = kindOf(operationId);
      if (!parsed || patch.knownIds || patch.steps || patch.remoteId !== undefined) throw conflict();
      if (patch.state !== undefined && !(CHILD_STATES as readonly string[]).includes(patch.state)) throw conflict();
      const expectedRevision = owned.get(operationId); // captured before awaits
      if (expectedRevision === undefined) return false;
      const result = await transaction(async tx => {
        await journal(tx);
        const row = await change(tx, operationId);
        if (!row || row.ownerToken !== ownerToken || row.revision !== expectedRevision) return { applied: false, revision: undefined };
        if (expectedStates && !expectedStates.includes(row.state)) return { applied: false, revision: undefined };
        const next = patch.state ?? row.state;
        const changed = await tx.$executeRaw`UPDATE facebook_native_schedule_changes
          SET state=${next}, revision=revision+1, "updatedAt"=clock_timestamp()
          WHERE "workspaceId"=${scope.workspaceId} AND "changeId"=${operationId} AND "ownerToken"=${ownerToken}::uuid AND revision=${row.revision}`;
        return { applied: changed === 1, revision: changed === 1 ? row.revision + 1 : undefined };
      });
      if (result.revision !== undefined) owned.set(operationId, result.revision);
      return result.applied;
    },
    async get(operationId) {
      if (operationId === scope.publishOperationId) return transaction(async tx => { const row = await journal(tx); return row ? parentRecord(row) : null; });
      if (!kindOf(operationId)) throw conflict();
      return transaction(async tx => { const row = await change(tx, operationId); return row ? childRecord(row) : null; });
    },
  };
}
