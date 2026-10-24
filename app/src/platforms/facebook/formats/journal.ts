import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { executeFacebookNative } from './execute';
import { snapshotFacebookNativePlan } from './identity';
import type { FacebookNativeAttemptRecord, FacebookNativeAttemptStore, FacebookNativeFormat, FacebookNativePlan, FacebookNativeTransport } from './types';

export interface FacebookNativeJournalBinding {
  workspaceId: string;
  operationId: string;
  postId: string;
  postTargetId: string;
  targetId: string;
  actorId: string;
  remoteTargetId: string;
  sourceFormatId: string;
}
export interface FacebookNativeJournalScope extends FacebookNativeJournalBinding {
  format: FacebookNativeFormat;
  payloadHash: string;
}
type Parent = FacebookNativeJournalBinding & { id: string; provider: string; state: string };
type Row = FacebookNativeJournalScope & Omit<FacebookNativeAttemptRecord, 'targetId'> & {
  targetId: string; ownerToken: string; revision: number; conflicted: boolean;
};
type Database = Pick<PrismaClient, '$transaction'>;
type Limits = { timeout: number; maxWait: number };
const conflict = () => new OperationError('conflict', 'This publication no longer matches its saved operation. Review its status before trying again.');

function checkedScope(input: FacebookNativeJournalScope): Readonly<FacebookNativeJournalScope> {
  const scope = { ...input };
  for (const key of ['workspaceId', 'operationId', 'postId', 'postTargetId', 'targetId', 'actorId', 'remoteTargetId', 'sourceFormatId'] as const) {
    const value = scope[key];
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > (key === 'sourceFormatId' ? 128 : 2048) || /[\u0000-\u001f\u007f]/.test(value)) throw conflict();
  }
  if (!['video', 'reel', 'story_photo', 'story_video'].includes(scope.format) || !/^[a-f0-9]{64}$/.test(scope.payloadHash)) throw conflict();
  return Object.freeze(scope);
}
function assertBinding(scope: Readonly<FacebookNativeJournalScope>, row: FacebookNativeJournalScope) {
  for (const key of Object.keys(scope) as Array<keyof FacebookNativeJournalScope>) if (scope[key] !== row[key]) throw conflict();
}
function record(row: Row): FacebookNativeAttemptRecord {
  return { operationId: row.operationId, format: row.format, payloadHash: row.payloadHash,
    state: row.conflicted ? 'uncertain' : row.state, knownIds: [...row.knownIds],
    steps: row.steps?.map(step => ({ ...step })), targetId: row.remoteTargetId, remoteId: row.remoteId ?? null };
}
async function configuredLimits(): Promise<Limits> {
  const values = await runtimeConfigBatch(['publishing.transactionTimeoutMs', 'publishing.transactionMaxWaitMs']);
  const limits = { timeout: values['publishing.transactionTimeoutMs'], maxWait: values['publishing.transactionMaxWaitMs'] };
  if (![limits.timeout, limits.maxWait].every(value => Number.isSafeInteger(value) && (value as number) > 0)) {
    throw new OperationError('unavailable', 'Publishing storage is temporarily unavailable.');
  }
  return limits as Limits;
}

/** Trusted host port: the caller already owns the shared publication claim and
 * operation authorization. This child cannot create/reclaim that authority.
 * Each instance owns only its newly inserted row, never an existing row.
 */
