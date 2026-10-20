import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import type { PublishResult, RemoteStatus } from '@/platforms/types';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { authorizePublishing } from './access';
import { withPublishingOperation, withPublishingTransaction } from './guard';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from './read-scope';
import { assertNoPostDeletionForRemoteIdentity } from './post-deletion-guard';
import type { PublishingActor } from './types';
import { assertPlatformPublicationOutcome, assertPlatformPublicationsSettled } from '@/server/platforms/publication-recovery';

export type PublicationState = 'started' | 'uncertain' | 'submitted' | 'receipt_recorded' | 'projected' | 'rejected' | 'attested_absent';
export type PublicationRow = { id: string; workspaceId: string; postId: string; postTargetId: string; targetId: string; provider: string; actorId: string; state: PublicationState; reason: string | null; remotePostId: string | null; remoteUrl: string | null; receiptAt: Date | null; attestedAt: Date | null; createdAt: Date; updatedAt: Date };
export type PublicationStatus = { postId: string; operations: Array<{ id: string; postTargetId: string; targetId: string; targetName: string | null; state: PublicationState; reason: string | null; remotePostId: string | null; remoteUrl: string | null; createdAt: string; updatedAt: string }>; legacyProcessingCount: number; truncated: boolean };
const managers = new Set(['owner', 'admin', 'editor']);
const missing = () => new OperationError('not_found', 'This publication is unavailable in the current workspace.');

