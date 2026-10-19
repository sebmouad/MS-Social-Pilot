import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import type { FacebookMediaJournal, FacebookMediaJournalFactory } from './media-journal-port';
import { appendFacebookMediaResolution } from './media-resolution-store';

type ParentOperation = {
  workspaceId: string;
  postId: string;
  postTargetId: string;
  targetId: string;
  actorId: string;
  providerId: string;
};

type MediaStep = {
  id: string;
  workspaceId: string;
  operationId: string;
  postId: string;
  postTargetId: string;
  targetId: string;
  actorId: string;
  remoteTargetId: string;
  phase: 'photo' | 'feed';
  ordinal: number;
  state: 'started' | 'recorded' | 'rejected' | 'uncertain' | 'attested_present' | 'attested_absent' | 'conflict';
  remoteId: string | null;
  receiptAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  cleanupState?: string | null;
  cleanupId?: string | null;
  feedState?: string | null;
  parentState?: string;
  projectedRemotePostId?: string | null;
  attestedAt?: Date | null;
  attestedBy?: string | null;
};

const conflict = (message = 'This Facebook publication step is already recorded or needs review.') =>
  new OperationError('conflict', message);
const unavailable = (message: string) => new OperationError('unavailable', message);

function safeLimit(value: unknown, label: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw unavailable(`The Facebook ${label} limit is unavailable.`);
  }
  return value;
}

function validRemoteId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OperationError('invalid_request', 'Facebook returned an invalid media receipt.');
  }
}

function validOrdinal(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook photo position.');
  }
}

function actionContext(row: MediaStep, remotePhotoId?: string) {
  const context = [
    { label: 'Workspace ID', value: row.workspaceId },
    { label: 'Target ID', value: row.targetId },
    { label: 'Facebook Page ID', value: row.remoteTargetId },
    { label: 'Publication operation ID', value: row.operationId },
  ];
  if (remotePhotoId) context.push({ label: 'Facebook photo ID', value: remotePhotoId });
  return context;
}

async function assertParentStarted(
  tx: Prisma.TransactionClient,
  operationId: string,
  remoteTargetId: string,
): Promise<ParentOperation> {
  const rows = await tx.$queryRaw<ParentOperation[]>`
    SELECT a."workspaceId", a."postId", a."postTargetId", a."targetId", a."actorId", t."providerId"
    FROM rebuild_publication_attempts a
    JOIN targets t ON t.id = a."targetId" AND t."workspaceId" = a."workspaceId"
    WHERE a.id = ${operationId} AND a.provider = 'facebook' AND a.state = 'started'
      AND t."providerId" = ${remoteTargetId}
    FOR UPDATE OF a`;
  const parent = rows[0];
  if (!parent || parent.providerId !== remoteTargetId) {
    throw conflict('This Facebook publication is no longer active for the selected Page.');
  }
  return parent;
}

async function loadPhotoSteps(tx: Prisma.TransactionClient, workspaceId: string, operationId: string) {
  return tx.$queryRaw<MediaStep[]>`
    SELECT * FROM rebuild_facebook_media_steps
    WHERE "workspaceId" = ${workspaceId} AND "operationId" = ${operationId} AND "phase" = 'photo'
    ORDER BY "ordinal" ASC FOR UPDATE`;
}

async function insertStartedStep(
  tx: Prisma.TransactionClient,
  operationId: string,
  remoteTargetId: string,
  phase: 'photo' | 'feed',
  ordinal: number,
) {
  const parent = await assertParentStarted(tx, operationId, remoteTargetId);
  const duplicate = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM rebuild_facebook_media_steps
    WHERE "operationId" = ${operationId} AND "phase" = ${phase} AND "ordinal" = ${ordinal}
    FOR UPDATE`;
  if (duplicate.length) throw conflict('This Facebook upload step already has an intent; do not send it again.');

  if (phase === 'photo') {
    const feeds = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rebuild_facebook_media_steps
      WHERE "operationId" = ${operationId} AND "phase" = 'feed' LIMIT 1 FOR UPDATE`;
    if (feeds.length) throw conflict('A Facebook feed step already exists; no more photos can be uploaded.');
    const photos = await loadPhotoSteps(tx, parent.workspaceId, operationId);
    if (photos.length !== ordinal - 1 || photos.some((photo, index) => photo.ordinal !== index + 1 || photo.state !== 'recorded' || !photo.remoteId)) {
      throw conflict('A previous Facebook photo upload is unresolved; review it before continuing.');
    }
  }

  await tx.$executeRaw`
    INSERT INTO rebuild_facebook_media_steps
      (id, "workspaceId", "operationId", "postId", "postTargetId", "targetId", "actorId", "remoteTargetId", "phase", "ordinal", "state")
    VALUES
      (${randomUUID()}, ${parent.workspaceId}, ${operationId}, ${parent.postId}, ${parent.postTargetId}, ${parent.targetId}, ${parent.actorId}, ${remoteTargetId}, ${phase}, ${ordinal}, 'started')`;
}

