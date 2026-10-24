import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { requireActiveRoot } from '@/server/root/operations';
import { withRootPublicationOperation } from '@/server/root/publication-operation';
import type { PlatformPublicationActionInput, PlatformPublicationActionResult } from '@/server/platforms/host';
import { appendFacebookMediaResolution, type FacebookMediaResolutionBinding } from './media-resolution-store';

type StepCandidate = {
  id: string;
  workspaceId: string;
  operationId: string;
  postId: string;
  postTargetId: string;
  targetId: string;
  actorId: string;
  remoteTargetId: string;
  providerId: string | null;
  phase: 'photo' | 'feed';
  ordinal: number;
  state: string;
  remoteId: string | null;
  parentProvider: string;
  parentState: string;
  parentRemotePostId: string | null;
  parentPostId: string;
  parentPostTargetId: string;
  parentTargetId: string;
  parentActorId: string;
  projectedRemotePostId: string | null;
};
type DeletionCandidate = {
  id: string;
  mediaStepId: string;
  workspaceId: string;
  operationId: string;
  postId: string;
  postTargetId: string;
  targetId: string;
  remoteTargetId: string;
  remotePhotoId: string;
  actorId: string;
  state: string;
  phase: 'photo';
  ordinal: number;
  stepState: string;
  parentProvider: string;
  parentState: string;
  parentRemotePostId: string | null;
  parentPostId: string;
  parentPostTargetId: string;
  parentTargetId: string;
  parentActorId: string;
  providerId: string | null;
  projectedRemotePostId: string | null;
};

const operationError = (code: 'invalid_request' | 'not_found' | 'conflict' | 'unavailable' | 'forbidden', message: string) => new OperationError(code, message);
const inputSchema = z.object({
  actionId: z.enum(['record_photo_present', 'record_feed_present', 'record_step_absent', 'record_photo_deleted', 'record_photo_still_present']),
  subjectId: z.string().min(1).max(2048),
  confirmation: z.string().max(400),
  acknowledged: z.literal(true),
  fieldValues: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), z.union([z.string().max(2048), z.boolean()])).optional(),
}).strict();

function validRemoteId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw operationError('invalid_request', 'Enter the exact Facebook ID you externally verified.');
  }
}

async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const [timeout, maxWait] = await Promise.all([
    runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs'),
  ]);
  if (![timeout, maxWait].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)) {
    throw operationError('unavailable', 'Publishing transaction limits are unavailable.');
  }
  return prisma.$transaction(run, { timeout: timeout as number, maxWait: maxWait as number });
}

function bindingFromStep(row: StepCandidate): FacebookMediaResolutionBinding {
  return {
    workspaceId: row.workspaceId, operationId: row.operationId, mediaStepId: row.id,
    postId: row.postId, postTargetId: row.postTargetId, targetId: row.targetId, remoteTargetId: row.remoteTargetId,
    publicationActorId: row.actorId, phase: row.phase, ordinal: row.ordinal, source: 'operator', outcome: 'photo_absent',
  };
}

function assertParentBinding(row: {
  workspaceId: string; operationId: string; postId: string; postTargetId: string; targetId: string; actorId: string;
  parentProvider: string; parentState: string; parentRemotePostId: string | null; parentPostId: string;
  parentPostTargetId: string; parentTargetId: string; parentActorId: string; remoteTargetId: string; providerId: string | null;
  projectedRemotePostId: string | null;
}) {
  if (row.parentProvider !== 'facebook' || row.postId !== row.parentPostId || row.postTargetId !== row.parentPostTargetId ||
    row.targetId !== row.parentTargetId || row.actorId !== row.parentActorId || row.providerId !== row.remoteTargetId || row.projectedRemotePostId) {
    throw operationError('conflict', 'Facebook recovery evidence does not match its publication binding.');
  }
  if (!['started', 'uncertain'].includes(row.parentState) || row.parentRemotePostId) {
    throw operationError('conflict', 'This publication has a recorded result and cannot be manually resolved here.');
  }
}

