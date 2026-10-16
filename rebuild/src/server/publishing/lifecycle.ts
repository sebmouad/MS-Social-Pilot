import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { platformFor } from '@/server/platforms/registry';
import { runtimeConfig } from '@/server/config/store';
import { hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import type { PlatformAdapter, PublishMedia } from '@/platforms/types';
import { resolveCsvDestinationIds } from '@/lib/publishing/csv-destinations';
import { readWorkspaceImage } from '@/server/media/storage';
import { isValidTimeZone, wallTimeToInstant } from '@/lib/calendar-dates';
import { withPublishingOperation, withPublishingTransaction as publishingTransaction } from '@/modules/publishing/server/guard';
import { OperationError } from '@/lib/operation-error';
import { attemptFirstCommentInOperation } from '@/modules/publishing/server/first-comment';

export type PublishingActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] };
const WRITERS = new Set(['owner', 'admin', 'editor', 'contributor']);
const MANAGERS = new Set(['owner', 'admin', 'editor']);
type PublishingLimits = { maxText: number; maxImportRows: number; maxImportBytes: number; maxTargets: number; maxMedia: number; maxAlt: number };

async function limits(): Promise<PublishingLimits> {
  const [maxText, maxImportRows, maxImportBytes, maxTargets, maxMedia, maxAlt] = await Promise.all([
    runtimeConfig('publishing.maxMessageCharacters'), runtimeConfig('publishing.maxImportRows'),
    runtimeConfig('publishing.maxImportBytes'), runtimeConfig('publishing.maxTargetsPerPost'), runtimeConfig('publishing.maxRemoteMediaPerPost'), runtimeConfig('publishing.maxImageAltCharacters'),
  ]);
  return { maxText: Number(maxText), maxImportRows: Number(maxImportRows), maxImportBytes: Number(maxImportBytes), maxTargets: Number(maxTargets), maxMedia: Number(maxMedia), maxAlt: Number(maxAlt) };
}

type PostAttachments = { link?: string; media?: PublishMedia[] };
const MEDIA_REFERENCE = /^media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function storedImageId(media: PublishMedia): string | null {
  return media.kind === 'image' ? MEDIA_REFERENCE.exec(media.url)?.[1] ?? null : null;
}