async function transitionStartedStep(
  tx: Prisma.TransactionClient,
  operationId: string,
  remoteTargetId: string,
  phase: 'photo' | 'feed',
  ordinal: number,
  state: 'recorded' | 'rejected',
  remoteId?: string,
) {
  const parents = await tx.$queryRaw<Array<ParentOperation & { state: string; remotePostId: string | null }>>`
    SELECT a."workspaceId", a."postId", a."postTargetId", a."targetId", a."actorId", t."providerId", a.state, a."remotePostId"
    FROM rebuild_publication_attempts a JOIN targets t ON t.id=a."targetId" AND t."workspaceId"=a."workspaceId"
    WHERE a.id=${operationId} AND a.provider='facebook' AND t."providerId"=${remoteTargetId} FOR UPDATE OF a`;
  const parent = parents[0];
  if (!parent) throw conflict('This Facebook publication is unavailable for an upload result.');
  const allSteps = await tx.$queryRaw<Array<{ id: string; workspaceId: string; operationId: string; postId: string; postTargetId: string; targetId: string; actorId: string; remoteTargetId: string }>>`
    SELECT id, "workspaceId", "operationId", "postId", "postTargetId", "targetId", "actorId", "remoteTargetId"
    FROM rebuild_facebook_media_steps WHERE "workspaceId"=${parent.workspaceId} AND "operationId"=${operationId} FOR UPDATE`;
  if (allSteps.some(row => row.postId !== parent.postId || row.postTargetId !== parent.postTargetId || row.targetId !== parent.targetId ||
    row.actorId !== parent.actorId || row.remoteTargetId !== remoteTargetId)) throw conflict('Facebook media rows no longer match the publication binding.');
  const existing = await tx.$queryRaw<MediaStep[]>`
    SELECT * FROM rebuild_facebook_media_steps
    WHERE "workspaceId" = ${parent.workspaceId} AND "operationId" = ${operationId}
      AND "phase" = ${phase} AND "ordinal" = ${ordinal}
    FOR UPDATE`;
  if (existing.length !== 1) throw conflict('This Facebook upload step is missing; do not resend it.');
  if (existing[0].remoteTargetId !== remoteTargetId || existing[0].postId !== parent.postId || existing[0].postTargetId !== parent.postTargetId ||
    existing[0].targetId !== parent.targetId || existing[0].actorId !== parent.actorId) throw conflict('This Facebook upload receipt no longer matches the publication binding.');
  if (state === 'recorded') validRemoteId(remoteId);
  if (state === 'recorded') {
    const duplicateReceipt = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rebuild_facebook_media_steps
      WHERE "workspaceId" = ${parent.workspaceId} AND "targetId" = ${parent.targetId}
      AND "phase" = ${phase} AND "remoteId" = ${remoteId} AND id <> ${existing[0].id}
      LIMIT 1 FOR UPDATE`;
    if (duplicateReceipt.length) throw conflict('Facebook returned an ID already recorded for this Page and upload phase.');
  }
  const step = existing[0];
  const late = parent.state !== 'started' || step.state !== 'started';
  const appendProviderEvent = () => appendFacebookMediaResolution(tx, { workspaceId: step.workspaceId, operationId, mediaStepId: step.id,
    postId: step.postId, postTargetId: step.postTargetId, targetId: step.targetId, remoteTargetId: step.remoteTargetId,
    publicationActorId: step.actorId, phase, ordinal, source: 'provider', outcome: state === 'recorded' ? 'late_provider_receipt' : 'late_provider_rejection',
    remoteId: state === 'recorded' ? remoteId : null });
  if (late) await appendProviderEvent();
  if (step.state !== 'started') {
    const attested = step.state === 'attested_present' && state === 'recorded' && step.remoteId === remoteId ||
      step.state === 'attested_absent' && state === 'rejected';
    const sameProvider = step.state === state && (state === 'rejected' || step.remoteId === remoteId);
    if (attested || sameProvider || step.state === 'conflict') return;
    if (step.state === 'uncertain') {
      const parentConfirmsResult = state === 'rejected' && ['attested_absent', 'rejected'].includes(parent.state) ||
        state === 'recorded' && phase === 'feed' && parent.remotePostId === remoteId && ['receipt_recorded', 'projected'].includes(parent.state);
      if (!['started', 'uncertain'].includes(parent.state) && !parentConfirmsResult) {
        await tx.$executeRaw`UPDATE rebuild_facebook_media_steps SET state='conflict', "remoteId"=NULL, "receiptAt"=NULL, "rejectedAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${step.id}`;
        return;
      }
      await tx.$executeRaw`UPDATE rebuild_facebook_media_steps SET state=${state}, "remoteId"=${state === 'recorded' ? remoteId! : null},
        "receiptAt"=CASE WHEN ${state === 'recorded'} THEN CURRENT_TIMESTAMP ELSE NULL END,
        "rejectedAt"=CASE WHEN ${state === 'rejected'} THEN CURRENT_TIMESTAMP ELSE NULL END, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${step.id}`;
      return;
    }
    await tx.$executeRaw`UPDATE rebuild_facebook_media_steps SET state='conflict',
      "remoteId"=CASE WHEN "receiptAt" IS NOT NULL THEN "remoteId" ELSE NULL END,
      "receiptAt"=CASE WHEN "receiptAt" IS NOT NULL THEN "receiptAt" ELSE NULL END,
      "rejectedAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${step.id}`;
    return;
  }
  if (!['started', 'uncertain'].includes(parent.state)) {
    const parentMatches = state === 'rejected' && ['attested_absent', 'rejected'].includes(parent.state) ||
      state === 'recorded' && phase === 'feed' && parent.remotePostId === remoteId && ['receipt_recorded', 'projected'].includes(parent.state);
    if (parentMatches) {
      await tx.$executeRaw`UPDATE rebuild_facebook_media_steps SET state=${state}, "remoteId"=${state === 'recorded' ? remoteId! : null},
        "receiptAt"=CASE WHEN ${state === 'recorded'} THEN CURRENT_TIMESTAMP ELSE NULL END,
        "rejectedAt"=CASE WHEN ${state === 'rejected'} THEN CURRENT_TIMESTAMP ELSE NULL END, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${step.id} AND state='started'`;
    } else {
      await tx.$executeRaw`UPDATE rebuild_facebook_media_steps SET state='conflict', "remoteId"=NULL, "receiptAt"=NULL,
        "rejectedAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${step.id} AND state='started'`;
    }
    return;
  }
  const changed = await tx.$executeRaw`
    UPDATE rebuild_facebook_media_steps
    SET "state" = ${state}, "remoteId" = ${state === 'recorded' ? remoteId! : null},
        "receiptAt" = CASE WHEN ${state === 'recorded'} THEN CURRENT_TIMESTAMP ELSE NULL END,
        "rejectedAt" = CASE WHEN ${state === 'rejected'} THEN CURRENT_TIMESTAMP ELSE NULL END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "workspaceId" = ${parent.workspaceId} AND "operationId" = ${operationId}
      AND "phase" = ${phase} AND "ordinal" = ${ordinal} AND "state" = 'started'`;
  if (changed !== 1) throw conflict('This Facebook upload step changed; review its status before continuing.');
  if (late && parent.state === 'uncertain') return;
}