async function loadStepCandidate(stepId: string): Promise<StepCandidate> {
  const rows = await prisma.$queryRaw<StepCandidate[]>`
    SELECT s.id, s."workspaceId", s."operationId", s."postId", s."postTargetId", s."targetId", s."actorId", s."remoteTargetId",
      s.phase, s.ordinal, s.state, s."remoteId", t."providerId", a.provider AS "parentProvider", a.state AS "parentState",
      a."remotePostId" AS "parentRemotePostId", a."postId" AS "parentPostId", a."postTargetId" AS "parentPostTargetId",
      a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId", pt."remotePostId" AS "projectedRemotePostId"
    FROM facebook_media_steps s
    JOIN publication_attempts a ON a.id=s."operationId" AND a."workspaceId"=s."workspaceId"
    LEFT JOIN targets t ON t.id=s."targetId" AND t."workspaceId"=s."workspaceId"
    LEFT JOIN post_targets pt ON pt.id=s."postTargetId" AND pt."postId"=s."postId"
    WHERE s.id=${stepId} AND s.phase IN ('photo','feed')
    LIMIT 1`;
  const row = rows[0];
  if (!row) throw operationError('not_found', 'This Facebook media step is unavailable.');
  assertParentBinding(row);
  return row;
}

async function loadDeletionCandidate(deletionId: string): Promise<DeletionCandidate> {
  const rows = await prisma.$queryRaw<DeletionCandidate[]>`
    SELECT d.id, d."mediaStepId", d."workspaceId", d."operationId", d."postId", d."postTargetId", d."targetId", d."remoteTargetId",
      d."remotePhotoId", d."actorId", d.state, s.phase, s.ordinal, s.state AS "stepState", t."providerId",
      a.provider AS "parentProvider", a.state AS "parentState", a."remotePostId" AS "parentRemotePostId",
      a."postId" AS "parentPostId", a."postTargetId" AS "parentPostTargetId", a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId",
      pt."remotePostId" AS "projectedRemotePostId"
    FROM facebook_media_deletions d
    JOIN facebook_media_steps s ON s.id=d."mediaStepId" AND s."workspaceId"=d."workspaceId"
    JOIN publication_attempts a ON a.id=d."operationId" AND a."workspaceId"=d."workspaceId"
    LEFT JOIN targets t ON t.id=d."targetId" AND t."workspaceId"=d."workspaceId"
    LEFT JOIN post_targets pt ON pt.id=d."postTargetId" AND pt."postId"=d."postId"
    WHERE d.id=${deletionId}
    LIMIT 1`;
  const row = rows[0];
  if (!row) throw operationError('not_found', 'This Facebook photo deletion is unavailable.');
  assertParentBinding({ ...row, postId: row.postId, postTargetId: row.postTargetId, targetId: row.targetId, actorId: row.parentActorId });
  if (row.phase !== 'photo' || row.mediaStepId === '' || row.remotePhotoId === '') throw operationError('conflict', 'This Facebook deletion evidence is invalid.');
  return row;
}