export function validatePostAttachments(input: PostAttachments, maxMedia: number, maxAlt: number) {
  const secureUrl = (value: string) => {
    let parsed: URL;
    try { parsed = new URL(value); }
    catch { throw new OperationError('invalid_request', 'Attachments require a public HTTPS URL without credentials.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new OperationError('invalid_request', 'Attachments require a public HTTPS URL without credentials.');
    return parsed.toString();
  };
  const link = input.link?.trim() ? secureUrl(input.link.trim()) : null;
  const media = input.media ?? [];
  if (media.length > maxMedia || media.some(item => !item || (item.kind !== 'image' && item.kind !== 'video') || typeof item.url !== 'string')) throw new OperationError('invalid_request', `Choose up to ${maxMedia} supported media attachments.`);
  if (media.some(item => item.altText?.trim() && item.altText.trim().length > maxAlt)) throw new OperationError('invalid_request', `Image descriptions must be ${maxAlt} characters or fewer.`);
  if ((link && media.length) || (media.some(item => item.kind === 'image') && media.some(item => item.kind === 'video'))) throw new OperationError('invalid_request', 'Choose a link, images, or a video; these formats cannot be combined in one post.');
  return { link, media: media.map(item => ({ kind: item.kind, url: storedImageId(item) ? item.url : secureUrl(item.url), ...(item.altText?.trim() ? { altText: item.altText.trim() } : {}) })) };
}

async function resolvePublishMedia(workspaceId: string, media: PublishMedia[]): Promise<PublishMedia[]> {
  return Promise.all(media.map(async item => {
    const id = storedImageId(item);
    if (!id) return item;
    const file = await readWorkspaceImage(workspaceId, id);
    return { ...item, localFile: file };
  }));
}

export function assertLocalImageLimits(adapter: Pick<PlatformAdapter, 'localImageUpload'>, media: PublishMedia[]) {
  for (const item of media) {
    if (!item.localFile) continue;
    const limits = adapter.localImageUpload;
    if (!limits || item.localFile.bytes.byteLength > limits.maxBytes || !limits.mimeTypes.includes(item.localFile.mimeType)) {
      throw new OperationError('invalid_request', 'A selected destination cannot publish this uploaded image. Choose an image within its supported type and size.');
    }
  }
}

async function membership(actor: PublishingActor) {
  const result = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!result) throw new OperationError('unauthorized', 'You are no longer a member of this workspace.');
  if (!WRITERS.has(result.role)) throw new OperationError('forbidden', 'You do not have permission to manage posts.');
  return result;
}

function validText(value: string, maxText: number) {
  const text = value.trim();
  if (!text || text.length > maxText) throw new OperationError('invalid_request', `Post text must be between 1 and ${maxText.toLocaleString()} characters.`);
  return text;
}

function validFirstComment(value: string, maxText: number) {
  const text = value.trim();
  if (text.length > maxText) throw new OperationError('invalid_request', `First comment must be ${maxText.toLocaleString()} characters or fewer.`);
  return text || null;
}

async function validateTargets(actor: PublishingActor, ids: string[], maxTargets: number, media: PublishMedia[] = [], firstCommentRequested = false) {
  if (ids.length > maxTargets || new Set(ids).size !== ids.length) throw new OperationError('invalid_request', `Choose up to ${maxTargets} distinct destinations.`);
  if (actor.allowedTargetIds && ids.some(id => !actor.allowedTargetIds!.includes(id))) throw new OperationError('forbidden', 'One or more destinations are outside your channel access.');
  if (!ids.length) return [];
  const targets = await prisma.target.findMany({
    where: { id: { in: ids }, workspaceId: actor.workspaceId, enabled: true, canPublish: true },
    select: { id: true, type: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true } } },
  });
  if (targets.length !== ids.length) throw new OperationError('unavailable', 'One or more destinations are unavailable or cannot publish.');
  const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
  if (!entitlements) throw new OperationError('unavailable', 'This workspace is unavailable.');
  for (const target of targets) {
    const provider = target.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'publishing') : null;
    if (!provider || !hasPlatformCapability(entitlements, provider) || !adapter?.publish || !adapter.supportsTargetKind?.(target.type, 'publishing') || target.socialAccount?.invalidatedAt || !target.accessToken) {
      throw new OperationError('unavailable', 'One or more destinations are unavailable or cannot publish.');
    }
    if (firstCommentRequested && !adapter.publishFirstComment) throw new OperationError('invalid_request', 'A selected destination cannot add a first comment. Clear the comment or choose another destination.');
    assertLocalImageLimits(adapter, media);
  }
  return targets;
}

async function assertPostScope(actor: PublishingActor, postId: string) {
  if (!actor.allowedTargetIds) return;
  const rows = await prisma.postTarget.findMany({ where: { postId, post: { workspaceId: actor.workspaceId } }, select: { targetId: true } });
  if (rows.some(row => !actor.allowedTargetIds!.includes(row.targetId))) throw new OperationError('forbidden', 'This post is unavailable in your channel scope.');
}

function canManage(role: string, authorId: string, userId: string) {
  return MANAGERS.has(role) || authorId === userId;
}

/** Submit an authored draft for review. */
export async function submitPostForApproval(actor: PublishingActor, postId: string) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, postId);
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, targets: { select: { id: true } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || !['draft', 'rejected'].includes(post.status) || !post.targets.length) throw new OperationError('conflict', 'This post cannot be submitted for approval.');
      await tx.post.update({ where: { id: post.id }, data: { status: 'pending_approval', scheduledAt: null, updatedAt: new Date() } });
      await audit(tx, actor, 'publishing.post_submitted_for_approval', { postId: post.id });
    });
  });
}

