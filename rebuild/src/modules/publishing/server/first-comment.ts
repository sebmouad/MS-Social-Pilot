
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { connectionState } from '@/lib/connection-status';
import { prisma } from '@/server/data';
import { readPublishingCredential } from './credentials';
import { platformFor } from '@/server/platforms/registry';
import { hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { authorizePublishing } from './access';
import { availablePublishingFormats } from '../formats';
import { parseFirstCommentDelay } from '../first-comment-delay';
import { runtimeConfig } from '@/server/config/store';
import { FIRST_COMMENT_REJECTED, firstCommentState } from '../first-comment-state';
import { withPublishingOperation, withPublishingTransaction } from './guard';
import type { PublishingActor } from './types';

type Input = { postId: string; postTargetId: string };
type Context = { actor: PublishingActor; role: string; signal: AbortSignal; dueAt?: Date; automatic?: boolean; retryRejected?: boolean };
type CommentReceipt = { ok: true; postId: string; postTargetId: string; state: 'sent' | 'needs_review' | 'ready' | 'scheduled' };
const receipt = (input: Input, state: CommentReceipt['state']): CommentReceipt => ({ ok: true, postId: input.postId, postTargetId: input.postTargetId, state });

async function validId(id: unknown, message: string | undefined = undefined) {
  const errorText = await loadPublishingErrorText();
  message ??= errorText('chooseAValidPublishingRecord');
  const max = await runtimeConfig('publishing.identifierMaxCharacters');
  if (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > max || /[\u0000-\u001f\u007f]/.test(id)) throw new OperationError('invalid_request', message);
}

async function delivery(context: Context, input: Input) {
  const errorText = await loadPublishingErrorText();
  const authority = await authorizePublishing(context.actor, 'publishing/posts', 'write');
  context = { ...context, actor: authority.actor, role: authority.role };
  if (!['owner', 'admin', 'editor', 'contributor'].includes(context.role)) throw new PublishingOperationError('forbidden', 'youCannotManageFirstComments', {}, errorText);
  await validId(input.postTargetId);
  const row = await prisma.postTarget.findFirst({
    where: { id: input.postTargetId, postId: input.postId, post: { workspaceId: context.actor.workspaceId }, target: { workspaceId: context.actor.workspaceId } },
    select: { id: true, targetId: true, status: true, formatId: true, publishedAt: true, remotePostId: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true,
      post: { select: { firstComment: true, authorId: true, format: true, firstCommentDelayMinutes: true } },
      target: { select: { id: true, workspaceId: true, providerId: true, type: true, enabled: true, canPublish: true, accessToken: true, socialAccount: { select: { id: true, workspaceId: true, provider: true, invalidatedAt: true, tokenExpiresAt: true, scopes: true } } } },
    },
  });
  if (!row || (context.actor.allowedTargetIds !== undefined && !context.actor.allowedTargetIds.includes(row.targetId)) ||
    (!['owner', 'admin', 'editor'].includes(context.role) && row.post.authorId !== context.actor.userId)) throw new PublishingOperationError('not_found', 'thisPublishingRecordIsUnavailable', {}, errorText);
  if (row.target.workspaceId !== context.actor.workspaceId || row.target.socialAccount?.workspaceId !== context.actor.workspaceId || !row.target.enabled) throw new PublishingOperationError('not_found', 'thisPublishingDestinationIsUnavailable', {}, errorText);
  if (!row.post.firstComment?.trim() || row.status !== 'published' || !row.remotePostId) throw new PublishingOperationError('conflict', 'thePostMustBeConfirmedPublishedBeforeManagingIts', {}, errorText);
  return row;
}

/** Internal continuation of the already-guarded publish operation. No post is created here. */
export async function attemptFirstCommentInOperation(context: Context, input: Input): Promise<CommentReceipt> {
  const errorText = await loadPublishingErrorText();
  const { actor, signal } = context;
  const row = await delivery(context, input);
  const state = firstCommentState(row.post.firstComment, row);
  if (context.retryRejected) {
    if (state !== 'ready' || row.firstCommentError !== FIRST_COMMENT_REJECTED || row.firstCommentAt || row.firstCommentId) throw new PublishingOperationError('conflict', 'onlyADefinitelyRejectedFirstCommentCanBeRetried', {}, errorText);
  } else if (row.firstCommentError === FIRST_COMMENT_REJECTED && state === 'ready') {
    throw new PublishingOperationError('conflict', 'thisFirstCommentWasRejectedUseTheSeparatelyConfirmed', {}, errorText);
  }
  if (state === 'sent') return receipt(input, 'sent');
  if (state !== 'ready') return receipt(input, 'needs_review');
  if (context.automatic && (row.post.authorId !== actor.userId || row.firstCommentError !== null)) throw new PublishingOperationError('conflict', 'thisFirstCommentRequiresAManualDecisionBeforeRetrying', {}, errorText);
  const maxDelay = await runtimeConfig('publishing.maxFirstCommentDelayMinutes');
  const delay = parseFirstCommentDelay(row.post.firstCommentDelayMinutes, maxDelay);
  if (context.dueAt) {
    if (!Number.isFinite(context.dueAt.getTime()) || !row.publishedAt || !Number.isFinite(row.publishedAt.getTime()) ||
      row.publishedAt.getTime() + delay * 60000 > Math.min(context.dueAt.getTime(), Date.now())) return receipt(input, 'scheduled');
  }
  const source = row.target.socialAccount;
  const provider = source?.provider;
  const [entitlements, adapter] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    provider ? platformFor(provider, 'publishing') : null,
  ]);
  if (!provider || !source || connectionState(source) !== 'connected' || !row.target.enabled || !row.target.canPublish || !row.target.accessToken ||
    !entitlements || !hasPlatformCapability(entitlements, provider) || !adapter?.publishFirstComment || !adapter.supportsTargetKind?.(row.target.type, 'publishing')) {
    throw new PublishingOperationError('unavailable', 'thisDestinationCannotSendItsFirstCommentRightNow', {}, errorText);
  }
  const credential = readPublishingCredential(row.target, adapter, 'firstComment');
  if (!credential) throw new PublishingOperationError('unavailable', 'reconnectThisDestinationBeforeSendingItsFirstComment', {}, errorText);
  if (context.automatic) await assertWorkspaceJobAccess(actor.workspaceId, { provider: provider!, anyFeatureOf: ['publishing/posts'] });
  const selectedFormat = availablePublishingFormats(adapter.publishingFormats).find(format => format.id === (row.formatId ?? row.post.format));
  if (!selectedFormat?.firstComment) throw new PublishingOperationError('unavailable', 'thisPublishingFormatCannotSendAFirstComment', {}, errorText);
  const snapshot = createHash('sha256').update(JSON.stringify(row)).digest('hex');
  const maxId = await runtimeConfig('publishing.identifierMaxCharacters');
  const [receiptTimeout, receiptMaxWait] = await Promise.all([runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs')]);
  if (![maxId, receiptTimeout, receiptMaxWait].every(value => Number.isSafeInteger(value) && value > 0)) throw new PublishingOperationError('unavailable', 'firstCommentReceiptStorageIsUnavailable', {}, errorText);
  const saveReceipt = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work, { timeout: receiptTimeout, maxWait: receiptMaxWait });
  const attemptedAt = new Date();
  const claim = await withPublishingTransaction(signal, async tx => {
    await tx.$executeRaw`LOCK TABLE app_settings IN SHARE MODE`;
    await tx.$queryRaw`SELECT m.id FROM memberships m JOIN users u ON u.id=m."userId" WHERE m."workspaceId"=${actor.workspaceId} AND m."userId"=${actor.userId} AND u."disabledAt" IS NULL FOR SHARE OF m,u`;
    await tx.$queryRaw`SELECT t.id FROM targets t JOIN social_accounts s ON s.id=t."socialAccountId" WHERE t.id=${row.targetId} AND t."workspaceId"=${actor.workspaceId} AND s."workspaceId"=${actor.workspaceId} FOR SHARE OF t,s`;
    if (context.automatic) {
      await tx.$executeRaw`LOCK TABLE memberships IN SHARE MODE`;
      await tx.$queryRaw`SELECT m.id FROM memberships m JOIN users u ON u.id=m."userId" WHERE m."workspaceId"=${actor.workspaceId} AND m.role::text='owner' AND u."disabledAt" IS NULL FOR SHARE OF m,u`;
      await assertWorkspaceJobAccess(actor.workspaceId, { provider: provider!, anyFeatureOf: ['publishing/posts'] });
    }
    const fresh = await delivery(context, input);
    const currentAdapter = provider ? await platformFor(provider, 'publishing') : null;
    const currentCredential = currentAdapter ? readPublishingCredential(fresh.target, currentAdapter, 'firstComment') : null;
    const currentEntitlements = await loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false });
    if (createHash('sha256').update(JSON.stringify(fresh)).digest('hex') !== snapshot || !currentAdapter?.publishFirstComment ||
      !currentCredential || currentCredential.accessToken !== credential.accessToken || JSON.stringify(currentCredential.grantedScopes) !== JSON.stringify(credential.grantedScopes) ||
      currentAdapter.statusPolicyFingerprint !== adapter.statusPolicyFingerprint || !currentEntitlements || !hasPlatformCapability(currentEntitlements, provider!) ||
      !availablePublishingFormats(currentAdapter.publishingFormats).some(format => format.id === selectedFormat.id && format.firstComment)) throw new PublishingOperationError('conflict', 'thisFirstCommentOrConnectionChangedRefreshBeforeContinuing', {}, errorText);
    const result = await tx.postTarget.updateMany({ where: { id: row.id, postId: input.postId, status: 'published', remotePostId: row.remotePostId,
      firstCommentId: null, firstCommentAt: null, firstCommentError: row.firstCommentError }, data: { firstCommentAt: attemptedAt, firstCommentError: null } });
    if (result.count === 1) await audit(tx, actor, context.retryRejected ? 'publishing.first_comment_retry_started' : 'publishing.first_comment_started', { ...input, ...(context.retryRejected ? { previousOutcome: 'rejected' } : {}) });
    return result;
  });
  if (claim.count !== 1) throw new PublishingOperationError('conflict', 'theFirstCommentChangedRefreshThisPostBeforeContinuing', {}, errorText);
  let remoteId: string;
  let providerResolved = false;
  try {
    signal.throwIfAborted();
    const result = await adapter.publishFirstComment({ credential, remotePostId: row.remotePostId!, text: row.post.firstComment!, signal });
    providerResolved = true;
    if (typeof result.remoteId !== 'string' || !result.remoteId.trim() || result.remoteId !== result.remoteId.trim() || result.remoteId.length > maxId || /[\u0000-\u001f\u007f]/.test(result.remoteId)) throw new PublishingOperationError('upstream_failure', 'theCommentOutcomeNeedsReview', {}, errorText);
    remoteId = result.remoteId;
  } catch (error) {
    let rejected = false;
    try { rejected = !providerResolved && adapter.classifyPublishingFailure?.(error) === 'rejected'; } catch { /* An unreliable classifier never releases a claim. */ }
    let recorded = false;
    try {
      await saveReceipt(async tx => {
        const result = await tx.postTarget.updateMany({ where: { id: row.id, postId: input.postId, targetId: row.targetId, status: 'published', remotePostId: row.remotePostId, post: { workspaceId: actor.workspaceId }, firstCommentId: null, firstCommentAt: attemptedAt },
          data: { firstCommentAt: rejected ? null : attemptedAt, firstCommentError: rejected ? FIRST_COMMENT_REJECTED : 'rebuild:first_comment_uncertain' } });
        if (result.count !== 1) throw new PublishingOperationError('conflict', 'theFirstCommentChangedRefreshThisPostBeforeContinuing', {}, errorText);
        await audit(tx, actor, rejected ? 'publishing.first_comment_rejected' : 'publishing.first_comment_uncertain', input);
      });
      recorded = true;
    } catch { /* The committed attempt still prevents a duplicate if receipt persistence fails. */ }
    return receipt(input, rejected && recorded ? 'ready' : 'needs_review');
  }
  try {
    await saveReceipt(async tx => {
      const result = await tx.postTarget.updateMany({ where: { id: row.id, postId: input.postId, targetId: row.targetId, status: 'published', post: { workspaceId: actor.workspaceId }, remotePostId: row.remotePostId, firstCommentId: null, firstCommentAt: attemptedAt }, data: { firstCommentId: remoteId, firstCommentError: null } });
      if (result.count !== 1) throw new PublishingOperationError('conflict', 'theFirstCommentChangedRefreshThisPostBeforeContinuing', {}, errorText);
      await audit(tx, actor, 'publishing.first_comment_sent', { ...input, remoteId });
    });
    return receipt(input, 'sent');
  } catch {
    return receipt(input, 'needs_review');
  }
}