async function createStepTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const [timeout, maxWait] = await Promise.all([
    runtimeConfig('publishing.transactionTimeoutMs'),
    runtimeConfig('publishing.transactionMaxWaitMs'),
  ]);
  return prisma.$transaction(work, {
    timeout: safeLimit(timeout, 'transaction timeout'),
    maxWait: safeLimit(maxWait, 'transaction wait'),
  });
}

/** Facebook-owned durable sub-operations for one Publishing attempt and Page. */
export const facebookMediaJournal: FacebookMediaJournalFactory = (operationId, remoteTargetId): FacebookMediaJournal => {
  if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 2048 || /[\u0000-\u001f\u007f]/.test(operationId)) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook publication operation.');
  }
  validRemoteId(remoteTargetId);

  return {
    async beginPhoto(ordinal) {
      validOrdinal(ordinal);
      const cap = safeLimit(await runtimeConfig('publishing.maxRemoteMediaPerPost'), 'media count', 0);
      if (ordinal > cap) throw new OperationError('invalid_request', 'This post exceeds the configured Facebook media limit.');
      await createStepTransaction(tx => insertStartedStep(tx, operationId, remoteTargetId, 'photo', ordinal));
    },
    async recordPhoto(ordinal, remoteId) {
      validOrdinal(ordinal); validRemoteId(remoteId);
      await createStepTransaction(tx => transitionStartedStep(tx, operationId, remoteTargetId, 'photo', ordinal, 'recorded', remoteId));
    },
    async rejectPhoto(ordinal) {
      validOrdinal(ordinal);
      await createStepTransaction(tx => transitionStartedStep(tx, operationId, remoteTargetId, 'photo', ordinal, 'rejected'));
    },
    async beginFeed(photoIds) {
      if (!Array.isArray(photoIds) || photoIds.length < 2) throw new OperationError('invalid_request', 'A Facebook feed upload needs multiple confirmed photos.');
      photoIds.forEach(validRemoteId);
      const cap = safeLimit(await runtimeConfig('publishing.maxRemoteMediaPerPost'), 'media count', 0);
      if (photoIds.length > cap) throw new OperationError('invalid_request', 'This post exceeds the configured Facebook media limit.');
      await createStepTransaction(async tx => {
        const parent = await assertParentStarted(tx, operationId, remoteTargetId);
        const photos = await loadPhotoSteps(tx, parent.workspaceId, operationId);
        const exact = photos.length === photoIds.length && photos.every((photo, index) =>
          photo.ordinal === index + 1 && photo.state === 'recorded' && photo.remoteId === photoIds[index]);
        if (!exact) throw conflict('The confirmed Facebook photo receipts do not match this feed request.');
        await insertStartedStep(tx, operationId, remoteTargetId, 'feed', 0);
      });
    },
    async recordFeed(remoteId) {
      validRemoteId(remoteId);
      await createStepTransaction(tx => transitionStartedStep(tx, operationId, remoteTargetId, 'feed', 0, 'recorded', remoteId));
    },
    async rejectFeed() {
      await createStepTransaction(tx => transitionStartedStep(tx, operationId, remoteTargetId, 'feed', 0, 'rejected'));
    },
  };
};