/** Reviewers may approve to draft or reject; clients cannot review their own posts. */
export async function reviewPost(actor: PublishingActor, postId: string, decision: 'approve' | 'reject', note?: string) {
  return withPublishingOperation(actor, { postId, feature: 'publishing/approvals' }, async ({ actor, signal, lockTargets }) => {
    const reviewNote = (note ?? '').trim();
    if (reviewNote.length > 500) throw new OperationError('invalid_request', 'Keep the review note to 500 characters or fewer.');
    const member = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
    if (!member || !['owner', 'admin', 'editor', 'client'].includes(member.role)) throw new OperationError('forbidden', 'You do not have permission to review posts.');
    if (member.role === 'client') {
      const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { authorId: true } });
      if (post?.authorId === actor.userId) throw new OperationError('forbidden', 'You cannot review your own post.');
    }
    await assertPostScope(actor, postId);
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, status: true } });
      if (!post || post.status !== 'pending_approval') throw new OperationError('conflict', 'This post is no longer awaiting approval.');
      const status = decision === 'approve' ? 'draft' : 'rejected';
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'pending_approval' }, data: { status, updatedAt: new Date() } });
      if (changed.count !== 1) throw new OperationError('conflict', 'This post is no longer awaiting approval.');
      await audit(tx, actor, decision === 'approve' ? 'publishing.post_approved' : 'publishing.post_rejected', { postId: post.id, ...(reviewNote ? { note: reviewNote } : {}) });
    });
  });
}

/** Schedule a local queued post for a future time. */
export async function schedulePost(actor: PublishingActor, postId: string, scheduledAt: Date) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, postId);
    if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new OperationError('invalid_request', 'Choose a future publishing time.');
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, targets: { select: { status: true } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || !['draft', 'rejected'].includes(post.status) || !post.targets.length || post.targets.some(target => target.status !== 'pending')) throw new OperationError('conflict', 'This post cannot be scheduled.');
      await tx.post.update({ where: { id: post.id }, data: { status: 'scheduled', scheduledAt, updatedAt: new Date() } });
      await audit(tx, actor, 'publishing.post_scheduled', { postId: post.id, scheduledAt: scheduledAt.toISOString() });
    });
  });
}

export type RescheduleInput = { postId: string; date: string; time: string; timeZone: string };

/**
 * Move a still-local scheduled post to a new workspace-local date and time.
 * The wall-clock time is interpreted in the workspace time zone (DST-aware) and
 * must be in the future. Posts already handed to the platform cannot be moved.
 */
export async function reschedulePost(actor: PublishingActor, input: RescheduleInput) {
  return withPublishingOperation(actor, { postId: input.postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, input.postId);
    if (!isValidTimeZone(input.timeZone)) throw new OperationError('unavailable', 'This workspace has no valid time zone.');
    const resolved = wallTimeToInstant(input.date, input.time, input.timeZone);
    if (!resolved.ok) throw new OperationError('invalid_request', resolved.reason === 'skipped' ? 'That time does not exist on that day because the clocks change. Choose another time.' : 'Choose a valid date and time.');
    const scheduledAt = resolved.instant;
    if (scheduledAt.getTime() <= Date.now()) throw new OperationError('invalid_request', 'Choose a future publishing time.');
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, scheduledAt: true, targets: { select: { status: true, remotePostId: true } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId)) throw new OperationError('conflict', 'This post cannot be rescheduled.');
      if (post.status !== 'scheduled' || post.targets.some(target => target.status !== 'pending' || target.remotePostId)) throw new OperationError('conflict', 'Only posts that are still waiting to publish can be rescheduled.');
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'scheduled' }, data: { scheduledAt, updatedAt: new Date() } });
      if (changed.count !== 1) throw new OperationError('conflict', 'Only posts that are still waiting to publish can be rescheduled.');
      await audit(tx, actor, 'publishing.post_rescheduled', { postId: post.id, from: post.scheduledAt?.toISOString() ?? null, to: scheduledAt.toISOString() });
    });
    return { scheduledAt };
  });
}