export async function sendDueFirstComment(actor: PublishingActor, input: Input, now = new Date()): Promise<CommentReceipt> {
  return withPublishingOperation(actor, { postId: input.postId }, context => attemptFirstCommentInOperation({ ...context, dueAt: now, automatic: true }, input));
}

export async function sendFirstComment(actor: PublishingActor, input: Input): Promise<CommentReceipt> {
  return withPublishingOperation(actor, { postId: input.postId }, context => attemptFirstCommentInOperation(context, input));
}

/** A separate human decision; never clears an uncertain attempt or resends the post. */
export async function retryFirstComment(actor: PublishingActor, input: unknown): Promise<CommentReceipt> {
  const errorText = await loadPublishingErrorText();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublishingOperationError('invalid_request', 'chooseOneFailedFirstCommentAndConfirmItsRetry', {}, errorText);
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some(key => !['postId', 'postTargetId', 'confirmation'].includes(key))) throw new PublishingOperationError('invalid_request', 'chooseOneFailedFirstCommentAndConfirmItsRetry', {}, errorText);
  await validId(values.postId);
  await validId(values.postTargetId);
  if (values.confirmation !== `RETRY FIRST COMMENT ${values.postTargetId}`) throw new PublishingOperationError('invalid_request', 'confirmRetryingThisExactFirstComment', {}, errorText);
  const ids = { postId: values.postId as string, postTargetId: values.postTargetId as string };
  return withPublishingOperation(actor, { postId: ids.postId }, context => attemptFirstCommentInOperation({ ...context, retryRejected: true }, ids));
}