export function createFacebookNativeJournal(input: FacebookNativeJournalScope, options: {
  database?: Database;
  limits?: () => Promise<Limits>;
} = {}): FacebookNativeAttemptStore {
  const scope = checkedScope(input);
  const database = options.database ?? prisma;
  const loadLimits = options.limits ?? configuredLimits;
  const ownerToken = randomUUID();
  let revision: number | undefined;
  const transaction = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
    const limits = await loadLimits();
    if (![limits.timeout, limits.maxWait].every(value => Number.isSafeInteger(value) && value > 0)) throw conflict();
    return database.$transaction(work, limits);
  };
  async function parent(tx: Prisma.TransactionClient): Promise<Parent> {
    const rows = await tx.$queryRaw<Parent[]>`SELECT * FROM rebuild_publication_attempts
      WHERE id=${scope.operationId} AND "workspaceId"=${scope.workspaceId} FOR UPDATE`;
    const row = rows[0];
    if (!row || row.provider !== 'facebook' || row.postId !== scope.postId || row.postTargetId !== scope.postTargetId ||
      row.targetId !== scope.targetId || row.actorId !== scope.actorId) throw conflict();
    return row;
  }
  async function child(tx: Prisma.TransactionClient): Promise<Row | null> {
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM rebuild_facebook_native_journal
      WHERE "workspaceId"=${scope.workspaceId} AND "operationId"=${scope.operationId} FOR UPDATE`;
    const row = rows[0];
    if (row) assertBinding(scope, row);
    return row ?? null;
  }
  async function live(tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT pt.id FROM post_targets pt
      JOIN posts p ON p.id=pt."postId" AND p."workspaceId"=${scope.workspaceId}
      JOIN targets t ON t.id=pt."targetId" AND t."workspaceId"=${scope.workspaceId}
      JOIN social_accounts s ON s.id=t."socialAccountId" AND s."workspaceId"=${scope.workspaceId}
      WHERE pt.id=${scope.postTargetId} AND pt."postId"=${scope.postId} AND pt."targetId"=${scope.targetId}
        AND pt.status='processing' AND pt."remotePostId" IS NULL
        AND t.type='page' AND t.enabled AND t."canPublish" AND t."providerId"=${scope.remoteTargetId}
        AND s.provider='facebook' AND s."invalidatedAt" IS NULL
        AND (s."tokenExpiresAt" IS NULL OR s."tokenExpiresAt">CURRENT_TIMESTAMP)
        AND COALESCE(pt."formatId", p.format)=${scope.sourceFormatId}`;
    return rows.length === 1;
  }
  return {
    async begin(proposed) {
      if (proposed.operationId !== scope.operationId || proposed.targetId !== scope.remoteTargetId || proposed.format !== scope.format ||
        proposed.payloadHash !== scope.payloadHash || proposed.state !== 'started' || proposed.knownIds.length ||
        proposed.steps?.length || proposed.remoteId != null) throw conflict();
      return transaction(async tx => {
        const claim = await parent(tx); // parent first, never reacquire outer advisory locks
        const existing = await child(tx);
        if (existing) return { created: false as const, existing: record(existing) };
        if (claim.state !== 'started' || !await live(tx)) throw conflict();
        await tx.$executeRaw`INSERT INTO rebuild_facebook_native_journal
          ("operationId","workspaceId","postId","postTargetId","targetId","actorId","remoteTargetId",format,"sourceFormatId","payloadHash","ownerToken")
          VALUES (${scope.operationId},${scope.workspaceId},${scope.postId},${scope.postTargetId},${scope.targetId},${scope.actorId},${scope.remoteTargetId},${scope.format},${scope.sourceFormatId},${scope.payloadHash},${ownerToken}::uuid)`;
        return { created: true as const };
      }).then(result => { if (result.created) revision = 0; return result; });
    },
    async update(operationId, patch, expectedStates) {
      if (operationId !== scope.operationId) throw conflict();
      const expectedRevision = revision; // capture before awaits: concurrent writes cannot both advance
      if (expectedRevision === undefined) return false;
      if (patch.state !== undefined && !['started', 'published', 'rejected', 'uncertain'].includes(patch.state)) throw conflict();
      const savedPatch = { ...patch, knownIds: patch.knownIds && [...patch.knownIds], steps: patch.steps?.map(step => ({ ...step })) };
      const result = await transaction(async tx => {
        const claim = await parent(tx);
        const row = await child(tx);
        if (!row || row.ownerToken !== ownerToken) return { applied: false, revision: undefined };
        const active = row.revision === expectedRevision && row.state === 'started' && claim.state === 'started' &&
          !row.conflicted && (!expectedStates || expectedStates.includes(row.state)) && await live(tx);
        const state = active ? savedPatch.state ?? row.state : row.state === 'started' ? 'uncertain' : row.state;
        // A late provider receipt may confirm an existing intent, but never
        // creates permission to dispatch another phase after authority is gone.
        const steps = active ? savedPatch.steps ?? row.steps ?? [] : (row.steps ?? []).map((step, index) => ({ ...step,
          confirmed: step.confirmed || savedPatch.steps?.[index]?.phase === step.phase && savedPatch.steps[index].confirmed === true,
        }));
        const ids = active ? savedPatch.knownIds ?? row.knownIds : [...new Set([...row.knownIds, ...(savedPatch.knownIds ?? []),
          ...(savedPatch.remoteId ? [savedPatch.remoteId] : [])])];
        const remoteId = row.remoteId ?? savedPatch.remoteId ?? null;
        // A stale writer can append only newly observed receipt facts. It can
        // never acquire a new dispatch intent or erase a newer operator result.
        if (!active && ids.length === row.knownIds.length && JSON.stringify(steps) === JSON.stringify(row.steps ?? []) && remoteId === (row.remoteId ?? null)) {
          return { applied: false, revision: undefined };
        }
        const changed = await tx.$executeRaw`UPDATE rebuild_facebook_native_journal
          SET state=${state}, "knownIds"=${JSON.stringify(ids)}::jsonb, steps=${JSON.stringify(steps)}::jsonb,
            "remoteId"=${remoteId}, conflicted=${row.conflicted || !active}, revision=revision+1, "updatedAt"=clock_timestamp()
          WHERE "workspaceId"=${scope.workspaceId} AND "operationId"=${scope.operationId}
            AND "ownerToken"=${ownerToken}::uuid AND revision=${row.revision}`;
        return { applied: changed === 1 && active, revision: changed === 1 ? row.revision + 1 : undefined };
      });
      if (result.revision !== undefined) revision = result.revision;
      return result.applied;
    },
    async get(operationId) {
      if (operationId !== scope.operationId) throw conflict();
      return transaction(async tx => { await parent(tx); const row = await child(tx); return row ? record(row) : null; });
    },
  };
}

/** Private integration seam; customer formats remain unavailable until final
 * status, comment/deletion recovery and live-provider gates are complete. */
export function executeFacebookNativeWithJournal(binding: FacebookNativeJournalBinding, input: FacebookNativePlan, deps: {
  transport: FacebookNativeTransport;
  database?: Database;
  limits?: () => Promise<Limits>;
}) {
  const { plan, payloadHash } = snapshotFacebookNativePlan(input);
  if (plan.targetId !== binding.remoteTargetId) throw conflict();
  const attempts = createFacebookNativeJournal({ ...binding, format: plan.format, payloadHash }, deps);
  return executeFacebookNative(plan, binding.operationId, { transport: deps.transport, attempts });
}