/** Safe Root evidence. Callers must recheck active installation-owner authority. */
export async function readFacebookMediaEvidence(operationId?: string, resultCap?: number) {
  if (operationId !== undefined && (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 2048 || /[\u0000-\u001f\u007f]/.test(operationId))) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook publication operation.');
  }
  if (resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) {
    throw new OperationError('invalid_request', 'Choose a valid Facebook media history limit.');
  }
  const configuredLimit = safeLimit(await runtimeConfig('meta.mediaHistoryLimit'), 'media history');
  const cleanupEnabled = await runtimeConfig('meta.manualMediaCleanupEnabled');
  if (typeof cleanupEnabled !== 'boolean') throw unavailable('The Facebook manual cleanup policy is unavailable.');
  const attestationEnabled = await runtimeConfig('meta.manualMediaAttestationEnabled');
  if (typeof attestationEnabled !== 'boolean') throw unavailable('The Facebook manual attestation policy is unavailable.');
  const limit = Math.min(configuredLimit, resultCap ?? configuredLimit);
  const rows = operationId === undefined
    ? await prisma.$queryRaw<MediaStep[]>`
      SELECT s.id, s."operationId", s."workspaceId", s."postId", s."targetId", s."remoteTargetId", s."phase", s."ordinal", s."state", s."remoteId", s."createdAt", s."updatedAt", s."attestedAt", s."attestedBy",
        d.state AS "cleanupState", d.id AS "cleanupId", f.state AS "feedState", a.state AS "parentState", pt."remotePostId" AS "projectedRemotePostId"
      FROM rebuild_facebook_media_steps s
      LEFT JOIN LATERAL (SELECT id, state FROM rebuild_facebook_media_deletions WHERE "workspaceId"=s."workspaceId" AND "mediaStepId"=s.id ORDER BY "createdAt" DESC, id DESC LIMIT 1) d ON true
      LEFT JOIN rebuild_facebook_media_steps f ON f."workspaceId"=s."workspaceId" AND f."operationId"=s."operationId" AND f.phase='feed'
      LEFT JOIN rebuild_publication_attempts a ON a.id=s."operationId" AND a."workspaceId"=s."workspaceId"
      LEFT JOIN post_targets pt ON pt.id=s."postTargetId" AND pt."postId"=s."postId"
      ORDER BY s."updatedAt" DESC, s.id DESC LIMIT ${limit + 1}`
    : await prisma.$queryRaw<MediaStep[]>`
      SELECT s.id, s."operationId", s."workspaceId", s."postId", s."targetId", s."remoteTargetId", s."phase", s."ordinal", s."state", s."remoteId", s."createdAt", s."updatedAt", s."attestedAt", s."attestedBy",
        d.state AS "cleanupState", d.id AS "cleanupId", f.state AS "feedState", a.state AS "parentState", pt."remotePostId" AS "projectedRemotePostId"
      FROM rebuild_facebook_media_steps s
      LEFT JOIN LATERAL (SELECT id, state FROM rebuild_facebook_media_deletions WHERE "workspaceId"=s."workspaceId" AND "mediaStepId"=s.id ORDER BY "createdAt" DESC, id DESC LIMIT 1) d ON true
      LEFT JOIN rebuild_facebook_media_steps f ON f."workspaceId"=s."workspaceId" AND f."operationId"=s."operationId" AND f.phase='feed'
      LEFT JOIN rebuild_publication_attempts a ON a.id=s."operationId" AND a."workspaceId"=s."workspaceId"
      LEFT JOIN post_targets pt ON pt.id=s."postTargetId" AND pt."postId"=s."postId"
      WHERE s."operationId" = ${operationId}
      ORDER BY s."ordinal" ASC, s."phase" ASC LIMIT ${limit + 1}`;
  const stepItems = rows.slice(0, limit).map(row => ({
    recordType: 'step',
    id: row.id,
    operationId: row.operationId,
    workspaceId: row.workspaceId,
    postId: row.postId,
    targetId: row.targetId,
    remoteTargetId: row.remoteTargetId,
    phase: row.phase,
    ordinal: row.ordinal,
    state: row.state,
    cleanupState: row.cleanupState ?? null,
    cleanupId: row.cleanupId ?? null,
    remoteId: row.remoteId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attestedAt: row.attestedAt?.toISOString() ?? null,
    attestedBy: row.attestedBy ?? null,
    source: null,
    actorId: null,
  }));
  const cleanupActions = cleanupEnabled ? rows.slice(0, limit).filter(row => row.phase === 'photo' && ['recorded', 'attested_present'].includes(row.state) && row.remoteId &&
    (row.cleanupState == null || ['rejected', 'attested_present'].includes(row.cleanupState)) && (row.feedState == null || row.feedState === 'rejected') &&
    ['started', 'uncertain', 'attested_absent', 'rejected'].includes(row.parentState ?? '') && !row.projectedRemotePostId).map(row => ({
      rowId: row.id,
      actionId: 'delete_staged_photo',
      subjectId: row.id,
      label: `Delete staged photo ${row.ordinal}`,
      description: 'Delete the known staged Facebook photo shown in this row. Verify it is unused and accept that another administrator may publish it while deletion is in flight.',
      acknowledgmentLabel: 'I verified this photo is unused and accept that Facebook state may change while deletion is in flight.',
      confirmation: `DELETE STAGED PHOTO ${row.id}`,
      context: actionContext(row, row.remoteId!),
    })) : [];
  const attestationActions = attestationEnabled ? rows.slice(0, limit).flatMap(row => {
    const parentOpen = ['started', 'uncertain'].includes(row.parentState ?? '') && !row.projectedRemotePostId;
    if (!parentOpen) return [];
    const humanAck = 'I checked Facebook directly and accept that a delayed request may still change its state.';
    const photoField = { key: 'remoteId', label: 'Verified Facebook photo ID', kind: 'text' as const, required: true, maxLength: 2048,
      description: 'Enter the exact ID visible in Facebook after checking the Page.' };
    const feedField = { ...photoField, label: 'Verified Facebook feed post ID', description: 'Enter the exact post ID visible on the Page.' };
    const mk = (actionId: string, label: string, description: string, confirmation: string, fields?: Array<{key:string;label:string;kind:'text';required:boolean;maxLength:number;description:string}>) => ({
      rowId: row.id, actionId, subjectId: row.id, label, description, acknowledgmentLabel: humanAck, confirmation,
      context: actionContext(row, row.phase === 'photo' ? row.remoteId ?? undefined : undefined), ...(fields ? { fields } : {}),
    });
    const out = [];
    if (row.state === 'started' || row.state === 'uncertain') {
      if (row.phase === 'photo') {
        out.push(mk('record_photo_present', `Record photo ${row.ordinal} present`, 'Record an externally verified photo upload result. This remains a human report, not a Facebook receipt.', `ATTEST FACEBOOK PHOTO ${row.id} PRESENT`, [photoField]));
        out.push(mk('record_step_absent', `Record photo ${row.ordinal} absent`, 'Record an externally verified absence after checking Facebook for delayed effects.', `ATTEST FACEBOOK STEP ${row.id} ABSENT`));
      } else if (row.phase === 'feed') {
        out.push(mk('record_feed_present', 'Record feed post present', 'Record an externally verified post result after checking the Page and all ordered photos.', `ATTEST FACEBOOK FEED ${row.id} PRESENT`, [feedField]));
        out.push(mk('record_step_absent', 'Record feed post absent', 'Record an externally verified absence after checking Facebook for delayed effects.', `ATTEST FACEBOOK STEP ${row.id} ABSENT`));
      }
    }
    if (row.phase === 'photo' && row.remoteId && row.cleanupId && ['started', 'uncertain'].includes(row.cleanupState ?? '')) {
      out.push({ rowId: row.id, actionId: 'record_photo_deleted', subjectId: row.cleanupId, label: `Record photo ${row.ordinal} deletion`,
        description: 'Record an externally verified deletion result. This remains a human report; a delayed Facebook response may still arrive.',
        acknowledgmentLabel: humanAck, confirmation: `ATTEST FACEBOOK DELETE ${row.cleanupId} DELETED`, context: actionContext(row, row.remoteId) });
      out.push({ rowId: row.id, actionId: 'record_photo_still_present', subjectId: row.cleanupId, label: `Record photo ${row.ordinal} still present`,
        description: 'Record that Facebook still shows this photo after checking for delayed deletion effects.',
        acknowledgmentLabel: humanAck, confirmation: `ATTEST FACEBOOK DELETE ${row.cleanupId} STILL PRESENT`, context: actionContext(row, row.remoteId) });
    }
    return out;
  }) : [];
  const eventRows = operationId === undefined
    ? await prisma.$queryRaw<Array<{ id: string; operationId: string; workspaceId: string; postId: string; targetId: string; phase: string; ordinal: number; source: string; outcome: string; remoteId: string | null; deletionId: string | null; eventActorId: string | null; publicationActorId: string; createdAt: Date }>>`
      SELECT id, "operationId", "workspaceId", "postId", "targetId", phase, ordinal, source, outcome, "remoteId", "deletionId", "eventActorId", "publicationActorId", "createdAt"
      FROM rebuild_facebook_media_resolutions ORDER BY "createdAt" DESC, id DESC LIMIT ${limit + 1}`
    : await prisma.$queryRaw<Array<{ id: string; operationId: string; workspaceId: string; postId: string; targetId: string; phase: string; ordinal: number; source: string; outcome: string; remoteId: string | null; deletionId: string | null; eventActorId: string | null; publicationActorId: string; createdAt: Date }>>`
      SELECT id, "operationId", "workspaceId", "postId", "targetId", phase, ordinal, source, outcome, "remoteId", "deletionId", "eventActorId", "publicationActorId", "createdAt"
      FROM rebuild_facebook_media_resolutions WHERE "operationId"=${operationId} ORDER BY "createdAt" DESC, id DESC LIMIT ${limit + 1}`;
  const eventItems = eventRows.slice(0, limit).map(event => ({
    recordType: 'event', id: event.id, operationId: event.operationId, workspaceId: event.workspaceId, postId: event.postId,
    targetId: event.targetId, phase: event.phase, ordinal: event.ordinal, state: event.outcome, source: event.source,
    remoteId: event.remoteId, cleanupId: event.deletionId, attestedAt: null, attestedBy: null, actorId: event.eventActorId,
    publicationActorId: event.publicationActorId, createdAt: event.createdAt.toISOString(), updatedAt: event.createdAt.toISOString(),
  }));
  const combined = [...stepItems, ...eventItems].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const items = combined.slice(0, limit);
  const visibleStepIds = new Set(items.filter(item => item.recordType === 'step').map(item => item.id));
  const actions = [...cleanupActions, ...attestationActions].filter(action => visibleStepIds.has(action.rowId));
  return {
    title: 'Facebook media upload recovery',
    description: 'Durable photo and feed upload intents and receipts. Started steps are held for review and are never sent again automatically.',
    columns: [
      { key: 'id', label: 'Evidence row' },
      { key: 'operationId', label: 'Publication operation' },
      { key: 'workspaceId', label: 'Workspace' },
      { key: 'postId', label: 'Local post' },
      { key: 'targetId', label: 'Destination' },
      { key: 'remoteTargetId', label: 'Facebook Page ID' },
      { key: 'phase', label: 'Step' },
      { key: 'ordinal', label: 'Photo position' },
      { key: 'state', label: 'State' },
      { key: 'recordType', label: 'Record type' },
      { key: 'source', label: 'Resolution source' },
      { key: 'actorId', label: 'Operator' },
      { key: 'publicationActorId', label: 'Publication actor' },
      { key: 'cleanupState', label: 'Cleanup state' },
      { key: 'cleanupId', label: 'Deletion record' },
      { key: 'remoteId', label: 'Remote media ID' },
      { key: 'createdAt', label: 'Started (UTC)' },
      { key: 'updatedAt', label: 'Updated (UTC)' },
      { key: 'attestedAt', label: 'Attested (UTC)' },
      { key: 'attestedBy', label: 'Attested by' },
    ],
    items,
    truncated: rows.length > limit || eventRows.length > limit || combined.length > limit,
    rowIdKey: 'id',
    actions,
  };
}

