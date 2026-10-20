import { prepareVersionRestore } from './version-restore';
import type { RestoreOptions } from './version-restore-plan';
import type { VersionSnapshot } from '../collaboration/ports';
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { enqueueEmptyQueueNotifications } from './notification-events';
import { resolveAuthorizedDestinationFormats } from '@/modules/publishing/server/formats';
import { validateSelectedPublishingFormat } from '@/modules/publishing/formats';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { platformFor } from '@/server/platforms/registry';
import { runtimeConfig } from '@/server/config/store';
import { hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import type { PlatformAdapter, PublishMedia } from '@/platforms/types';
import { resolveCsvDestinationIds } from '@/lib/publishing/csv-destinations';
import { readWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { isValidTimeZone, wallTimeToInstant } from '@/lib/calendar-dates';
import { withPublishingOperation, withPublishingTransaction as publishingTransaction } from '@/modules/publishing/server/guard';
import { OperationError } from '@/lib/operation-error';
import { parseFirstCommentDelay } from '@/modules/publishing/first-comment-delay';
import { attemptFirstCommentInOperation } from '@/modules/publishing/server/first-comment';
import { readPublishingCredential } from '@/modules/publishing/server/credentials';
import { publishDestinationInOperation } from '@/modules/publishing/server/publication';
import { assertPublishingMediaSupport } from '@/modules/publishing/media-support';
import { needsContributorApproval } from '@/modules/settings/workspace-policy';
import { preparePublicationLinks } from './short-links';
import { loadWorkspaceOperations } from '@/modules/settings/server/workspace-operations';
import { recordPostVersion, loadVersionRetention } from '@/modules/publishing/collaboration/server/versions';

export type PublishingActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] };
const WRITERS = new Set(['owner', 'admin', 'editor', 'contributor']);
const MANAGERS = new Set(['owner', 'admin', 'editor']);
type PublishingLimits = { maxText: number; maxImportRows: number; maxImportBytes: number; maxTargets: number; maxMedia: number; maxAlt: number };

export async function limits(): Promise<PublishingLimits> {
  const [maxText, maxImportRows, maxImportBytes, maxTargets, maxMedia, maxAlt] = await Promise.all([
    runtimeConfig('publishing.maxMessageCharacters'), runtimeConfig('publishing.maxImportRows'),
    runtimeConfig('publishing.maxImportBytes'), runtimeConfig('publishing.maxTargetsPerPost'), runtimeConfig('publishing.maxRemoteMediaPerPost'), runtimeConfig('publishing.maxImageAltCharacters'),
  ]);
  return { maxText: Number(maxText), maxImportRows: Number(maxImportRows), maxImportBytes: Number(maxImportBytes), maxTargets: Number(maxTargets), maxMedia: Number(maxMedia), maxAlt: Number(maxAlt) };
}

type PostAttachments = { link?: string; media?: PublishMedia[]; destinationFormats?: unknown; firstCommentDelayMinutes?: unknown };
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
  if (!Array.isArray(media)) throw new OperationError('invalid_request', 'Choose valid media attachments.');
  if (media.length > maxMedia || media.some(item => !item || (item.kind !== 'image' && item.kind !== 'video') || typeof item.url !== 'string')) throw new OperationError('invalid_request', `Choose up to ${maxMedia} supported media attachments.`);
  if (media.some(item => item.altText !== undefined && typeof item.altText !== 'string')) throw new OperationError('invalid_request', 'Choose a valid image description.');
  if (media.some(item => item.altText?.trim() && item.altText.trim().length > maxAlt)) throw new OperationError('invalid_request', `Image descriptions must be ${maxAlt} characters or fewer.`);
  if (media.some(item => item.kind === 'video' && item.altText?.trim())) throw new OperationError('invalid_request', 'Image descriptions can only be used with images.');
  return { link, media: media.map(item => ({ kind: item.kind, url: storedImageId(item) ? item.url : secureUrl(item.url), ...(item.kind === 'image' && item.altText?.trim() ? { altText: item.altText.trim() } : {}) })) };
}

