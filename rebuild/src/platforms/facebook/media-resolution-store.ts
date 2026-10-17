import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/client';

export type FacebookMediaResolutionSource = 'operator' | 'provider';
export type FacebookMediaResolutionOutcome =
  | 'photo_present' | 'photo_absent' | 'feed_present' | 'feed_absent'
  | 'delete_deleted' | 'delete_present'
  | 'late_provider_receipt' | 'late_provider_rejection' | 'late_provider_uncertain';

export type FacebookMediaResolutionBinding = {
  workspaceId: string;
  operationId: string;
  mediaStepId: string;
  deletionId?: string | null;
  postId: string;
  postTargetId: string;
  targetId: string;
  remoteTargetId: string;
  publicationActorId: string;
  eventActorId?: string | null;
  phase: 'photo' | 'feed' | 'delete';
  ordinal: number;
  source: FacebookMediaResolutionSource;
  outcome: FacebookMediaResolutionOutcome;
  remoteId?: string | null;
};

/** Append one content-free resolution fact. The table is deliberately immutable. */
export async function appendFacebookMediaResolution(tx: Prisma.TransactionClient, event: FacebookMediaResolutionBinding) {
  await tx.$executeRaw`INSERT INTO rebuild_facebook_media_resolutions
    (id, "workspaceId", "operationId", "mediaStepId", "deletionId", "postId", "postTargetId", "targetId", "remoteTargetId",
     "publicationActorId", "eventActorId", phase, ordinal, source, outcome, "remoteId")
    VALUES (${randomUUID()}, ${event.workspaceId}, ${event.operationId}, ${event.mediaStepId}, ${event.deletionId ?? null},
      ${event.postId}, ${event.postTargetId}, ${event.targetId}, ${event.remoteTargetId}, ${event.publicationActorId},
      ${event.eventActorId ?? null}, ${event.phase}, ${event.ordinal}, ${event.source}, ${event.outcome}, ${event.remoteId ?? null})`;
}

type DeletionBinding = FacebookMediaResolutionBinding & {
  id: string;
  remotePhotoId: string;
  state: string;
  receiptAt: Date | null;
  attestedAt: Date | null;
  attestedBy: string | null;
  parentProvider: string;
  parentOperationId: string;
  parentState: string;
  parentPostId: string;
  parentPostTargetId: string;
  parentTargetId: string;
  parentActorId: string;
};