/** Require publication receipts to agree with durable Facebook multi-photo evidence. */
export async function assertFacebookMediaResolution(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  operationId: string,
  outcome: 'PUBLISHED' | 'ABSENT',
  remotePostId?: string,
): Promise<void> {
  const parents = await tx.$queryRaw<Array<{ id: string; postTargetId: string; postId: string; projectedRemotePostId: string | null }>>`
    SELECT a.id, a."postTargetId", a."postId", pt."remotePostId" AS "projectedRemotePostId"
    FROM rebuild_publication_attempts a
    LEFT JOIN post_targets pt ON pt.id=a."postTargetId" AND pt."postId"=a."postId"
    WHERE a.id = ${operationId} AND a."workspaceId" = ${workspaceId} AND a.provider = 'facebook'
      AND (a.state IN ('started', 'uncertain') OR
        (${outcome} = 'PUBLISHED' AND a.state IN ('submitted', 'receipt_recorded', 'projected') AND a."remotePostId" = ${remotePostId ?? null}))
    FOR UPDATE OF a`;
  const parent = parents[0];
  if (!parent) throw conflict('This Facebook publication operation is unavailable in the current workspace.');
  if (outcome === 'ABSENT' && parent.projectedRemotePostId || outcome === 'PUBLISHED' && parent.projectedRemotePostId && parent.projectedRemotePostId !== remotePostId) {
    throw conflict('The saved publishing result conflicts with the existing post projection. Review the destination before recording an outcome.');
  }
  const rows = await tx.$queryRaw<MediaStep[]>`
    SELECT * FROM rebuild_facebook_media_steps
    WHERE "workspaceId" = ${workspaceId} AND "operationId" = ${operationId}
    ORDER BY "phase" ASC, "ordinal" ASC FOR UPDATE`;
  if (!rows.length) return;

  const photos = rows.filter(row => row.phase === 'photo').sort((a, b) => a.ordinal - b.ordinal);
  const feed = rows.find(row => row.phase === 'feed');
  if (outcome === 'PUBLISHED') {
    if (!feed || !['recorded', 'attested_present'].includes(feed.state) || !feed.remoteId || feed.remoteId !== remotePostId) {
      throw conflict('The saved publishing result does not match this post. Check its platform status before recording the outcome.');
    }
    if (photos.length < 2 || photos.some((photo, index) => photo.ordinal !== index + 1 || !['recorded', 'attested_present'].includes(photo.state) || !photo.remoteId) || new Set(photos.map(photo => photo.remoteId)).size !== photos.length) {
      throw conflict('An image upload still needs review. Check the platform and contact your workspace administrator before recording the outcome.');
    }
    const deletions = await tx.$queryRaw<Array<{ state: string }>>`
      SELECT state FROM rebuild_facebook_media_deletions WHERE "workspaceId"=${workspaceId} AND "operationId"=${operationId} FOR UPDATE`;
    if (deletions.some(deletion => ['started', 'uncertain', 'confirmed', 'attested_deleted', 'conflict'].includes(deletion.state))) {
      throw conflict('A staged-photo deletion is active or confirmed. Review its result before recording this post as published.');
    }
    return;
  }

  if (feed && !['rejected', 'attested_absent'].includes(feed.state) || photos.some(photo => ['started', 'uncertain', 'conflict'].includes(photo.state))) {
    throw conflict('Uploaded media still needs review before confirming this post was not published. Check the platform and contact your workspace administrator.');
  }
  const deletions = await tx.$queryRaw<Array<{ mediaStepId: string; state: string }>>`
    SELECT "mediaStepId", state FROM rebuild_facebook_media_deletions
    WHERE "workspaceId" = ${workspaceId} AND "operationId" = ${operationId} FOR UPDATE`;
  if (deletions.some(row => ['started', 'uncertain', 'conflict'].includes(row.state))) {
    throw conflict('A Facebook staged-photo cleanup is unresolved.');
  }
  const confirmed = new Set(deletions.filter(row => ['confirmed', 'attested_deleted'].includes(row.state)).map(row => row.mediaStepId));
  if (photos.some(photo => ['recorded', 'attested_present'].includes(photo.state) && !confirmed.has(photo.id))) {
    throw conflict('A known staged Facebook photo has not been confirmed deleted.');
  }
}