export async function resolvePublishMedia(workspaceId: string, media: PublishMedia[]): Promise<PublishMedia[]> {
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

/** Read the existing workspace approval switch through the legacy-compatible SQL view. */
async function workspaceRequiresApproval(workspaceId: string) {
  const rows = await prisma.$queryRaw<Array<{ requiresApproval: boolean }>>`SELECT "requiresApproval" FROM workspaces WHERE id = ${workspaceId}`;
  if (!rows[0] || typeof rows[0].requiresApproval !== 'boolean') throw new OperationError('unavailable', 'Workspace publishing policy is unavailable.');
  return rows[0].requiresApproval;
}
async function setApprovalPending(tx: Prisma.TransactionClient, actor: PublishingActor, postId: string) {
  await tx.$executeRaw`UPDATE posts SET "approvalStatus" = 'pending', "submittedById" = ${actor.userId}, "submittedAt" = NOW(), "reviewedById" = NULL, "reviewedAt" = NULL, "reviewNote" = NULL WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId}`;
  await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'approval_request', postId });
}

export function validText(value: string, maxText: number) {
  const text = value.trim();
  if (!text || text.length > maxText) throw new OperationError('invalid_request', `Post text must be between 1 and ${maxText.toLocaleString()} characters.`);
  return text;
}

/** Normalize post text while allowing attachment-only content. First comments
 * are deliberately excluded: they cannot make an otherwise empty post valid. */
export function validatePostContent(value: string, maxText: number, attachments: { link?: string | null; media?: readonly unknown[] }) {
  const text = value.trim();
  if (text.length > maxText) throw new OperationError('invalid_request', `Post text must be between 1 and ${maxText.toLocaleString()} characters.`);
  if (!text && !attachments.link?.trim() && !attachments.media?.length) throw new OperationError('invalid_request', 'Add post text, a link, or media before saving.');
  return text;
}

export function validFirstComment(value: string, maxText: number) {
  const text = value.trim();
  if (text.length > maxText) throw new OperationError('invalid_request', `First comment must be ${maxText.toLocaleString()} characters or fewer.`);
  return text || null;
}

export async function validateTargets(actor: PublishingActor, ids: string[], maxTargets: number, media: PublishMedia[] = [], firstCommentRequested = false, link?: string | null, formatId?: string, scheduled = false) {
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
    if (formatId !== undefined) validateSelectedPublishingFormat(adapter.publishingFormats, formatId, { media, link, firstComment: firstCommentRequested ? 'requested' : undefined, scheduled });
    assertPublishingMediaSupport(adapter, media, link);
    assertLocalImageLimits(adapter, media);
  }
  return targets;
}

async function assertStoredPostMediaCompatible(workspaceId: string, post: {
  message?: string | null; firstComment?: string | null; link?: string | null; media?: unknown; format?: string;
  targets: Array<{ status: string; formatId?: string | null; target?: { socialAccount?: { provider?: string | null } | null } }>;
}) {
  if (post.media !== undefined && !Array.isArray(post.media)) throw new OperationError('invalid_request', 'Stored post attachments need review before scheduling.');
  const config = await limits();
  const attachments = validatePostAttachments({ link: post.link ?? undefined, media: (post.media ?? []) as PublishMedia[] }, config.maxMedia, config.maxAlt);
  validatePostContent(post.message ?? '', config.maxText, attachments);
  const resolved = await resolvePublishMedia(workspaceId, attachments.media);
  for (const destination of post.targets) {
    if (destination.status !== 'pending') continue;
    const provider = destination.target?.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'publishing') : null;
    validateSelectedPublishingFormat(adapter?.publishingFormats, destination.formatId ?? post.format, { media: resolved, link: attachments.link, firstComment: post.firstComment, scheduled: true });
    assertPublishingMediaSupport(adapter ?? { publishingMedia: undefined } as PlatformAdapter, resolved, attachments.link);
    assertLocalImageLimits(adapter ?? {}, resolved);
  }
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
      await setApprovalPending(tx, actor, post.id);
      await audit(tx, actor, 'publishing.post_submitted_for_approval', { postId: post.id });
    });
  });
}

export type ReviewDecision = 'approve' | 'reject';
/** Facts about the review, passed read-only to participant callbacks. */
export type ReviewParticipantContext = Readonly<{
  actor: Readonly<PublishingActor>;
  postId: string;
  decision: ReviewDecision;
  /** Trimmed review note, or null when none was given. */
  note: string | null;
  /** Post state read inside the review transaction, before mutation. */
  post: Readonly<{ id: string; status: string; scheduledAt: Date | null }>;
  /** Status the post takes if the review commits. */
  resultingStatus: 'draft' | 'scheduled' | 'rejected';
}>;
/**
 * Optional domain participant that joins a review atomically. Both callbacks
 * receive the review's own publishing transaction client, so their writes commit
 * or roll back together with the status change and audit row. Throwing from
 * either callback aborts the whole review. Callbacks must use only `tx`.
 */