/** Cancel a locally queued post back to draft while it is still pending delivery. */
export async function cancelScheduledPost(actor: PublishingActor, postId: string) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, postId);
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, targets: { select: { status: true, remotePostId: true } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || post.status !== 'scheduled' || post.targets.some(target => target.status !== 'pending' || target.remotePostId)) throw new OperationError('conflict', 'This queued post can no longer be cancelled locally.');
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'scheduled' }, data: { status: 'draft', scheduledAt: null, updatedAt: new Date() } });
      if (changed.count !== 1) throw new OperationError('conflict', 'This queued post can no longer be cancelled locally.');
      await audit(tx, actor, 'publishing.post_schedule_cancelled', { postId: post.id });
    });
  });
}

export async function createPost(actor: PublishingActor, input: { message: string; firstComment: string; targetIds: string[]; scheduledAt?: Date } & PostAttachments) {
  return withPublishingOperation(actor, { targetIds: input.targetIds }, async ({ actor, signal, lockTargets }) => {
    await membership(actor);
    const config = await limits();
    const text = validText(input.message, config.maxText);
    const firstComment = validFirstComment(input.firstComment, config.maxText);
    const attachments = validatePostAttachments(input, config.maxMedia, config.maxAlt);
    const uploadMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
    const targets = await validateTargets(actor, input.targetIds, config.maxTargets, uploadMedia, Boolean(firstComment));
    if (input.scheduledAt && (!Number.isFinite(input.scheduledAt.getTime()) || input.scheduledAt.getTime() <= Date.now() || !targets.length)) throw new OperationError('invalid_request', 'Choose a future publishing time and at least one destination.');
    const now = new Date();
    const id = randomUUID();
    await publishingTransaction(signal, async tx => {
      await tx.post.create({ data: { id, workspaceId: actor.workspaceId, authorId: actor.userId, message: text, firstComment, link: attachments.link, media: attachments.media, status: input.scheduledAt ? 'scheduled' : 'draft', scheduledAt: input.scheduledAt ?? null, publishedAt: null, createdAt: now, updatedAt: now,
        targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, status: 'pending' as const })) } } });
      await audit(tx, actor, 'publishing.post_created', { postId: id, targetCount: targets.length });
      if (input.scheduledAt) await audit(tx, actor, 'publishing.post_scheduled', { postId: id, scheduledAt: input.scheduledAt.toISOString() });
    });
    return { id };
  });
}

export async function updatePost(actor: PublishingActor, input: { postId: string; message: string; firstComment: string; targetIds: string[] } & PostAttachments) {
  return withPublishingOperation(actor, { postId: input.postId, targetIds: input.targetIds }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, input.postId);
    const config = await limits();
    const text = validText(input.message, config.maxText);
    const firstComment = validFirstComment(input.firstComment, config.maxText);
    const attachments = validatePostAttachments(input, config.maxMedia, config.maxAlt);
    const uploadMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
    const targets = await validateTargets(actor, input.targetIds, config.maxTargets, uploadMedia, Boolean(firstComment));
    await publishingTransaction(signal, async tx => {
      const existing = await tx.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, publishedAt: true, targets: { select: { id: true, status: true, remotePostId: true } } } });
      if (!existing || (role.role === 'contributor' && existing.authorId !== actor.userId)) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
      if (existing.publishedAt || ['publishing', 'published', 'partially_failed', 'scheduled'].includes(existing.status) || existing.targets.some(target => target.remotePostId || target.status === 'processing' || target.status === 'published' || target.status === 'scheduled_remote')) throw new OperationError('conflict', 'This post can no longer be edited.');
      await tx.postTarget.deleteMany({ where: { postId: existing.id } });
      await tx.post.update({ where: { id: existing.id }, data: { message: text, firstComment, link: attachments.link, media: attachments.media, updatedAt: new Date(), targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, status: 'pending' as const })) } } });
      await audit(tx, actor, 'publishing.post_updated', { postId: existing.id, targetCount: targets.length });
    });
  });
}

/** Shared durable deletion service owns dispatch, receipts and local recovery. */
export { deletePostDurably as deletePost } from '@/modules/publishing/server/deletion';

