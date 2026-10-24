import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { requireActiveRoot } from '@/server/root/operations';
import { withRootPublicationOperation } from '@/server/root/publication-operation';
import type { PlatformPublicationActionInput, PlatformPublicationActionResult } from '@/server/platforms/host';
import type { FacebookMediaDeletionBinding } from './media-cleanup-transport-port';
import { recordFacebookMediaDeletionOutcome } from './media-resolution-store';

type Candidate = FacebookMediaDeletionBinding & {
  id: string;
  workspaceId: string;
  operationId: string;
  postId: string;
  postTargetId: string;
  targetId: string;
  actorId: string;
  provider: string;
  parentState: string;
  parentRemotePostId: string | null;
  projectedRemotePostId: string | null;
  parentPostId: string;
  parentPostTargetId: string;
  parentTargetId: string;
  parentActorId: string;
};
type DeletionRow = {
  id: string;
  mediaStepId: string;
  operationId: string;
  state: string;
};

const actionSchema = z.object({
  actionId: z.literal('delete_staged_photo'),
  subjectId: z.string().min(1).max(2048),
  confirmation: z.string().max(300),
  acknowledged: z.literal(true),
}).strict();
const failure = (code: 'invalid_request' | 'not_found' | 'conflict' | 'unavailable' | 'forbidden', message: string) => new OperationError(code, message);