export type ReviewParticipant = {
  /** Runs after Publishing authority and post-state checks, before the post is mutated. Validate/lock external authorization here; throw to refuse. */
  before?(tx: Prisma.TransactionClient, context: ReviewParticipantContext): Promise<void>;
  /** Runs after the post is mutated and before the audit row is written. Record the domain outcome here. */
  after?(tx: Prisma.TransactionClient, context: ReviewParticipantContext): Promise<void>;
};

/** Reviewers may approve to draft or reject; clients cannot review their own posts. An optional participant joins the same transaction. */
export async function reviewPost(actor: PublishingActor, postId: string, decision: ReviewDecision, note?: string, participant?: ReviewParticipant) {
  return withPublishingOperation(actor, { postId, feature: 'publishing/approvals' }, async ({ actor, signal, lockTargets }) => {
    if (decision !== 'approve' && decision !== 'reject') throw new OperationError('invalid_request', 'Choose approve or reject.');
    if (note !== undefined && note !== null && typeof note !== 'string') throw new OperationError('invalid_request', 'Enter a valid review note.');
    if (participant !== undefined && (participant === null || typeof participant !== 'object'
      || (participant.before !== undefined && typeof participant.before !== 'function') || (participant.after !== undefined && typeof participant.after !== 'function'))) {
      throw new OperationError('unavailable', 'Review could not be completed. Try again later.');
    }
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
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, status: true, scheduledAt: true } });
      if (!post || post.status !== 'pending_approval') throw new OperationError('conflict', 'This post is no longer awaiting approval.');
      const status = decision === 'approve' ? (post.scheduledAt ? 'scheduled' : 'draft') : 'rejected';
      const context: ReviewParticipantContext = Object.freeze({
        actor: Object.freeze({ ...actor }), postId: post.id, decision, note: reviewNote || null,
        post: Object.freeze({ id: post.id, status: post.status, scheduledAt: post.scheduledAt }), resultingStatus: status,
      });
      await participant?.before?.(tx, context);
      signal.throwIfAborted();
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'pending_approval' }, data: { status, updatedAt: new Date() } });
      if (changed.count !== 1) throw new OperationError('conflict', 'This post is no longer awaiting approval.');
      await tx.$executeRaw`UPDATE posts SET "approvalStatus" = ${decision === 'approve' ? 'approved' : 'rejected'}::"ApprovalStatus", "reviewedById" = ${actor.userId}, "reviewedAt" = NOW(), "reviewNote" = ${reviewNote || null} WHERE id = ${post.id} AND "workspaceId" = ${actor.workspaceId}`;
      await participant?.after?.(tx, context);
      await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'approval_decision', postId: post.id });
      signal.throwIfAborted();
      await audit(tx, actor, decision === 'approve' ? 'publishing.post_approved' : 'publishing.post_rejected', { postId: post.id, ...(reviewNote ? { note: reviewNote } : {}) });
    });
  });
}