async function validId(value: unknown) {
  const max = await runtimeConfig('publishing.identifierMaxCharacters');
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new OperationError('invalid_request', 'Choose a valid publication record.');
}
async function audit(tx: Prisma.TransactionClient, actorId: string | null, workspaceId: string, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${action}, ${JSON.stringify({ workspaceId, ...detail })}::jsonb, NOW())`;
}
async function receipt(input: { remotePostId?: unknown; remoteUrl?: unknown }) {
  await validId(input.remotePostId);
  let remoteUrl: string | null = null;
  if (input.remoteUrl !== undefined && input.remoteUrl !== null && input.remoteUrl !== '') {
    const max = await runtimeConfig('publishing.publicationUrlMaxCharacters');
    if (typeof input.remoteUrl !== 'string' || input.remoteUrl.length > max || /[\u0000-\u0020\u007f]/.test(input.remoteUrl)) throw new OperationError('invalid_request', 'Use a valid HTTPS publication link without credentials.');
    let url: URL;
    try { url = new URL(input.remoteUrl); } catch { throw new OperationError('invalid_request', 'Use a valid HTTPS publication link without credentials.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new OperationError('invalid_request', 'Use a valid HTTPS publication link without credentials.');
    remoteUrl = url.toString();
    if (remoteUrl.length > max) throw new OperationError('invalid_request', 'Use a shorter publication link.');
  }
  return { remotePostId: input.remotePostId as string, remoteUrl };
}
async function selectedPost(actor: PublishingActor, postId: string) {
  const access = await authorizePublishing(actor, 'publishing/posts', 'read');
  const ids = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.actor.allowedTargetIds);
  const post = await prisma.post.findFirst({ where: { AND: [{ id: postId }, publishingPostVisibilityWhere(actor.workspaceId, ids, access.actor.allowedTargetIds === undefined ? undefined : actor.userId)] }, select: { id: true, authorId: true, targets: { select: { id: true, targetId: true, status: true, remotePostId: true, target: { select: { name: true, socialAccount: { select: { provider: true } } } } } } } });
  if (!post) throw missing();
  return post;
}
async function status(actor: PublishingActor, postId: string): Promise<PublicationStatus> {
  const post = await selectedPost(actor, postId);
  const limit = await runtimeConfig('publishing.publicationHistoryLimit');
  const rows = await prisma.$queryRaw<PublicationRow[]>`SELECT id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId", "remoteUrl", "receiptAt", "attestedAt", "createdAt", "updatedAt"
    FROM rebuild_publication_attempts WHERE "workspaceId" = ${actor.workspaceId} AND "postId" = ${postId}
    ORDER BY CASE WHEN state IN ('started','uncertain','submitted','receipt_recorded') THEN 0 ELSE 1 END, "createdAt" DESC, id DESC LIMIT ${limit + 1}`;
  // All attempt identities must still be in current scope, even if local destination references were changed.
  const access = await authorizePublishing(actor, 'publishing/posts', 'read');
  const ids = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.actor.allowedTargetIds);
  if (rows.some(row => !ids.includes(row.targetId))) throw missing();
  const legacy = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM post_targets p JOIN posts s ON s.id=p."postId"
    WHERE s."workspaceId"=${actor.workspaceId} AND p."postId"=${postId} AND p.status='processing' AND p."remotePostId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM rebuild_publication_attempts a WHERE a."workspaceId"=s."workspaceId" AND a."postTargetId"=p.id AND a.state NOT IN ('rejected','attested_absent'))`;
  return { postId, truncated: rows.length > limit, legacyProcessingCount: Number(legacy[0]?.count ?? 0), operations: rows.slice(0, limit).map(row => ({ id: row.id, postTargetId: row.postTargetId, targetId: row.targetId, targetName: post.targets.find(target => target.targetId === row.targetId)?.target.name ?? null, state: row.state, reason: row.reason, remotePostId: row.remotePostId, remoteUrl: row.remoteUrl, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
}
export async function getPublicationStatus(actor: PublishingActor, input: { postId: string }): Promise<PublicationStatus> {
  await validId(input.postId);
  return status(actor, input.postId);
}
export async function aggregatePublicationPostInTransaction(tx: Prisma.TransactionClient, workspaceId: string, postId: string) {
  const rows = await tx.postTarget.findMany({ where: { postId, post: { workspaceId } }, select: { status: true, publishedAt: true } });
  if (!rows.length) return;
  const published = rows.filter(row => row.status === 'published' || row.status === 'scheduled_remote').length;
  const pending = rows.some(row => row.status === 'processing');
  const scheduled = rows.some(row => row.status === 'scheduled_remote');
  const state = pending ? published ? 'partially_failed' : 'publishing' : published === rows.length ? scheduled ? 'scheduled' : 'published' : published ? 'partially_failed' : 'failed';
  await tx.post.updateMany({ where: { id: postId, workspaceId }, data: { status: state, ...(published === rows.length && !scheduled ? { publishedAt: rows.reduce<Date | null>((latest, row) => !row.publishedAt ? latest : !latest || row.publishedAt > latest ? row.publishedAt : latest, null) ?? new Date() } : {}), updatedAt: new Date() } });
}

/** Trusted helper: caller owns current authority, post/destination exclusion and workspace guard. */
export async function recordPublicationOutcomeInTransaction(tx: Prisma.TransactionClient, actorId: string, input: { workspaceId: string; operationId: string; outcome: 'PUBLISHED' | 'ABSENT'; remotePostId?: string; remoteUrl?: string }) {
  if (!['PUBLISHED', 'ABSENT'].includes(input.outcome)) throw new OperationError('invalid_request', 'Choose a publication outcome.');
  const confirmed = input.outcome === 'PUBLISHED' ? await receipt(input) : null;
  if (input.outcome === 'ABSENT' && (input.remotePostId || input.remoteUrl)) throw new OperationError('invalid_request', 'Absent publications cannot include a remote receipt.');
  const rows = await tx.$queryRaw<PublicationRow[]>`SELECT * FROM rebuild_publication_attempts WHERE id=${input.operationId} AND "workspaceId"=${input.workspaceId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw missing();
  if (!['started', 'uncertain', 'submitted'].includes(row.state)) throw new OperationError('conflict', 'This publication already has a recorded outcome.');
  if (row.state === 'submitted' && (!confirmed || confirmed.remotePostId !== row.remotePostId)) {
    throw new OperationError('conflict', 'This submission already has a remote identity. Verify that exact publication; it cannot be recorded absent or replaced.');
  }
  await assertPlatformPublicationOutcome(tx, row.provider, row.workspaceId, row.id, input.outcome, confirmed?.remotePostId);
  if (confirmed) {
    await assertReceiptIdentity(tx, row, confirmed.remotePostId);
    await tx.$executeRaw`UPDATE rebuild_publication_attempts SET state='receipt_recorded', reason='external_human_attestation', "remotePostId"=${confirmed.remotePostId}, "remoteUrl"=${row.state === 'submitted' ? row.remoteUrl ?? confirmed.remoteUrl : confirmed.remoteUrl}, "receiptAt"=${row.state === 'submitted' ? row.receiptAt : new Date()}, "attestedAt"=CURRENT_TIMESTAMP, "attestedBy"=${actorId}, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${row.id} AND "workspaceId"=${input.workspaceId}`;
  } else {
    await tx.$executeRaw`UPDATE rebuild_publication_attempts SET state='attested_absent', reason='external_human_attestation', "attestedAt"=CURRENT_TIMESTAMP, "attestedBy"=${actorId}, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${row.id} AND "workspaceId"=${input.workspaceId}`;
    await tx.postTarget.updateMany({ where: { id: row.postTargetId, postId: row.postId, targetId: row.targetId, post: { workspaceId: input.workspaceId }, status: 'processing', remotePostId: null }, data: { status: 'failed' } });
    await aggregatePublicationPostInTransaction(tx, input.workspaceId, row.postId);
    await emitWorkspaceAlert(tx, { workspaceId: input.workspaceId, eventId: `publication_${row.id}`, kind: 'publish_failure', postId: row.postId, targetId: row.targetId });
  }
  await audit(tx, actorId, input.workspaceId, 'publishing.publication_outcome_recorded', { operationId: row.id, postId: row.postId, targetId: row.targetId, outcome: input.outcome, verification: 'external_human_attestation' });
  return { ok: true as const, operationId: row.id, state: confirmed ? 'receipt_recorded' as const : 'attested_absent' as const };
}
async function assertReceiptIdentity(tx: Prisma.TransactionClient, row: Pick<PublicationRow, 'workspaceId' | 'targetId' | 'postTargetId'>, remotePostId: string) {
  await assertNoPostDeletionForRemoteIdentity(tx, row.workspaceId, row.targetId, remotePostId);
  const duplicate = await tx.postTarget.findFirst({ where: { targetId: row.targetId, remotePostId, post: { workspaceId: row.workspaceId }, id: { not: row.postTargetId } }, select: { id: true } });
  if (duplicate) throw new OperationError('conflict', 'This publication is already linked to another post. Review its existing record.');
}

/** Recover only the local projection; never calls a provider or sends a first comment. */
export async function projectPublicationInOperation(actor: PublishingActor, operationId: string, signal: AbortSignal): Promise<boolean> {
  return withPublishingTransaction(signal, tx => projectPublicationInTransaction(tx, actor, operationId));
}

/** Trusted local-only projection for Root and the guarded product service. */
export async function projectPublicationInTransaction(tx: Prisma.TransactionClient, actor: { userId: string | null; workspaceId: string }, operationId: string, observedPublishedAt?: Date): Promise<boolean> {
    const rows = await tx.$queryRaw<PublicationRow[]>`SELECT * FROM rebuild_publication_attempts WHERE id=${operationId} AND "workspaceId"=${actor.workspaceId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw missing();
    if (row.state === 'projected') return true;
    if (row.state !== 'receipt_recorded' || !row.remotePostId) throw new OperationError('conflict', 'This publication needs a confirmed receipt before local recovery.');
    await assertPlatformPublicationOutcome(tx, row.provider, row.workspaceId, row.id, 'PUBLISHED', row.remotePostId);
    await assertReceiptIdentity(tx, row, row.remotePostId);
    const changed = await tx.postTarget.updateMany({ where: { id: row.postTargetId, postId: row.postId, targetId: row.targetId, post: { workspaceId: actor.workspaceId }, status: 'processing', remotePostId: null }, data: { status: 'published', remotePostId: row.remotePostId, remoteUrl: row.remoteUrl, publishedAt: observedPublishedAt ?? row.attestedAt ?? row.receiptAt } });
    if (changed.count !== 1) throw new OperationError('conflict', 'This destination changed. Review its publication before continuing.');
    await tx.$executeRaw`UPDATE rebuild_publication_attempts SET state='projected', "projectedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${row.id}`;
    await aggregatePublicationPostInTransaction(tx, actor.workspaceId, row.postId);
    await audit(tx, actor.userId, actor.workspaceId, 'publishing.target_published', { postId: row.postId, postTargetId: row.postTargetId, operationId });
    return true;
}
export async function recordPublicationOutcome(actor: PublishingActor, input: { postId: string; operationId: string; outcome: 'PUBLISHED' | 'ABSENT'; remotePostId?: string; remoteUrl?: string; confirmation: string; verifiedExternally: true }): Promise<PublicationStatus> {
  await validId(input.postId); await validId(input.operationId);
  if (input.verifiedExternally !== true || !['PUBLISHED', 'ABSENT'].includes(input.outcome) || input.confirmation !== `RECORD PUBLICATION ${input.operationId} ${input.outcome}`) throw new OperationError('invalid_request', 'Verify the external result and enter its exact confirmation.');
  return withPublishingOperation(actor, { postId: input.postId, allowPublicationRecovery: true }, async context => {
    if (!managers.has(context.role)) throw new OperationError('forbidden', 'Only workspace managers can record external publication outcomes.');
    await selectedPost(context.actor, input.postId);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_publication_attempts WHERE id=${input.operationId} AND "workspaceId"=${actor.workspaceId} AND "postId"=${input.postId}`;
    if (!rows.length) throw missing();
    await withPublishingTransaction(context.signal, tx => recordPublicationOutcomeInTransaction(tx, actor.userId, { ...input, workspaceId: actor.workspaceId }));
    return status(context.actor, input.postId);
  });
}
export async function finishPublicationProjection(actor: PublishingActor, input: { postId: string; operationId: string; confirmation: string }): Promise<PublicationStatus> {
  await validId(input.postId); await validId(input.operationId);
  if (input.confirmation !== `FINISH PUBLICATION ${input.operationId}`) throw new OperationError('invalid_request', 'Confirm the exact publication to finish its local update.');
  return withPublishingOperation(actor, { postId: input.postId, allowPublicationRecovery: true }, async context => {
    if (!managers.has(context.role)) throw new OperationError('forbidden', 'Only workspace managers can finish publication recovery.');
    await selectedPost(context.actor, input.postId);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_publication_attempts WHERE id=${input.operationId} AND "workspaceId"=${actor.workspaceId} AND "postId"=${input.postId}`;
    if (!rows.length) throw missing();
    await projectPublicationInOperation(context.actor, input.operationId, context.signal);
    return status(context.actor, input.postId);
  });
}
export async function adoptLegacyPublication(actor: PublishingActor, input: { postId: string; postTargetId: string; confirmation: string }): Promise<PublicationStatus> {
  await validId(input.postId); await validId(input.postTargetId);
  if (input.confirmation !== `ADOPT PUBLICATION ${input.postTargetId}`) throw new OperationError('invalid_request', 'Confirm the exact destination to begin recovery.');
  return withPublishingOperation(actor, { postId: input.postId, allowPublicationRecovery: true }, async context => {
    if (!managers.has(context.role)) throw new OperationError('forbidden', 'Only workspace managers can begin publication recovery.');
    const post = await selectedPost(context.actor, input.postId);
    const row = post.targets.find(target => target.id === input.postTargetId);
    const provider = row?.target.socialAccount?.provider;
    if (!row || row.status !== 'processing' || row.remotePostId || !provider) throw new OperationError('conflict', 'This destination does not need legacy publication recovery.');
    await withPublishingTransaction(context.signal, tx => adoptLegacyPublicationInTransaction(tx, context.actor, { postId: post.id, postTargetId: row.id, targetId: row.targetId, provider }));
    return status(context.actor, input.postId);
  });
}

/** Trusted helper; callers hold current authority and the post/destination locks. */
export async function adoptLegacyPublicationInTransaction(tx: Prisma.TransactionClient, actor: PublishingActor, input: { postId: string; postTargetId: string; targetId: string; provider: string }) {
  const row = await tx.postTarget.findFirst({ where: { id: input.postTargetId, postId: input.postId, targetId: input.targetId, post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId }, status: 'processing', remotePostId: null }, select: { id: true } });
  if (!row) throw new OperationError('conflict', 'This destination does not need legacy publication recovery.');
  const existing = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_publication_attempts WHERE "workspaceId"=${actor.workspaceId} AND "postTargetId"=${row.id} AND state NOT IN ('rejected','attested_absent')`;
  if (existing.length) throw new OperationError('conflict', 'This destination already has a recovery record. Refresh its status.');
  const id = randomUUID();
  await tx.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason) VALUES (${id},${actor.workspaceId},${input.postId},${row.id},${input.targetId},${input.provider},${actor.userId},'uncertain','outcome_unknown')`;
  await audit(tx, actor.userId, actor.workspaceId, 'publishing.publication_legacy_adopted', { postId: input.postId, postTargetId: row.id, operationId: id });
  return { ok: true as const, operationId: id, state: 'uncertain' as const };
}

/** Must run inside the lifecycle's current-authorized workspace/post/destination guard. */
export async function publishDestinationInOperation(context: { actor: PublishingActor; signal: AbortSignal }, input: { postId: string; postTargetId: string; targetId: string; provider: string; expectedStatus: 'pending' | 'failed'; dispatch(operationId: string): Promise<PublishResult>; classifyFailure(error: unknown): 'rejected' | 'uncertain' }): Promise<'published' | 'failed' | 'needs_review'> {
  const { actor, signal } = context;
  const operation = await withPublishingTransaction(signal, async tx => {
    const existing = await tx.$queryRaw<PublicationRow[]>`SELECT * FROM rebuild_publication_attempts WHERE "workspaceId"=${actor.workspaceId} AND "postTargetId"=${input.postTargetId} AND state NOT IN ('rejected','attested_absent') FOR UPDATE`;
    if (existing.length) return existing[0];
    await assertPlatformPublicationsSettled(tx, actor.workspaceId, [input.targetId]);
    const claim = await tx.postTarget.updateMany({ where: { id: input.postTargetId, postId: input.postId, targetId: input.targetId, post: { workspaceId: actor.workspaceId }, status: input.expectedStatus, remotePostId: null }, data: { status: 'processing' } });
    if (claim.count !== 1) return null;
    const id = randomUUID();
    const created = await tx.$queryRaw<PublicationRow[]>`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state) VALUES (${id},${actor.workspaceId},${input.postId},${input.postTargetId},${input.targetId},${input.provider},${actor.userId},'started') RETURNING *`;
    await audit(tx, actor.userId, actor.workspaceId, 'publishing.publication_started', { postId: input.postId, postTargetId: input.postTargetId, operationId: id });
    return created[0] ? { ...created[0], dispatchOwned: true } : null;
  });
  if (!operation) return 'needs_review';
  // Only the caller that inserted the intent owns its dispatch. Existing starts remain held.
  if (operation.state === 'projected') return 'published';
  if (operation.state === 'receipt_recorded') {
    try { await projectPublicationInOperation(actor, operation.id, signal); return 'published'; } catch { return 'needs_review'; }
  }
  // The insert path tags only its in-memory row; existing rows never receive this marker.
  if (!(operation as PublicationRow & { dispatchOwned?: boolean }).dispatchOwned) return 'needs_review';
  return dispatchAndRecord(actor, signal, operation, input);
}
/** Trusted read reconciliation. Caller owns current authorization, selected-resource,
 * post/destination exclusion and fresh provider-policy/credential checks. No I/O. */
export async function reconcileSubmittedPublicationInTransaction(
  tx: Prisma.TransactionClient,
  observer: { userId: string | null; workspaceId: string },
  input: { operationId: string; postId: string; postTargetId: string; targetId: string; provider: string; remoteId: string; remoteTargetId: string },
  status: RemoteStatus,
): Promise<boolean> {
  if (status.state !== 'published' || status.remoteId !== input.remoteId || status.targetId !== input.remoteTargetId) return false;
  const rows = await tx.$queryRaw<PublicationRow[]>`SELECT * FROM rebuild_publication_attempts
    WHERE id=${input.operationId} AND "workspaceId"=${observer.workspaceId} FOR UPDATE`;
  const row = rows[0];
  if (!row || row.state !== 'submitted' || row.provider !== input.provider || row.postId !== input.postId ||
    row.postTargetId !== input.postTargetId || row.targetId !== input.targetId || row.remotePostId !== input.remoteId) return false;
  const destination = await tx.postTarget.findFirst({ where: { id: input.postTargetId, postId: input.postId, targetId: input.targetId,
    status: 'processing', remotePostId: null, post: { workspaceId: observer.workspaceId },
    target: { workspaceId: observer.workspaceId, enabled: true, providerId: input.remoteTargetId,
      socialAccount: { is: { workspaceId: observer.workspaceId, provider: input.provider, invalidatedAt: null } } } }, select: { id: true } });
  if (!destination) return false;
  await assertPlatformPublicationOutcome(tx, row.provider, row.workspaceId, row.id, 'PUBLISHED', row.remotePostId!);
  await assertReceiptIdentity(tx, row, row.remotePostId!);
  const changed = await tx.$executeRaw`UPDATE rebuild_publication_attempts SET state='receipt_recorded',reason='provider_receipt',"updatedAt"=CURRENT_TIMESTAMP
    WHERE id=${row.id} AND "workspaceId"=${row.workspaceId} AND state='submitted' AND "remotePostId"=${input.remoteId}`;
  if (changed !== 1) return false;
  const observedAt = new Date();
  const providerTime = status.publishedAt instanceof Date && Number.isFinite(status.publishedAt.getTime()) &&
    status.publishedAt.getTime() > 0 && status.publishedAt <= observedAt ? status.publishedAt : null;
  // Receipt and projection are atomic: a failed projection leaves submitted held
  // and the next attempt can repeat only the provider GET, never the create.
  await projectPublicationInTransaction(tx, observer, row.id, providerTime ?? observedAt);
  await audit(tx, observer.userId, row.workspaceId, 'publishing.publication_verified', { operationId: row.id, postId: row.postId,
    targetId: row.targetId, verification: 'provider_read', publishedAtSource: providerTime ? 'provider' : 'observed' });
  return true;
}

/** Receipt facts may outlive operation cancellation; this port never dispatches. */
async function receiptTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const [timeout, maxWait] = await Promise.all([runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs')]);
  if (![timeout, maxWait].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new OperationError('unavailable', 'Publication receipt storage is unavailable.');
  }
  return prisma.$transaction(work, { timeout, maxWait });
}
async function dispatchAndRecord(actor: PublishingActor, signal: AbortSignal, operation: PublicationRow, input: { dispatch(operationId: string): Promise<PublishResult>; classifyFailure(error: unknown): 'rejected' | 'uncertain' }): Promise<'published' | 'failed' | 'needs_review'> {
  let output: PublishResult;
  try { signal.throwIfAborted(); output = await input.dispatch(operation.id); }
  catch (error) {
    let rejected = false;
    try { rejected = input.classifyFailure(error) === 'rejected'; } catch { /* An unreliable classifier cannot release a claim. */ }
    try { await receiptTransaction(async tx => {
      const changed = await tx.$executeRaw`UPDATE rebuild_publication_attempts SET state=${rejected ? 'rejected' : 'uncertain'}, reason=${rejected ? 'provider_rejected' : 'outcome_unknown'}, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${operation.id} AND "workspaceId"=${actor.workspaceId} AND state='started'`;
      if (changed !== 1) throw new OperationError('conflict', 'The publication outcome changed.');
      if (rejected) await tx.postTarget.updateMany({ where: { id: operation.postTargetId, postId: operation.postId, post: { workspaceId: actor.workspaceId }, status: 'processing', remotePostId: null }, data: { status: 'failed' } });
      if (rejected) await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: `publication_${operation.id}`, kind: 'publish_failure', postId: operation.postId, targetId: operation.targetId });
      await audit(tx, actor.userId, actor.workspaceId, rejected ? 'publishing.publication_rejected' : 'publishing.publication_uncertain', { operationId: operation.id, postId: operation.postId });
    }); return rejected ? 'failed' : 'needs_review'; } catch { return 'needs_review'; }
  }
  try {
    // The identity is useful evidence even if a provider returns an unsafe URL.
    // Never persist the rejected URL or drop the usable remote identity with it.
    let confirmed = await receipt({ remotePostId: output?.remoteId });
    let invalidUrl = false;
    try { confirmed = await receipt({ remotePostId: output?.remoteId, remoteUrl: output?.url }); }
    catch { invalidUrl = true; }
    // Keep usable returned identities as held facts. Unknown explicit states are held
    // as submissions, never promoted or discarded. Missing states also fail closed;
    // every adapter must explicitly declare published before local projection.
    let submitted = signal.aborted || invalidUrl || output.state !== 'published';
    // A returned identity is a fact, even after cancellation. This bounded local
    // receipt-only transaction never dispatches or projects. Its conditional write
    // still requires the original held claim; purge guards remain enforced.
    await receiptTransaction(async tx => {
      let identityConflict = false;
      try { await assertReceiptIdentity(tx, operation, confirmed.remotePostId); }
      catch (error) {
        if (!(error instanceof OperationError) || error.code !== 'conflict') throw error;
        // Preserve the observed identity without linking it to this post or
        // overriding another post/deletion. Resolution remains a separate action.
        identityConflict = true; submitted = true;
      }
      const changed = await tx.$executeRaw`UPDATE rebuild_publication_attempts SET state=${submitted ? 'submitted' : 'receipt_recorded'}, reason=${submitted ? 'provider_submission' : 'provider_receipt'}, "remotePostId"=${confirmed.remotePostId}, "remoteUrl"=${confirmed.remoteUrl}, "receiptAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${operation.id} AND "workspaceId"=${actor.workspaceId} AND state='started'`;
      if (changed !== 1) throw new OperationError('conflict', 'The publication outcome changed.');
      await audit(tx, actor.userId, actor.workspaceId, submitted ? 'publishing.publication_submitted' : 'publishing.publication_receipt_recorded', { operationId: operation.id, postId: operation.postId, identityConflict });
    });
    if (submitted) return 'needs_review';
    await projectPublicationInOperation(actor, operation.id, signal);
    return 'published';
  } catch { return 'needs_review'; }
}