/** Claim each destination before the provider call. `processing` remains as a manual-reconciliation marker on ambiguous failures. */
export async function publishPost(actor: PublishingActor, postId: string, expectedScheduledAt?: Date) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, postId);
    const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, message: true, firstComment: true, link: true, media: true, status: true, scheduledAt: true, targets: { select: { id: true, status: true, remotePostId: true, target: { select: { id: true, type: true, providerId: true, canPublish: true, enabled: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true } } } } } } } });
    if (expectedScheduledAt !== undefined && (!post || post.status !== 'scheduled' || !post.scheduledAt || post.scheduledAt.getTime() !== expectedScheduledAt.getTime())) return { published: 0, failed: 0, needsReconciliation: 0, firstCommentsNeedingReview: 0, firstCommentsNotSent: 0, skipped: true };
    if (!post || !canManage(role.role, post.authorId, actor.userId)) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
    if (!['draft', 'scheduled', 'failed', 'partially_failed'].includes(post.status)) throw new OperationError('conflict', 'This post cannot be published in its current state.');
    if (post.status === 'scheduled' && (!post.scheduledAt || post.scheduledAt > new Date())) throw new OperationError('conflict', 'This post is scheduled for a future time.');
    if (!post.targets.length) throw new OperationError('invalid_request', 'Select at least one destination before publishing.');
    if (!Array.isArray(post.media)) throw new OperationError('invalid_request', 'Stored post media needs review before publishing.');
    const attachments = validatePostAttachments({ link: post.link ?? undefined, media: post.media as unknown as PublishMedia[] }, Number(await runtimeConfig('publishing.maxRemoteMediaPerPost')), Number(await runtimeConfig('publishing.maxImageAltCharacters')));
    const publishMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
    const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
    if (!entitlements) throw new OperationError('unavailable', 'This workspace is unavailable.');
    if (publishMedia.some(item => item.localFile)) {
      for (const item of post.targets) {
        if (item.status === 'published' || item.remotePostId || !['pending', 'failed'].includes(item.status)) continue;
        const provider = item.target.socialAccount?.provider;
        const adapter = provider ? await platformFor(provider, 'publishing') : null;
        if (adapter) assertLocalImageLimits(adapter, publishMedia);
      }
    }
    let published = 0;
    let failed = 0;
    let pending = 0;
    let firstCommentsNeedingReview = 0;
    let firstCommentsNotSent = 0;
    for (const item of post.targets) {
      if (item.status === 'published' || item.remotePostId) { published++; continue; }
      if (item.status === 'processing') { pending++; continue; }
      if (!['pending', 'failed'].includes(item.status)) { failed++; continue; }
      const provider = item.target.socialAccount?.provider;
      const adapter = provider ? await platformFor(provider, 'publishing') : null;
      const eligible = Boolean(provider && hasPlatformCapability(entitlements, provider) && adapter?.publish && (!post.firstComment?.trim() || adapter.publishFirstComment) && adapter.supportsTargetKind?.(item.target.type, 'publishing') && item.target.enabled && item.target.canPublish && item.target.accessToken && !item.target.socialAccount?.invalidatedAt);
      if (!eligible) { failed++; await markTarget(actor, item.id, 'failed', signal); continue; }
      const claim = await publishingTransaction(signal, async tx => tx.postTarget.updateMany({ where: { id: item.id, postId: post.id, status: item.status, remotePostId: null }, data: { status: 'processing' } }));
      if (claim.count !== 1) { pending++; continue; }
      let result: import('@/platforms/types').PublishResult;
      try {
        signal.throwIfAborted();
        result = await adapter!.publish!({ credential: { accessToken: decryptSecret(item.target.accessToken!) }, target: { id: item.target.providerId, name: '', kind: item.target.type }, text: post.message, link: attachments.link, media: publishMedia, signal });
      } catch (error) {
        if (adapter!.classifyPublishingFailure?.(error) === 'rejected') { await markTarget(actor, item.id, 'failed', signal); failed++; }
        else pending++;
        continue;
      }
      try {
        const maxId = await runtimeConfig('publishing.identifierMaxCharacters');
        if (!result || typeof result.remoteId !== 'string' || !result.remoteId.trim() || result.remoteId !== result.remoteId.trim() || result.remoteId.length > maxId || /[\u0000-\u001f\u007f]/.test(result.remoteId)) throw new Error('Unconfirmed publish receipt.');
        await publishingTransaction(signal, async tx => {
          await tx.postTarget.update({ where: { id: item.id }, data: { status: 'published', remotePostId: result.remoteId, remoteUrl: result.url, publishedAt: new Date() } });
          await audit(tx, actor, 'publishing.target_published', { postId: post.id, postTargetId: item.id });
        });
      } catch {
        // The provider receipt was not durably recorded. Never dispatch the comment or create another post.
        pending++;
        continue;
      }
      published++;
      if (post.firstComment?.trim()) {
        try {
          const comment = await attemptFirstCommentInOperation({ actor, role: role.role, signal }, { postId: post.id, postTargetId: item.id });
          if (comment.state === 'needs_review') firstCommentsNeedingReview++;
          else if (comment.state === 'ready') firstCommentsNotSent++;
        } catch {
          // Publication is already committed; comment readiness/failure must never turn it into a failed create.
          firstCommentsNeedingReview++;
        }
      }
    }
    const status = pending ? (published ? 'partially_failed' : 'publishing') : failed ? (published ? 'partially_failed' : 'failed') : 'published';
    await publishingTransaction(signal, async tx => {
      await tx.post.update({ where: { id: post.id }, data: { status, publishedAt: published && !pending && !failed ? new Date() : undefined, updatedAt: new Date() } });
      await audit(tx, actor, 'publishing.publish_finished', { postId: post.id, published, failed, needsReconciliation: pending, firstCommentsNeedingReview, firstCommentsNotSent });
    });
    return { published, failed, needsReconciliation: pending, firstCommentsNeedingReview, firstCommentsNotSent, skipped: false };
  });
}