/** Schedule a local queued post for a future time. */
export async function schedulePost(actor: PublishingActor, postId: string, scheduledAt: Date) {
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    const holdForApproval = !MANAGERS.has(role.role) && needsContributorApproval(await workspaceRequiresApproval(actor.workspaceId), role.role);
    await assertPostScope(actor, postId);
    if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new OperationError('invalid_request', 'Choose a future publishing time.');
    const retention = await loadVersionRetention();
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, message: true, firstComment: true, format: true, link: true, media: true, targets: { select: { status: true, formatId: true, target: { select: { socialAccount: { select: { provider: true } } } } } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || !['draft', 'rejected'].includes(post.status) || !post.targets.length || post.targets.some(target => target.status !== 'pending')) throw new OperationError('conflict', 'This post cannot be scheduled.');
      await assertStoredPostMediaCompatible(actor.workspaceId, post);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      await tx.post.update({ where: { id: post.id }, data: { status: holdForApproval ? 'pending_approval' : 'scheduled', scheduledAt, updatedAt: new Date() } });
      if (holdForApproval) await setApprovalPending(tx, actor, post.id);
      await recordPostVersion(tx, post.id, actor.userId, retention);
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
    const retention = await loadVersionRetention();
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, scheduledAt: true, message: true, firstComment: true, format: true, link: true, media: true, targets: { select: { status: true, formatId: true, remotePostId: true, target: { select: { socialAccount: { select: { provider: true } } } } } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId)) throw new OperationError('conflict', 'This post cannot be rescheduled.');
      if (post.status !== 'scheduled' || post.targets.some(target => target.status !== 'pending' || target.remotePostId)) throw new OperationError('conflict', 'Only posts that are still waiting to publish can be rescheduled.');
      await assertStoredPostMediaCompatible(actor.workspaceId, post);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'scheduled' }, data: { scheduledAt, updatedAt: new Date() } });
      if (changed.count !== 1) throw new OperationError('conflict', 'Only posts that are still waiting to publish can be rescheduled.');
      await recordPostVersion(tx, post.id, actor.userId, retention);
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
    const retention = await loadVersionRetention();
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, targets: { select: { status: true, remotePostId: true } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || post.status !== 'scheduled' || post.targets.some(target => target.status !== 'pending' || target.remotePostId)) throw new OperationError('conflict', 'This queued post can no longer be cancelled locally.');
      await recordPostVersion(tx, post.id, actor.userId, retention);
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'scheduled' }, data: { status: 'draft', scheduledAt: null, updatedAt: new Date() } });
      if (changed.count !== 1) throw new OperationError('conflict', 'This queued post can no longer be cancelled locally.');
      await recordPostVersion(tx, post.id, actor.userId, retention);
      await audit(tx, actor, 'publishing.post_schedule_cancelled', { postId: post.id });
    });
  });
}