async function audit(tx: Prisma.TransactionClient, actorId: string, candidate: Candidate, deletionId: string, state: string) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt")
    VALUES (${randomUUID()}, ${actorId}, ${`facebook.staged_photo_deletion_${state}`},
      ${JSON.stringify({ workspaceId: candidate.workspaceId, targetId: candidate.targetId, operationId: candidate.operationId,
        mediaStepId: candidate.id, deletionId, remotePhotoId: candidate.remotePhotoId, state })}::jsonb, CURRENT_TIMESTAMP)`;
}

async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
  const [timeout, maxWait] = await Promise.all([
    runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs'),
  ]);
  if (![timeout, maxWait].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)) {
    throw failure('unavailable', 'Publishing transaction limits are unavailable.');
  }
  return prisma.$transaction(run, { timeout: timeout as number, maxWait: maxWait as number });
}

async function loadCandidate(stepId: string): Promise<Candidate> {
  const rows = await prisma.$queryRaw<Candidate[]>`
    SELECT s.id, s."workspaceId", s."operationId", s."postId", s."postTargetId", s."targetId", s."actorId",
      s."remoteTargetId", s."remoteId" AS "remotePhotoId", a.provider, a.state AS "parentState",
      a."remotePostId" AS "parentRemotePostId", pt."remotePostId" AS "projectedRemotePostId",
      a."postId" AS "parentPostId", a."postTargetId" AS "parentPostTargetId", a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId"
    FROM facebook_media_steps s
    JOIN publication_attempts a ON a.id=s."operationId" AND a."workspaceId"=s."workspaceId"
    JOIN targets t ON t.id=s."targetId" AND t."workspaceId"=s."workspaceId" AND t."providerId"=s."remoteTargetId"
    LEFT JOIN post_targets pt ON pt.id=s."postTargetId" AND pt."postId"=s."postId"
    WHERE s.id=${stepId} AND s.phase='photo' AND s.state IN ('recorded','attested_present') AND s."remoteId" IS NOT NULL
      AND a.provider='facebook'
    LIMIT 1`;
  const row = rows[0];
  if (!row) throw failure('not_found', 'This known Facebook photo is unavailable for cleanup.');
  if (row.postId !== row.parentPostId || row.postTargetId !== row.parentPostTargetId || row.targetId !== row.parentTargetId || row.actorId !== row.parentActorId) {
    throw failure('conflict', 'The Facebook media evidence does not match its publication binding.');
  }
  return row;
}

async function lockAndValidate(tx: Prisma.TransactionClient, candidate: Candidate) {
  const parents = await tx.$queryRaw<Array<{ workspaceId: string; postId: string; postTargetId: string; targetId: string; actorId: string; provider: string; parentState: string; parentRemotePostId: string | null; projectedRemotePostId: string | null }>>`
    SELECT a."workspaceId", a."postId", a."postTargetId", a."targetId", a."actorId", a.provider,
      a.state AS "parentState", a."remotePostId" AS "parentRemotePostId", pt."remotePostId" AS "projectedRemotePostId"
    FROM publication_attempts a
    LEFT JOIN post_targets pt ON pt.id=a."postTargetId" AND pt."postId"=a."postId"
    WHERE a.id=${candidate.operationId} AND a."workspaceId"=${candidate.workspaceId} FOR UPDATE OF a`;
  const lockedParent = parents[0];
  if (!lockedParent) throw failure('conflict', 'The Facebook publication attempt is unavailable.');
  const rows = await tx.$queryRaw<Array<Candidate & { phase: string; ordinal: number; state: string; remoteId: string | null }>>`
    SELECT s.id, s."workspaceId", s."operationId", s."postId", s."postTargetId", s."targetId", s."actorId",
      s."remoteTargetId", s."remoteId", s.phase, s.ordinal, s.state, a.provider, a.state AS "parentState",
      a."remotePostId" AS "parentRemotePostId", pt."remotePostId" AS "projectedRemotePostId",
      a."postId" AS "parentPostId", a."postTargetId" AS "parentPostTargetId", a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId"
    FROM facebook_media_steps s
    JOIN publication_attempts a ON a.id=s."operationId" AND a."workspaceId"=s."workspaceId"
    LEFT JOIN post_targets pt ON pt.id=s."postTargetId" AND pt."postId"=s."postId"
    WHERE s."workspaceId"=${candidate.workspaceId} AND s."operationId"=${candidate.operationId}
    ORDER BY s.phase, s.ordinal, s.id FOR UPDATE OF s`;
  const photo = rows.find(row => row.id === candidate.id);
  const parent = rows[0];
  const hasMismatchedStep = rows.some(step => step.workspaceId !== parent?.workspaceId || step.operationId !== parent?.operationId || step.postId !== parent?.parentPostId ||
    step.postTargetId !== parent?.parentPostTargetId || step.targetId !== parent?.parentTargetId || step.actorId !== parent?.parentActorId ||
    step.remoteTargetId !== candidate.remoteTargetId);
  if (!photo || !parent || photo.phase !== 'photo' || !['recorded', 'attested_present'].includes(photo.state) || photo.remoteId !== candidate.remotePhotoId ||
    photo.targetId !== candidate.targetId || photo.postTargetId !== candidate.postTargetId || photo.remoteTargetId !== candidate.remoteTargetId || hasMismatchedStep) {
    throw failure('conflict', 'The Facebook photo evidence changed; reload Root recovery history.');
  }
  if (parent.provider !== 'facebook' || parent.parentState !== lockedParent.parentState || !['started', 'uncertain', 'attested_absent', 'rejected'].includes(parent.parentState) || parent.parentRemotePostId || parent.projectedRemotePostId || lockedParent.projectedRemotePostId) {
    throw failure('conflict', 'This publication already has a post result and cannot use staged-photo cleanup.');
  }
  const feed = rows.find(row => row.phase === 'feed');
  if (feed && feed.state !== 'rejected') throw failure('conflict', 'A Facebook feed step exists; staged photos can only be deleted after a definite provider rejection.');
  const existing = await tx.$queryRaw<DeletionRow[]>`
    SELECT id, "mediaStepId", "operationId", state FROM facebook_media_deletions
    WHERE "workspaceId"=${candidate.workspaceId} AND "mediaStepId"=${candidate.id}
    ORDER BY "createdAt" DESC, id DESC FOR UPDATE`;
  const active = existing.find(row => !['rejected', 'attested_present'].includes(row.state));
  if (active?.state === 'confirmed' || active?.state === 'attested_deleted') return { active, parent, photo };
  if (active) throw failure('conflict', 'A Facebook photo deletion is already unresolved; do not send it again.');
  return { active: undefined, parent, photo };
}

async function startDeletion(actorId: string, candidate: Candidate) {
  return transaction(async tx => {
    const locked = await lockAndValidate(tx, candidate);
    if (locked.active?.state === 'confirmed' || locked.active?.state === 'attested_deleted') return { id: locked.active.id, replay: true };
    if (locked.parent.parentState === 'started') {
      const frozen = await tx.$executeRaw`UPDATE publication_attempts SET state='uncertain', reason='outcome_unknown', "updatedAt"=CURRENT_TIMESTAMP
        WHERE id=${candidate.operationId} AND "workspaceId"=${candidate.workspaceId} AND state='started'`;
      if (frozen !== 1) throw failure('conflict', 'The Facebook publication changed before cleanup could be recorded.');
    }
    const id = randomUUID();
    await tx.$executeRaw`INSERT INTO facebook_media_deletions
      (id, "workspaceId", "mediaStepId", "operationId", "postId", "postTargetId", "targetId", "remoteTargetId", "remotePhotoId", "actorId", state)
      VALUES (${id}, ${candidate.workspaceId}, ${candidate.id}, ${candidate.operationId}, ${candidate.postId}, ${candidate.postTargetId},
        ${candidate.targetId}, ${candidate.remoteTargetId}, ${candidate.remotePhotoId}, ${actorId}, 'started')`;
    await audit(tx, actorId, candidate, id, 'started');
    return { id, replay: false };
  });
}

async function finishDeletion(actorId: string, candidate: Candidate, deletionId: string, state: 'uncertain' | 'confirmed' | 'rejected') {
  return transaction(async tx => {
    const rows = await tx.$queryRaw<DeletionRow[]>`
      SELECT id, "mediaStepId", "operationId", state FROM facebook_media_deletions
      WHERE id=${deletionId} AND "workspaceId"=${candidate.workspaceId}`;
    if (rows.length !== 1 || rows[0].mediaStepId !== candidate.id || rows[0].operationId !== candidate.operationId || !['started', 'uncertain', 'attested_deleted', 'attested_present', 'conflict'].includes(rows[0].state)) {
      throw failure('conflict', 'The Facebook photo deletion receipt cannot be matched to its intent.');
    }
    const resolved = await recordFacebookMediaDeletionOutcome(tx, deletionId, state);
    await audit(tx, actorId, candidate, deletionId, resolved);
    return resolved;
  });
}

/** One exact, explicitly acknowledged Root action. It never replays an uncertain provider request. */
export async function cleanupFacebookMedia(userId: string, input: PlatformPublicationActionInput): Promise<PlatformPublicationActionResult> {
  await requireActiveRoot(userId);
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== `DELETE STAGED PHOTO ${parsed.data.subjectId}`) {
    throw failure('invalid_request', 'Verify the unused photo and enter its exact deletion confirmation.');
  }
  const enabled = await runtimeConfig('meta.manualMediaCleanupEnabled');
  if (enabled !== true) throw failure('forbidden', 'Manual Facebook media cleanup is disabled in Root configuration.');

  const candidate = await loadCandidate(parsed.data.subjectId);
  return withRootPublicationOperation(userId, {
    workspaceId: candidate.workspaceId, postId: candidate.postId, targetId: candidate.targetId,
  }, async (_outerTx, signal) => {
    await requireActiveRoot(userId);
    const stillEnabled = await runtimeConfig('meta.manualMediaCleanupEnabled');
    if (stillEnabled !== true) throw failure('forbidden', 'Manual Facebook media cleanup is disabled in Root configuration.');
    const locked = await transaction(tx => lockAndValidate(tx, candidate));
    if (locked.active?.state === 'confirmed' || locked.active?.state === 'attested_deleted') return {
      ok: true, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
      operationId: locked.active.id, state: locked.active.state === 'confirmed' ? 'confirmed' : 'attested', message: 'The staged photo deletion is recorded in Root recovery history.',
    };

    const { prepareFacebookMediaDeletion } = await import('./media-cleanup-transport');
    const binding: FacebookMediaDeletionBinding = {
      workspaceId: candidate.workspaceId, targetId: candidate.targetId,
      remoteTargetId: candidate.remoteTargetId, remotePhotoId: candidate.remotePhotoId,
    };
    const performDeletion = await prepareFacebookMediaDeletion(binding);
    const intent = await startDeletion(userId, candidate);
    if (intent.replay) return {
      ok: true, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
      operationId: intent.id, state: 'confirmed', message: 'Facebook confirmed this staged photo was deleted.',
    };
    let outcome: 'confirmed' | 'rejected' | 'uncertain';
    try { outcome = await performDeletion(signal); }
    catch {
      try { await finishDeletion(userId, candidate, intent.id, 'uncertain'); } catch { /* started remains held if receipt persistence fails */ }
      return {
        ok: false, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
        operationId: intent.id, state: 'needs_review', message: 'Facebook deletion outcome is unknown. Do not repeat this request; review the platform and Root recovery history.',
      };
    }
    let savedOutcome: 'confirmed' | 'rejected' | 'uncertain' | 'conflict';
    try { savedOutcome = await finishDeletion(userId, candidate, intent.id, outcome); }
    catch {
      return {
        ok: false, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
        operationId: intent.id, state: 'needs_review', message: 'Facebook responded, but its deletion receipt could not be saved. Do not repeat this request; review Root recovery history.',
      };
    }
    if (savedOutcome === 'conflict') return {
      ok: false, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
      operationId: intent.id, state: 'needs_review', message: 'Facebook returned a delayed deletion result that conflicts with newer recovery evidence. Do not repeat the request; review the full media history.',
    };
    if (outcome === 'confirmed' && savedOutcome === 'confirmed') return {
      ok: true, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
      operationId: intent.id, state: 'confirmed', message: 'Facebook confirmed this staged photo was deleted.',
    };
    if (outcome === 'rejected' && savedOutcome === 'rejected') return {
      ok: false, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
      operationId: intent.id, state: 'rejected', message: 'Facebook rejected the photo deletion. A new explicit Root action may be available after review.',
    };
    return {
      ok: false, actionId: parsed.data.actionId, subjectId: parsed.data.subjectId,
      operationId: intent.id, state: 'needs_review', message: 'Facebook deletion outcome is unknown. Do not repeat this request; review the platform and Root recovery history.',
    };
  }, { remote: true });
}