/** Explicit human attestation, never a claim of automatic provider verification. */
export async function recordFirstCommentOutcome(actor: PublishingActor, input: Input & { outcome: 'sent' | 'not_sent'; remoteId?: string; confirmation: string }): Promise<CommentReceipt> {
  const errorText = await loadPublishingErrorText();
  if (!['sent', 'not_sent'].includes(input.outcome) || input.confirmation !== `RECORD FIRST COMMENT ${input.postTargetId} ${input.outcome === 'sent' ? 'SENT' : 'NOT SENT'}`) throw new PublishingOperationError('invalid_request', 'confirmThisExactFirstcommentOutcome', {}, errorText);
  if (input.outcome === 'sent') await validId(input.remoteId, 'Enter a valid platform comment ID.');
  return withPublishingOperation(actor, { postId: input.postId }, async context => {
    const row = await delivery(context, input);
    if (row.firstCommentId) {
      if (input.outcome === 'sent' && row.firstCommentId === input.remoteId) return receipt({ postId: input.postId, postTargetId: input.postTargetId }, 'sent');
      throw new PublishingOperationError('conflict', 'thisFirstCommentAlreadyHasARecordedOutcome', {}, errorText);
    }
    if (firstCommentState(row.post.firstComment, row) !== 'needs_review') throw new PublishingOperationError('conflict', 'thisFirstCommentHasNoUncertainAttemptToReview', {}, errorText);
    await withPublishingTransaction(context.signal, async tx => {
      const result = await tx.postTarget.updateMany({ where: { id: row.id, postId: input.postId, firstCommentId: null, firstCommentAt: row.firstCommentAt, firstCommentError: row.firstCommentError },
        data: input.outcome === 'sent' ? { firstCommentId: input.remoteId!, firstCommentAt: row.firstCommentAt ?? new Date(), firstCommentError: null } : { firstCommentId: null, firstCommentAt: null, firstCommentError: null } });
      if (result.count !== 1) throw new PublishingOperationError('conflict', 'theFirstCommentChangedRefreshThisPostBeforeContinuing', {}, errorText);
      await audit(tx, actor, 'publishing.first_comment_outcome_recorded', { postId: input.postId, postTargetId: input.postTargetId, outcome: input.outcome, verification: 'external_human_attestation', previousAttemptAt: row.firstCommentAt?.toISOString() ?? null, ...(input.outcome === 'sent' ? { remoteId: input.remoteId } : {}) });
    });
    return receipt({ postId: input.postId, postTargetId: input.postTargetId }, input.outcome === 'sent' ? 'sent' : 'ready');
  });
}

async function audit(tx: Prisma.TransactionClient, actor: PublishingActor, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}