export async function createPost(actor: PublishingActor, input: { message: string; firstComment: string; targetIds: string[]; scheduledAt?: Date; labelId?: string | null } & PostAttachments) {
  return withPublishingOperation(actor, { targetIds: input.targetIds }, async ({ actor, signal, lockTargets }) => {
    const member = await membership(actor);
    if (input.labelId !== undefined && input.labelId !== null && (!/^[A-Za-z0-9_-]{1,200}$/.test(input.labelId))) throw new OperationError('invalid_request', 'Choose a valid post label.');
    const holdForApproval = Boolean(input.scheduledAt) && !MANAGERS.has(member.role) && needsContributorApproval(await workspaceRequiresApproval(actor.workspaceId), member.role);
    const config = await limits();
    const firstComment = validFirstComment(input.firstComment, config.maxText);
    const firstCommentDelayMinutes = input.firstCommentDelayMinutes === undefined ? undefined : parseFirstCommentDelay(input.firstCommentDelayMinutes, await runtimeConfig('publishing.maxFirstCommentDelayMinutes'));
    const attachments = validatePostAttachments(input, config.maxMedia, config.maxAlt);
    const text = validatePostContent(input.message, config.maxText, attachments);
    const uploadMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
    const targets = await validateTargets(actor, input.targetIds, config.maxTargets, uploadMedia, Boolean(firstComment), attachments.link);
    if (input.scheduledAt && (!Number.isFinite(input.scheduledAt.getTime()) || input.scheduledAt.getTime() <= Date.now() || !targets.length)) throw new OperationError('invalid_request', 'Choose a future publishing time and at least one destination.');
    const destinationFormats = await resolveAuthorizedDestinationFormats(targets, input.destinationFormats, config.maxTargets, { media: uploadMedia, link: attachments.link, firstComment, scheduled: Boolean(input.scheduledAt) });
    const retention = await loadVersionRetention();
    const now = new Date();
    const id = randomUUID();
    await publishingTransaction(signal, async tx => {
      if (input.labelId) {
        const labels = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE id = ${input.labelId} AND "workspaceId" = ${actor.workspaceId} FOR SHARE`;
        if (!labels.length) throw new OperationError('not_found', 'This post label is unavailable in the current workspace.');
      }
      await tx.post.create({ data: { id, workspaceId: actor.workspaceId, authorId: actor.userId, message: text, firstComment, firstCommentDelayMinutes: firstCommentDelayMinutes ?? 0, link: attachments.link, media: attachments.media, status: holdForApproval ? 'pending_approval' : input.scheduledAt ? 'scheduled' : 'draft', scheduledAt: input.scheduledAt ?? null, publishedAt: null, createdAt: now, updatedAt: now,
        targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, formatId: destinationFormats[target.id], status: 'pending' as const })) } } });
      if (input.labelId) await tx.$executeRaw`INSERT INTO post_labels ("postId", "labelId") VALUES (${id}, ${input.labelId})`;
      if (holdForApproval) await setApprovalPending(tx, actor, id);
      await recordPostVersion(tx, id, actor.userId, retention);
      await audit(tx, actor, 'publishing.post_created', { postId: id, targetCount: targets.length });
      if (input.scheduledAt) await audit(tx, actor, 'publishing.post_scheduled', { postId: id, scheduledAt: input.scheduledAt.toISOString() });
    });
    return { id };
  });
}

export async function updatePost(actor: PublishingActor, input: { postId: string; message: string; firstComment: string; targetIds: string[] } & PostAttachments, restoreLabelIds?: readonly string[]) {
  return withPublishingOperation(actor, { postId: input.postId, targetIds: input.targetIds }, async ({ actor, signal }) => {
    return updatePostInOperation(actor, input, signal, restoreLabelIds);
  });
}

async function updatePostInOperation(actor: PublishingActor, input: { postId: string; message: string; firstComment: string; targetIds: string[] } & PostAttachments, signal: AbortSignal, restoreLabelIds?: readonly string[]) {
  const role = await membership(actor);
  await assertPostScope(actor, input.postId);
  const config = await limits();
  const firstComment = validFirstComment(input.firstComment, config.maxText);
  const firstCommentDelayMinutes = input.firstCommentDelayMinutes === undefined ? undefined : parseFirstCommentDelay(input.firstCommentDelayMinutes, await runtimeConfig('publishing.maxFirstCommentDelayMinutes'));
  const attachments = validatePostAttachments(input, config.maxMedia, config.maxAlt);
  const text = validatePostContent(input.message, config.maxText, attachments);
  const uploadMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
  const targets = await validateTargets(actor, input.targetIds, config.maxTargets, uploadMedia, Boolean(firstComment), attachments.link);
  const retention = await loadVersionRetention();
  const restoreLabelLimit = restoreLabelIds ? await runtimeConfig('publishing.collab.labelsPerPostLimit') : null;
  if (restoreLabelIds && (!Number.isSafeInteger(restoreLabelLimit) || Number(restoreLabelLimit) < 1 || Number(restoreLabelLimit) > 100)) throw new OperationError('unavailable', 'Post label limits are temporarily unavailable.');
  const saved = await publishingTransaction(signal, async tx => {
    const existing = await tx.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, format: true, status: true, publishedAt: true, targets: { select: { id: true, targetId: true, formatId: true, status: true, remotePostId: true } } } });
    if (!existing || (role.role === 'contributor' && existing.authorId !== actor.userId)) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
    if (existing.publishedAt || ['publishing', 'published', 'partially_failed', 'scheduled'].includes(existing.status) || existing.targets.some(target => target.remotePostId || target.status === 'processing' || target.status === 'published' || target.status === 'scheduled_remote')) throw new OperationError('conflict', 'This post can no longer be edited.');
    const destinationFormats = await resolveAuthorizedDestinationFormats(targets, input.destinationFormats, config.maxTargets, { media: uploadMedia, link: attachments.link, firstComment }, { formats: new Map(existing.targets.map(target => [target.targetId, target.formatId ?? null])), legacyFormat: existing.format });
    await recordPostVersion(tx, existing.id, actor.userId, retention);
    if (restoreLabelIds) {
      if (new Set(restoreLabelIds).size !== restoreLabelIds.length || restoreLabelIds.length > Number(restoreLabelLimit)) throw new OperationError('invalid_request', `This version exceeds the current limit of ${restoreLabelLimit} post labels.`);
      if (restoreLabelIds.length) {
        const labels = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${[...restoreLabelIds]}::text[]) FOR SHARE`;
        if (labels.length !== restoreLabelIds.length) throw new OperationError('conflict', 'A label in this version is no longer available. Nothing was changed.');
      }
    }
    await tx.postTarget.deleteMany({ where: { postId: existing.id } });
    await tx.post.update({ where: { id: existing.id }, data: { message: text, firstComment, ...(firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes }), link: attachments.link, media: attachments.media, updatedAt: new Date(), targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, formatId: destinationFormats[target.id], status: 'pending' as const })) } } });
    if (restoreLabelIds) {
      await tx.$executeRaw`DELETE FROM post_labels WHERE "postId" = ${existing.id}`;
      if (restoreLabelIds.length) await tx.$executeRaw`INSERT INTO post_labels ("postId", "labelId") SELECT ${existing.id}, restore_ids.label_id FROM unnest(${[...restoreLabelIds]}::text[]) AS restore_ids(label_id)`;
    }
    // Review covers the exact content and destinations that were reviewed.
    // The guarded raw update only changes previously approved posts; managers
    // retain their publishing bypass while contributors need fresh review.
    const reset = await tx.$executeRaw`UPDATE posts SET "approvalStatus" = 'pending', "reviewedById" = NULL, "reviewedAt" = NULL, "reviewNote" = NULL WHERE id = ${existing.id} AND "workspaceId" = ${actor.workspaceId} AND "approvalStatus" = 'approved'`;
    await recordPostVersion(tx, existing.id, actor.userId, retention);
    if (existing.authorId !== actor.userId) await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'draft_updated', postId: existing.id });
    await audit(tx, actor, 'publishing.post_updated', { postId: existing.id, targetCount: targets.length });
    return { status: existing.status, approvalReset: reset === 1 };
  });
  return restoreLabelIds ? saved : undefined;
}