/** Hold workspace or connection cleanup while a Facebook upload step may still exist remotely. */
export async function assertFacebookMediaSettled(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  targetIds?: readonly string[],
): Promise<void> {
  if (targetIds?.length === 0) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT step.id FROM rebuild_facebook_media_steps step
    WHERE step."workspaceId" = ${workspaceId}
      AND (${targetIds === undefined} OR step."targetId" = ANY(${[...(targetIds ?? [])]}::text[]))
      AND (
        step."state" IN ('started', 'uncertain', 'conflict') OR
        (step."phase" = 'photo' AND step."state" IN ('recorded','attested_present') AND NOT EXISTS (
          SELECT 1 FROM rebuild_facebook_media_steps feed
          WHERE feed."workspaceId" = step."workspaceId" AND feed."operationId" = step."operationId"
            AND feed."phase" = 'feed' AND feed."state" IN ('recorded','attested_present')
        ) AND NOT EXISTS (
          SELECT 1 FROM rebuild_facebook_media_deletions deletion
          WHERE deletion."workspaceId" = step."workspaceId" AND deletion."mediaStepId" = step.id
            AND deletion.state IN ('confirmed','attested_deleted')
        ))
      )
    LIMIT 1`;
  if (rows.length) throw conflict('A Facebook media upload needs review before this destination or workspace data can be removed.');
  const deletions = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM rebuild_facebook_media_deletions
    WHERE "workspaceId" = ${workspaceId} AND state IN ('started', 'uncertain', 'conflict')
      AND (${targetIds === undefined} OR "targetId" = ANY(${[...(targetIds ?? [])]}::text[]))
    LIMIT 1`;
  if (deletions.length) throw conflict('A Facebook staged-photo cleanup needs review before this destination or workspace data can be removed.');
}