async function lockOperation(tx: Prisma.TransactionClient, candidate: StepCandidate | DeletionCandidate) {
  const parents = await tx.$queryRaw<Array<{ workspaceId: string; postId: string; postTargetId: string; targetId: string; actorId: string; parentProvider: string; parentState: string; parentRemotePostId: string | null; projectedRemotePostId: string | null }>>`
    SELECT a."workspaceId", a."postId", a."postTargetId", a."targetId", a."actorId", a.provider AS "parentProvider",
      a.state AS "parentState", a."remotePostId" AS "parentRemotePostId", pt."remotePostId" AS "projectedRemotePostId"
    FROM publication_attempts a LEFT JOIN post_targets pt ON pt.id=a."postTargetId" AND pt."postId"=a."postId"
    WHERE a.id=${candidate.operationId} AND a."workspaceId"=${candidate.workspaceId} FOR UPDATE OF a`;
  const parent = parents[0];
  if (!parent) throw operationError('conflict', 'Facebook recovery evidence no longer has a publication attempt.');
  const rawRows = await tx.$queryRaw<Array<Omit<StepCandidate, 'parentProvider' | 'parentState' | 'parentRemotePostId' | 'parentPostId' | 'parentPostTargetId' | 'parentTargetId' | 'parentActorId'>>>`
    SELECT s.id, s."workspaceId", s."operationId", s."postId", s."postTargetId", s."targetId", s."actorId", s."remoteTargetId",
      s.phase, s.ordinal, s.state, s."remoteId", t."providerId", pt."remotePostId" AS "projectedRemotePostId"
    FROM facebook_media_steps s
    LEFT JOIN targets t ON t.id=s."targetId" AND t."workspaceId"=s."workspaceId"
    LEFT JOIN post_targets pt ON pt.id=s."postTargetId" AND pt."postId"=s."postId"
    WHERE s."workspaceId"=${candidate.workspaceId} AND s."operationId"=${candidate.operationId}
    ORDER BY s.phase, s.ordinal, s.id FOR UPDATE OF s`;
  const rows: StepCandidate[] = rawRows.map(row => ({ ...row, parentProvider: parent.parentProvider, parentState: parent.parentState,
    parentRemotePostId: parent.parentRemotePostId, parentPostId: parent.postId, parentPostTargetId: parent.postTargetId,
    parentTargetId: parent.targetId, parentActorId: parent.actorId }));
  const corrupt = rows.some(row => row.workspaceId !== candidate.workspaceId || row.operationId !== candidate.operationId ||
    row.postId !== parent.postId || row.postTargetId !== parent.postTargetId || row.targetId !== parent.targetId ||
    row.actorId !== parent.actorId || row.remoteTargetId !== candidate.remoteTargetId || row.providerId !== candidate.remoteTargetId || row.projectedRemotePostId);
  if (corrupt) throw operationError('conflict', 'Facebook recovery evidence does not match its publication binding.');
  if (parent.projectedRemotePostId || !['started', 'uncertain'].includes(parent.parentState) || parent.parentRemotePostId) {
    throw operationError('conflict', 'This publication has a recorded result and cannot be manually resolved here.');
  }
  return { rows, parent };
}