/** Preview and save share the post/destination operation locks. No saved destination is reintroduced. */
export async function restorePostVersion(input: { actor: PublishingActor; postId: string; snapshot: VersionSnapshot } & RestoreOptions) {
  return withPublishingOperation(input.actor, { postId: input.postId }, async ({ actor, signal }) => {
    const review = await prepareVersionRestore(actor, input.postId, input.snapshot);
    if (input.mode === 'preview' || (!review.exact && input.mode !== 'closest')) return { postId: input.postId, status: 'review_required', approvalReset: false, restored: false, review };
    if (!review.canRestore) throw new OperationError('invalid_request', 'No valid content remains. Edit the post to add text, a link or compatible media.');
    if (input.mode === 'closest' && input.reviewToken !== review.token) throw new OperationError('conflict', 'The restore proposal changed. Review it again before restoring.');
    const result = await updatePostInOperation(actor, { postId: input.postId, ...review.content, link: review.content.link ?? undefined }, signal, input.snapshot.labelIds);
    if (!result) throw new OperationError('upstream_failure', 'The restore could not be confirmed. Open the post and check its current content before trying again.');
    return { postId: input.postId, status: result.status, approvalReset: result.approvalReset, restored: true, review };
  });
}

/** Shared durable deletion service owns dispatch, receipts and local recovery. */
export { deletePostDurably as deletePost } from '@/modules/publishing/server/deletion';