export async function syncPostStatus(actor: PublishingActor, postId: string) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, postId);
    const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, targets: { select: { id: true, status: true, remotePostId: true, target: { select: { type: true, accessToken: true, socialAccount: { select: { provider: true, scopes: true, invalidatedAt: true } } } } } } } });
    if (!post || !canManage(role.role, post.authorId, actor.userId)) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
    const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
    if (!entitlements) throw new OperationError('unavailable', 'This workspace is unavailable.');
    let synced = 0;
    for (const item of post.targets) {
      const provider = item.target.socialAccount?.provider;
      const adapter = provider ? await platformFor(provider, 'remoteStatus') : null;
      const grantedScopes = (item.target.socialAccount?.scopes ?? '').split(',').map(scope => scope.trim()).filter(Boolean);
      if (!item.remotePostId || !provider || !hasPlatformCapability(entitlements, provider) || !adapter?.getRemoteStatus || !item.target.accessToken || item.target.socialAccount?.invalidatedAt) continue;
      const credential = { accessToken: decryptSecret(item.target.accessToken), grantedScopes };
      if (adapter.canUseCredential?.(credential, 'remoteStatus') === false) continue;
      signal.throwIfAborted();
      const status = await adapter.getRemoteStatus({ credential, remoteId: item.remotePostId, signal });
      if (status.state === 'unknown') continue;
      await publishingTransaction(signal, async tx => {
        await tx.postTarget.update({ where: { id: item.id }, data: { status: status.state === 'published' ? 'published' : 'scheduled_remote', ...(status.publishedAt ? { publishedAt: status.publishedAt } : {}) } });
        await audit(tx, actor, 'publishing.target_status_synced', { postId: post.id, postTargetId: item.id, state: status.state });
      });
      synced++;
    }
    if (synced === 0) return { synced };
    const counts = await prisma.postTarget.groupBy({ by: ['status'], where: { postId: post.id }, _count: true });
    const published = counts.find(row => row.status === 'published')?._count ?? 0;
    const scheduled = counts.find(row => row.status === 'scheduled_remote')?._count ?? 0;
    const failed = counts.find(row => row.status === 'failed')?._count ?? 0;
    const processing = counts.find(row => row.status === 'processing')?._count ?? 0;
    const overall = processing ? (published + scheduled ? 'partially_failed' : 'publishing') : published + scheduled === post.targets.length ? (scheduled ? 'scheduled' : 'published') : published ? 'partially_failed' : failed ? 'failed' : post.status;
    await publishingTransaction(signal, async tx => {
      await tx.post.update({ where: { id: post.id }, data: { status: overall, ...(published ? { publishedAt: new Date() } : {}), updatedAt: new Date() } });
      await audit(tx, actor, 'publishing.post_status_synced', { postId: post.id, targetsSynced: synced });
    });
    return { synced };
  });
}