async function audit(tx: Prisma.TransactionClient, userId: string, binding: FacebookMediaResolutionBinding) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt")
    VALUES (${randomUUID()}, ${userId}, ${`facebook.media_${binding.outcome}`},
      ${JSON.stringify({ workspaceId: binding.workspaceId, operationId: binding.operationId, mediaStepId: binding.mediaStepId,
        ...(binding.deletionId ? { deletionId: binding.deletionId } : {}), targetId: binding.targetId, phase: binding.phase,
        ordinal: binding.ordinal, source: binding.source, outcome: binding.outcome, ...(binding.remoteId ? { remoteId: binding.remoteId } : {}) })}::jsonb,
      CURRENT_TIMESTAMP)`;
}

/** Root-only, human-confirmed resolution of one Facebook photo/feed/deletion effect. */
export async function resolveFacebookMedia(userId: string, input: PlatformPublicationActionInput): Promise<PlatformPublicationActionResult> {
  await requireActiveRoot(userId);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw operationError('invalid_request', 'Enter one valid Facebook outcome and its exact confirmation.');
  const action = parsed.data;
  const attestationEnabled = await runtimeConfig('meta.manualMediaAttestationEnabled');
  if (attestationEnabled !== true) throw operationError('forbidden', 'Manual Facebook media outcome recording is disabled in Root configuration.');

  const deletionAction = action.actionId === 'record_photo_deleted' || action.actionId === 'record_photo_still_present';
  const candidate = deletionAction ? await loadDeletionCandidate(action.subjectId) : await loadStepCandidate(action.subjectId);
  const remoteIdValue = action.actionId === 'record_photo_present' || action.actionId === 'record_feed_present'
    ? action.fieldValues?.remoteId : undefined;
  if (action.actionId === 'record_photo_present' || action.actionId === 'record_feed_present') validRemoteId(remoteIdValue);
  const remoteId = typeof remoteIdValue === 'string' ? remoteIdValue : undefined;
  const expectedFieldKeys = remoteId === undefined ? [] : ['remoteId'];
  const providedFieldKeys = Object.keys(action.fieldValues ?? {}).sort();
  if (providedFieldKeys.join(',') !== expectedFieldKeys.join(',')) throw operationError('invalid_request', 'Supply only the required Facebook ID field for this outcome.');
  const exactConfirmation = action.actionId === 'record_photo_present' ? `ATTEST FACEBOOK PHOTO ${action.subjectId} PRESENT`
    : action.actionId === 'record_feed_present' ? `ATTEST FACEBOOK FEED ${action.subjectId} PRESENT`
      : action.actionId === 'record_step_absent' ? `ATTEST FACEBOOK STEP ${action.subjectId} ABSENT`
        : action.actionId === 'record_photo_deleted' ? `ATTEST FACEBOOK DELETE ${action.subjectId} DELETED`
          : `ATTEST FACEBOOK DELETE ${action.subjectId} STILL PRESENT`;
  if (action.confirmation !== exactConfirmation) throw operationError('invalid_request', 'Externally verify the outcome and enter its exact confirmation.');

  return withRootPublicationOperation(userId, { workspaceId: candidate.workspaceId, postId: candidate.postId, targetId: candidate.targetId }, async () => {
    await requireActiveRoot(userId);
    if (await runtimeConfig('meta.manualMediaAttestationEnabled') !== true) throw operationError('forbidden', 'Manual Facebook media outcome recording is disabled in Root configuration.');
    const binding = await transaction(async tx => {
      const { rows, parent } = await lockOperation(tx, candidate);
      let event: FacebookMediaResolutionBinding;
      if (deletionAction) {
        const locked = await tx.$queryRaw<DeletionCandidate[]>`
          SELECT d.id, d."mediaStepId", d."workspaceId", d."operationId", d."postId", d."postTargetId", d."targetId", d."remoteTargetId",
            d."remotePhotoId", d."actorId", d.state, s.phase, s.ordinal, s.state AS "stepState", s."remoteId" AS "stepRemoteId", t."providerId",
            a.provider AS "parentProvider", a.state AS "parentState", a."remotePostId" AS "parentRemotePostId",
            a."postId" AS "parentPostId", a."postTargetId" AS "parentPostTargetId", a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId"
          FROM facebook_media_deletions d
          JOIN facebook_media_steps s ON s.id=d."mediaStepId" AND s."workspaceId"=d."workspaceId"
          JOIN publication_attempts a ON a.id=d."operationId" AND a."workspaceId"=d."workspaceId"
          LEFT JOIN targets t ON t.id=d."targetId" AND t."workspaceId"=d."workspaceId"
          WHERE d.id=${action.subjectId} AND d."workspaceId"=${candidate.workspaceId} AND d."operationId"=${candidate.operationId}
          FOR UPDATE OF d`;
        const deletion = locked[0];
        const photo = deletion && rows.find(row => row.id === deletion.mediaStepId);
        if (!deletion || !photo || deletion.workspaceId !== photo.workspaceId || deletion.operationId !== photo.operationId ||
          deletion.postId !== photo.postId || deletion.postTargetId !== photo.postTargetId || deletion.targetId !== photo.targetId ||
          deletion.remoteTargetId !== photo.remoteTargetId || deletion.remotePhotoId !== photo.remoteId ||
          deletion.remotePhotoId !== (candidate as DeletionCandidate).remotePhotoId || !['started', 'uncertain'].includes(deletion.state)) {
          throw operationError('conflict', 'This Facebook deletion outcome changed; reload Root evidence.');
        }
        event = { ...bindingFromStep(rows.find(row => row.id === deletion.mediaStepId)!), deletionId: deletion.id, phase: 'delete',
          source: 'operator', outcome: action.actionId === 'record_photo_deleted' ? 'delete_deleted' : 'delete_present',
          eventActorId: userId, remoteId: null };
        const state = action.actionId === 'record_photo_deleted' ? 'attested_deleted' : 'attested_present';
        await tx.$executeRaw`UPDATE facebook_media_deletions SET state=${state}, "attestedAt"=CURRENT_TIMESTAMP,
          "attestedBy"=${userId}, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${deletion.id} AND state IN ('started','uncertain')`;
      } else {
        const step = rows.find(row => row.id === action.subjectId);
        if (!step || step.state !== 'started' && step.state !== 'uncertain') throw operationError('conflict', 'This Facebook step already has an outcome; reload Root evidence.');
        const isPhotoPresent = action.actionId === 'record_photo_present';
        const isFeedPresent = action.actionId === 'record_feed_present';
        if (isPhotoPresent && step.phase !== 'photo' || isFeedPresent && step.phase !== 'feed') throw operationError('conflict', 'This action does not match the Facebook step phase.');
        if (isFeedPresent) {
          const photos = rows.filter(row => row.phase === 'photo').sort((a, b) => a.ordinal - b.ordinal);
          if (photos.length < 2 || photos.some((photo, index) => photo.ordinal !== index + 1 ||
            !['recorded', 'attested_present'].includes(photo.state) || !photo.remoteId) ||
            new Set(photos.map(photo => photo.remoteId)).size !== photos.length) {
            throw operationError('conflict', 'Confirm every ordered photo ID before attesting the Facebook feed.');
          }
          const deletions = await tx.$queryRaw<Array<{ state: string }>>`
            SELECT state FROM facebook_media_deletions WHERE "workspaceId"=${step.workspaceId} AND "operationId"=${step.operationId} FOR UPDATE`;
          if (deletions.some(deletion => ['started', 'uncertain', 'confirmed', 'attested_deleted', 'conflict'].includes(deletion.state))) {
            throw operationError('conflict', 'A staged-photo deletion is active or confirmed; verify the photo set before attesting the feed.');
          }
        }
        if (isPhotoPresent || isFeedPresent) {
          const phase = isPhotoPresent ? 'photo' : 'feed';
          const duplicates = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM facebook_media_steps WHERE "workspaceId"=${step.workspaceId} AND "targetId"=${step.targetId}
              AND phase=${phase} AND "remoteId"=${remoteId} AND id<>${step.id} LIMIT 1 FOR UPDATE`;
          const historical = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM facebook_media_resolutions WHERE "workspaceId"=${step.workspaceId} AND "targetId"=${step.targetId}
              AND phase=${phase} AND "remoteId"=${remoteId} AND "mediaStepId"<>${step.id} LIMIT 1 FOR UPDATE`;
          if (duplicates.length || historical.length) throw operationError('conflict', 'This Facebook ID is already bound to another upload step.');
        }
        const present = isPhotoPresent || isFeedPresent;
        const outcome = isPhotoPresent ? 'photo_present' : isFeedPresent ? 'feed_present'
          : step.phase === 'photo' ? 'photo_absent' : 'feed_absent';
        event = { ...bindingFromStep(step), source: 'operator', outcome, eventActorId: userId, remoteId: present ? remoteId : null };
        await tx.$executeRaw`UPDATE facebook_media_steps SET state=${present ? 'attested_present' : 'attested_absent'},
          "remoteId"=${present ? remoteId! : null}, "receiptAt"=NULL, "rejectedAt"=NULL,
          "attestedAt"=CURRENT_TIMESTAMP, "attestedBy"=${userId}, "updatedAt"=CURRENT_TIMESTAMP
          WHERE id=${step.id} AND "workspaceId"=${step.workspaceId} AND state IN ('started','uncertain')`;
      }
      if (parent.parentState === 'started') {
        const frozen = await tx.$executeRaw`UPDATE publication_attempts SET state='uncertain', reason='outcome_unknown', "updatedAt"=CURRENT_TIMESTAMP
          WHERE id=${candidate.operationId} AND "workspaceId"=${candidate.workspaceId} AND state='started'`;
        if (frozen !== 1) throw operationError('conflict', 'The Facebook publication changed before its outcome could be recorded.');
      }
      await appendFacebookMediaResolution(tx, event);
      await audit(tx, userId, event);
      return event;
    });
    return { ok: true, actionId: action.actionId, subjectId: action.subjectId, operationId: binding.operationId,
      state: 'attested', message: `The Facebook ${binding.phase} outcome was recorded as an operator attestation. Check for delayed platform effects before any new publication or deletion.` };
  });
}