/** Claim each destination before the provider call. `processing` remains as a manual-reconciliation marker on ambiguous failures. */
export async function publishPost(actor: PublishingActor, postId: string, expectedScheduledAt?: Date, options: { retryOnly?: boolean; nativeSchedule?: boolean } = {}) {
  return withPublishingOperation(actor, { postId, allowPublicationRecovery: true }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    const approvalRequired = !MANAGERS.has(role.role) && needsContributorApproval(await workspaceRequiresApproval(actor.workspaceId), role.role);
    await assertPostScope(actor, postId);
    const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, format: true, message: true, firstComment: true, link: true, media: true, status: true, scheduledAt: true, targets: { select: { id: true, formatId: true, status: true, remotePostId: true, target: { select: { id: true, name: true, type: true, providerId: true, canPublish: true, enabled: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true, tokenExpiresAt: true, scopes: true } } } } } } } });
    if (expectedScheduledAt !== undefined && (!post || post.status !== 'scheduled' || !post.scheduledAt || post.scheduledAt.getTime() !== expectedScheduledAt.getTime())) return { published: 0, failed: 0, needsReconciliation: 0, firstCommentsNeedingReview: 0, firstCommentsNotSent: 0, skipped: true };
    if (!post || !canManage(role.role, post.authorId, actor.userId)) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
    if (approvalRequired) {
      const approval = await prisma.$queryRaw<Array<{ approvalStatus: string }>>`SELECT "approvalStatus"::text AS "approvalStatus" FROM posts WHERE id = ${post.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (approval[0]?.approvalStatus !== 'approved') throw new OperationError('conflict', 'This workspace requires approval before this post can be published.');
    }
    if (options.retryOnly && !['failed', 'partially_failed'].includes(post.status)) throw new OperationError('conflict', 'Only posts with failed destinations can be retried.');
    if (!['draft', 'scheduled', 'failed', 'partially_failed'].includes(post.status)) throw new OperationError('conflict', 'This post cannot be published in its current state.');
    // Provider-held scheduling is an explicit opt-in: the destination formats must declare it (checked below).
    const nativeScheduledAt = options.nativeSchedule === true && post.status === 'scheduled' && post.scheduledAt && post.scheduledAt > new Date() ? post.scheduledAt : null;
    if (post.status === 'scheduled' && (!post.scheduledAt || post.scheduledAt > new Date()) && !nativeScheduledAt) throw new OperationError('conflict', 'This post is scheduled for a future time.');
    if (!post.targets.length) throw new OperationError('invalid_request', 'Select at least one destination before publishing.');
    if (!Array.isArray(post.media)) throw new OperationError('invalid_request', 'Stored post media needs review before publishing.');
    const attachments = validatePostAttachments({ link: post.link ?? undefined, media: post.media as unknown as PublishMedia[] }, Number(await runtimeConfig('publishing.maxRemoteMediaPerPost')), Number(await runtimeConfig('publishing.maxImageAltCharacters')));
    validatePostContent(post.message, Number(await runtimeConfig('publishing.maxMessageCharacters')), attachments);
    const publishMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
    const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
    if (!entitlements) throw new OperationError('unavailable', 'This workspace is unavailable.');
    for (const item of post.targets) {
      if (item.status === 'published' || item.remotePostId || !['pending', 'failed'].includes(item.status)) continue;
      const provider = item.target.socialAccount?.provider;
      const adapter = provider ? await platformFor(provider, 'publishing') : null;
      if (adapter) {
        const descriptor = validateSelectedPublishingFormat(adapter.publishingFormats, item.formatId ?? post.format, { media: publishMedia, link: attachments.link, firstComment: post.firstComment });
        if (nativeScheduledAt && !descriptor.scheduling.native) throw new OperationError('invalid_request', 'A selected destination cannot hold this post at the provider. Remove it or publish at the scheduled time.');
        assertPublishingMediaSupport(adapter, publishMedia, attachments.link);
        assertLocalImageLimits(adapter, publishMedia);
      }
    }
    // Workspace link preparation (legacy publish-time UTM tagging); stored content keeps the real destination.
    let linkSettings: Awaited<ReturnType<typeof loadWorkspaceOperations>> | null = null;
    const taggedAt = new Date();
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
      const credential = adapter ? readPublishingCredential(item.target, adapter, 'publishing') : null;
      const eligible = Boolean(credential && provider && hasPlatformCapability(entitlements, provider) && adapter?.publish && (!post.firstComment?.trim() || adapter.publishFirstComment) && adapter.supportsTargetKind?.(item.target.type, 'publishing') && item.target.enabled && item.target.canPublish && item.target.accessToken && !item.target.socialAccount?.invalidatedAt);
      if (!eligible) { failed++; await markTarget(actor, post.id, item.id, 'failed', signal); continue; }
      linkSettings ??= await loadWorkspaceOperations(actor.workspaceId);
      const preparedLinks = await preparePublicationLinks({ workspaceId: actor.workspaceId, postId: post.id, targetId: item.target.id,
        message: post.message, link: attachments.link, settings: linkSettings, targetName: item.target.name, date: taggedAt });
      const outcome = await publishDestinationInOperation({ actor, signal }, {
        postId: post.id, postTargetId: item.id, targetId: item.target.id, provider: provider!, expectedStatus: item.status as 'pending' | 'failed',
        dispatch: operationId => adapter!.publish!({ credential: credential!, target: { id: item.target.providerId, name: '', kind: item.target.type }, formatId: item.formatId ?? post.format, text: preparedLinks.message, link: preparedLinks.link, media: publishMedia, signal, operationId,
          publication: { workspaceId: actor.workspaceId, postId: post.id, postTargetId: item.id, targetId: item.target.id, actorId: actor.userId },
          ...(nativeScheduledAt ? { scheduledAt: nativeScheduledAt } : {}) }),
        classifyFailure: error => adapter!.classifyPublishingFailure?.(error) ?? 'uncertain',
      });
      if (outcome === 'failed') { failed++; continue; }
      if (outcome !== 'published') { pending++; continue; }
      published++;
      if (post.firstComment?.trim()) {
        try {
          const comment = await attemptFirstCommentInOperation({ actor, role: role.role, signal, dueAt: new Date(), automatic: expectedScheduledAt !== undefined }, { postId: post.id, postTargetId: item.id });
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
      if (post.status === 'scheduled') await enqueueEmptyQueueNotifications(tx, actor.workspaceId, post.id, post.targets.map(item => item.target.id));
      await audit(tx, actor, 'publishing.publish_finished', { postId: post.id, published, failed, needsReconciliation: pending, firstCommentsNeedingReview, firstCommentsNotSent });
    });
    return { published, failed, needsReconciliation: pending, firstCommentsNeedingReview, firstCommentsNotSent, skipped: false };
  });
}

export { syncPublicationStatus as syncPostStatus } from '@/modules/publishing/server/status';

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
    const optionalColumns = header.slice(3);
    if (header[0] !== 'message' || header[1] !== 'firstComment' || header[2] !== 'channels' ||
      optionalColumns.some(column => !['destinationFormats', 'firstCommentDelayMinutes'].includes(column)) || new Set(header).size !== header.length)
      throw new OperationError('invalid_request', 'CSV header must be message,firstComment,channels with optional destinationFormats and firstCommentDelayMinutes.');
    const formatsColumn = header.indexOf('destinationFormats'), delayColumn = header.indexOf('firstCommentDelayMinutes');
    const maxCommentDelay = delayColumn >= 0 ? await runtimeConfig('publishing.maxFirstCommentDelayMinutes') : undefined;
    const available = await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, enabled: true, canPublish: true, ...(actor.allowedTargetIds ? { id: { in: [...actor.allowedTargetIds] } } : {}) }, select: { id: true, name: true, type: true, socialAccount: { select: { provider: true } } } });
    const choices = available.map(target => ({ id: target.id, name: target.name, type: target.type, provider: target.socialAccount?.provider ?? null }));
    const inputs = rows.slice(1).map((row, index) => {
      if (row.length !== header.length) throw new OperationError('invalid_request', `CSV row ${index + 2} must match the header columns.`);
      let destinationFormats: unknown;
      if (formatsColumn >= 0 && row[formatsColumn]?.trim()) { try { destinationFormats = JSON.parse(row[formatsColumn]); } catch { throw new OperationError('invalid_request', `CSV row ${index + 2} needs a valid destinationFormats JSON object.`); } }
      return { destinationFormats, firstCommentDelayMinutes: delayColumn < 0 ? 0 : parseFirstCommentDelay(row[delayColumn], maxCommentDelay!), message: validText(row[0]!, config.maxText), firstComment: validFirstComment(row[1]!, config.maxText), targetIds: resolveCsvDestinationIds(row[2]!, choices, index + 2) };
    });
    await lockTargets([...new Set(inputs.flatMap(input => input.targetIds))]);
    const resolvedFormats: Array<Record<string,string>> = [];
    for (const input of inputs) {
      const destinations = await validateTargets(actor, input.targetIds, config.maxTargets, [], Boolean(input.firstComment));
      resolvedFormats.push(await resolveAuthorizedDestinationFormats(destinations, input.destinationFormats, config.maxTargets, {media:[],firstComment:input.firstComment}));
    }
    const targetCount = new Set(inputs.flatMap(row => row.targetIds)).size;
    const now = new Date();
    const ids = inputs.map(() => randomUUID());
    await publishingTransaction(signal, async tx => {
      for (const [index, input] of inputs.entries()) await tx.post.create({ data: { id: ids[index]!, workspaceId: actor.workspaceId, authorId: actor.userId, message: input.message, firstComment: input.firstComment, firstCommentDelayMinutes: input.firstCommentDelayMinutes, status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
        targets: { create: input.targetIds.map(targetId => ({ id: randomUUID(), targetId, formatId: resolvedFormats[index]![targetId], status: 'pending' as const })) } } });
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

async function markTarget(actor: PublishingActor, postId: string, id: string, status: 'failed', signal: AbortSignal) {
  await publishingTransaction(signal, async tx => {
    await tx.postTarget.updateMany({ where: { id, post: { workspaceId: actor.workspaceId }, status: { in: ['pending', 'failed', 'processing'] }, remotePostId: null }, data: { status } });
    await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'publish_failure', postId });
    await audit(tx, actor, 'publishing.target_failed', { postTargetId: id });
  });
}

async function audit(tx: Prisma.TransactionClient, actor: PublishingActor, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`pub_${randomBytes(12).toString('hex')}`}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}