/** Commit an adapter result even if an operator resolved the deletion while its callback was delayed. */
export async function recordFacebookMediaDeletionOutcome(
  tx: Prisma.TransactionClient,
  deletionId: string,
  providerOutcome: 'confirmed' | 'rejected' | 'uncertain',
): Promise<'confirmed' | 'rejected' | 'uncertain' | 'conflict'> {
  const refs = await tx.$queryRaw<Array<{ workspaceId: string; operationId: string }>>`
    SELECT "workspaceId", "operationId" FROM rebuild_facebook_media_deletions WHERE id=${deletionId}`;
  const ref = refs[0];
  if (!ref) throw new Error('Facebook deletion outcome does not match its immutable publication binding.');

  const parents = await tx.$queryRaw<Array<{ id: string; workspaceId: string; postId: string; postTargetId: string; targetId: string; actorId: string; provider: string; state: string; remotePostId: string | null }>>`
    SELECT id, "workspaceId", "postId", "postTargetId", "targetId", "actorId", provider, state, "remotePostId"
    FROM rebuild_publication_attempts WHERE id=${ref.operationId} AND "workspaceId"=${ref.workspaceId} FOR UPDATE`;
  const parent = parents[0];
  if (!parent || parent.provider !== 'facebook') throw new Error('Facebook deletion outcome does not match its immutable publication binding.');

  const allSteps = await tx.$queryRaw<Array<{ id: string; workspaceId: string; operationId: string; postId: string; postTargetId: string; targetId: string; actorId: string; remoteTargetId: string; phase: string; ordinal: number; remoteId: string | null }>>`
    SELECT id, "workspaceId", "operationId", "postId", "postTargetId", "targetId", "actorId", "remoteTargetId", phase, ordinal, "remoteId"
    FROM rebuild_facebook_media_steps WHERE "workspaceId"=${ref.workspaceId} AND "operationId"=${ref.operationId}
    ORDER BY phase, ordinal, id FOR UPDATE`;
  if (!allSteps.length || allSteps.some(step => step.postId !== parent.postId || step.postTargetId !== parent.postTargetId ||
    step.targetId !== parent.targetId || step.actorId !== parent.actorId)) {
    throw new Error('Facebook deletion operation has mismatched media bindings.');
  }

  const rows = await tx.$queryRaw<DeletionBinding[]>`
    SELECT d.id, d."workspaceId", d."operationId", d."mediaStepId", d."postId", d."postTargetId", d."targetId",
      d."remoteTargetId", d."remotePhotoId", a."actorId" AS "publicationActorId", NULL::text AS "eventActorId",
      d.state, d."receiptAt", d."attestedAt", d."attestedBy", s.phase, s.ordinal,
      a.provider AS "parentProvider", a.id AS "parentOperationId", a.state AS "parentState", a."postId" AS "parentPostId",
      a."postTargetId" AS "parentPostTargetId", a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId"
    FROM rebuild_facebook_media_deletions d
    JOIN rebuild_facebook_media_steps s ON s.id=d."mediaStepId" AND s."workspaceId"=d."workspaceId"
    JOIN rebuild_publication_attempts a ON a.id=d."operationId" AND a."workspaceId"=d."workspaceId"
    WHERE d."workspaceId"=${ref.workspaceId} AND d."operationId"=${ref.operationId}
    ORDER BY d."createdAt", d.id FOR UPDATE OF d`;
  const deletion = rows.find(row => row.id === deletionId);
  const step = deletion && allSteps.find(row => row.id === deletion.mediaStepId);
  if (!deletion || !step || deletion.parentProvider !== 'facebook' || deletion.phase !== 'photo' ||
    deletion.operationId !== parent.id || deletion.postId !== parent.postId || deletion.postTargetId !== parent.postTargetId ||
    deletion.targetId !== parent.targetId || deletion.publicationActorId !== parent.actorId ||
    step.remoteTargetId !== deletion.remoteTargetId || step.remoteId !== deletion.remotePhotoId) {
    throw new Error('Facebook deletion outcome does not match its immutable publication binding.');
  }

  const outcome = providerOutcome === 'confirmed' ? 'late_provider_receipt'
    : providerOutcome === 'rejected' ? 'late_provider_rejection' : 'late_provider_uncertain';
  const event: FacebookMediaResolutionBinding = {
    workspaceId: deletion.workspaceId, operationId: deletion.operationId, mediaStepId: deletion.mediaStepId,
    deletionId: deletion.id, postId: deletion.postId, postTargetId: deletion.postTargetId, targetId: deletion.targetId,
    remoteTargetId: deletion.remoteTargetId, publicationActorId: deletion.publicationActorId,
    phase: 'delete', ordinal: deletion.ordinal, source: 'provider', outcome,
    remoteId: providerOutcome === 'confirmed' ? deletion.remotePhotoId : null,
  };

  const current = deletion.state;
  const matchingHuman = current === 'attested_deleted' ||
    current === 'attested_present' && providerOutcome !== 'confirmed';
  const matchingProviderReceipt = current === 'confirmed' && providerOutcome === 'confirmed' ||
    current === 'rejected' && providerOutcome === 'rejected';
  if (current === 'started') {
    const terminalContradiction = ['receipt_recorded', 'projected'].includes(parent.state);
    if (parent.state !== 'started' && parent.state !== 'uncertain') await appendFacebookMediaResolution(tx, event);
    if (terminalContradiction) {
      await tx.$executeRaw`UPDATE rebuild_facebook_media_deletions SET state='conflict',
        "receiptAt"=CASE WHEN ${providerOutcome === 'uncertain'} THEN NULL ELSE CURRENT_TIMESTAMP END,
        "updatedAt"=CURRENT_TIMESTAMP WHERE id=${deletion.id} AND state='started'`;
      return 'conflict';
    }
    await tx.$executeRaw`UPDATE rebuild_facebook_media_deletions SET state=${providerOutcome},
      "receiptAt"=CASE WHEN ${providerOutcome === 'uncertain'} THEN NULL ELSE CURRENT_TIMESTAMP END,
      "updatedAt"=CURRENT_TIMESTAMP WHERE id=${deletion.id} AND state='started'`;
    return providerOutcome;
  }

  await appendFacebookMediaResolution(tx, event);
  if (matchingHuman || matchingProviderReceipt || current === 'uncertain' && providerOutcome === 'uncertain') {
    if (current === 'attested_deleted' || current === 'confirmed') return 'confirmed';
    if (current === 'rejected' || current === 'attested_present' && providerOutcome === 'rejected') return 'rejected';
    return 'uncertain';
  }
  if (current === 'uncertain' && providerOutcome !== 'uncertain') {
    await tx.$executeRaw`UPDATE rebuild_facebook_media_deletions SET state=${providerOutcome}, "receiptAt"=CURRENT_TIMESTAMP,
      "updatedAt"=CURRENT_TIMESTAMP WHERE id=${deletion.id} AND state='uncertain'`;
    return providerOutcome;
  }
  if (current === 'conflict') return 'conflict';
  if (providerOutcome === 'confirmed' && ['attested_present', 'rejected'].includes(current)) {
    const sibling = rows.find(row => row.id !== deletion.id && !['rejected', 'attested_present'].includes(row.state));
    if (sibling) {
      await tx.$executeRaw`UPDATE rebuild_facebook_media_deletions SET state='conflict', "updatedAt"=CURRENT_TIMESTAMP WHERE id=${sibling.id}`;
      return 'conflict';
    }
  }
  await tx.$executeRaw`UPDATE rebuild_facebook_media_deletions SET state='conflict',
    "receiptAt"=CASE WHEN ${providerOutcome === 'uncertain'} THEN "receiptAt" ELSE CURRENT_TIMESTAMP END,
    "updatedAt"=CURRENT_TIMESTAMP WHERE id=${deletion.id}`;
  return 'conflict';
}