/** Strict CSV with readable, semicolon-separated channel labels. */
export async function importPostsCsv(actor: PublishingActor, csv: string) {
  return withPublishingOperation(actor, {}, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    if (!MANAGERS.has(role.role)) throw new OperationError('forbidden', 'Only workspace managers can import batches of posts.');
    const config = await limits();
    if (new TextEncoder().encode(csv).length > config.maxImportBytes) throw new OperationError('invalid_request', `CSV file must be ${Math.ceil(config.maxImportBytes / 1024)} KiB or smaller.`);
    const rows = parsePublishingCsv(csv);
    if (rows.length < 2 || rows.length > config.maxImportRows + 1) throw new OperationError('invalid_request', `CSV must include a header and contain at most ${config.maxImportRows} posts.`);
    const header = rows[0]!.map(value => value.trim());
    if (header.length !== 3 || header[0] !== 'message' || header[1] !== 'firstComment' || header[2] !== 'channels') throw new OperationError('invalid_request', 'CSV header must be message,firstComment,channels.');
    const available = await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, enabled: true, canPublish: true, ...(actor.allowedTargetIds ? { id: { in: [...actor.allowedTargetIds] } } : {}) }, select: { id: true, name: true, type: true, socialAccount: { select: { provider: true } } } });
    const choices = available.map(target => ({ id: target.id, name: target.name, type: target.type, provider: target.socialAccount?.provider ?? null }));
    const inputs = rows.slice(1).map((row, index) => {
      if (row.length !== 3) throw new OperationError('invalid_request', `CSV row ${index + 2} must have exactly three columns.`);
      return { message: validText(row[0]!, config.maxText), firstComment: validFirstComment(row[1]!, config.maxText), targetIds: resolveCsvDestinationIds(row[2]!, choices, index + 2) };
    });
    await lockTargets([...new Set(inputs.flatMap(input => input.targetIds))]);
    for (const input of inputs) await validateTargets(actor, input.targetIds, config.maxTargets, [], Boolean(input.firstComment));
    const targetCount = new Set(inputs.flatMap(row => row.targetIds)).size;
    const now = new Date();
    const ids = inputs.map(() => randomUUID());
    await publishingTransaction(signal, async tx => {
      for (const [index, input] of inputs.entries()) await tx.post.create({ data: { id: ids[index]!, workspaceId: actor.workspaceId, authorId: actor.userId, message: input.message, firstComment: input.firstComment, status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
        targets: { create: input.targetIds.map(targetId => ({ id: randomUUID(), targetId, status: 'pending' as const })) } } });
      await audit(tx, actor, 'publishing.posts_imported', { postCount: ids.length, targetCount });
    });
    return { count: ids.length };
  });
}

export function parsePublishingCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (closedQuote && char !== ',' && char !== '\n' && char !== '\r') throw new OperationError('invalid_request', 'CSV has characters after a closing quote.');
    else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; closedQuote = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = []; closedQuote = false;
    } else cell += char;
  }
  if (quoted) throw new OperationError('invalid_request', 'CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

async function markTarget(actor: PublishingActor, id: string, status: 'failed', signal: AbortSignal) {
  await publishingTransaction(signal, async tx => {
    await tx.postTarget.updateMany({ where: { id, post: { workspaceId: actor.workspaceId }, status: { in: ['pending', 'failed', 'processing'] }, remotePostId: null }, data: { status } });
    await audit(tx, actor, 'publishing.target_failed', { postTargetId: id });
  });
}

async function audit(tx: Prisma.TransactionClient, actor: PublishingActor, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`pub_${randomBytes(12).toString('hex')}`}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}
