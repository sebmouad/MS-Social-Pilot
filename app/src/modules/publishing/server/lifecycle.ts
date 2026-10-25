import { loadPublishingMediaText } from './media-copy';

import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
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
import { resolveVariantMessage, variantSelectionForPublish } from './post-variants';
import { loadWorkspaceOperations } from '@/modules/settings/server/workspace-operations';
import { recordPostVersion, loadVersionRetention } from '@/modules/publishing/collaboration/server/versions';
import { cancelHeldDestinations, rescheduleHeldDestinations } from '@/modules/publishing/server/remote-hold';
import { isWaitingToReschedule } from '../schedule-state';
import { parseScheduleMode, remoteHoldDecision, type RemoteFallbackReason, type ScheduleMode } from '@/modules/publishing/remote-scheduling';
import { anyRemote, clearScheduleModes, destinationMode, resolveScheduleModes, storeScheduleModes, summaryMode, type DestinationScheduleModes } from '@/modules/publishing/server/schedule-modes';

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

export function validatePostAttachments(input: PostAttachments, maxMedia: number, maxAlt: number, errorText: PublishingErrorText = defaultPublishingErrorText) {
  const secureUrl = (value: string) => {
    let parsed: URL;
    try { parsed = new URL(value); }
    catch { throw new PublishingOperationError('invalid_request', 'attachmentsRequireAPublicHTTPSURLWithoutCredentials', {}, errorText); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new PublishingOperationError('invalid_request', 'attachmentsRequireAPublicHTTPSURLWithoutCredentials', {}, errorText);
    return parsed.toString();
  };
  const link = input.link?.trim() ? secureUrl(input.link.trim()) : null;
  const media = input.media ?? [];
  if (!Array.isArray(media)) throw new PublishingOperationError('invalid_request', 'chooseValidMediaAttachments', {}, errorText);
  if (media.length > maxMedia || media.some(item => !item || (item.kind !== 'image' && item.kind !== 'video') || typeof item.url !== 'string')) throw new PublishingOperationError('invalid_request', 'chooseUpToValue0SupportedMediaAttachments', {value0: maxMedia}, errorText);
  if (media.some(item => item.altText !== undefined && typeof item.altText !== 'string')) throw new PublishingOperationError('invalid_request', 'chooseAValidImageDescription', {}, errorText);
  if (media.some(item => item.altText?.trim() && item.altText.trim().length > maxAlt)) throw new PublishingOperationError('invalid_request', 'imageDescriptionsMustBeValue0CharactersOrFewer', {value0: maxAlt}, errorText);
  if (media.some(item => item.kind === 'video' && item.altText?.trim())) throw new PublishingOperationError('invalid_request', 'imageDescriptionsCanOnlyBeUsedWithImages', {}, errorText);
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

export function assertLocalImageLimits(adapter: Pick<PlatformAdapter, 'localImageUpload'>, media: PublishMedia[], errorText: PublishingErrorText = defaultPublishingErrorText) {
  for (const item of media) {
    if (!item.localFile) continue;
    const limits = adapter.localImageUpload;
    if (!limits || item.localFile.bytes.byteLength > limits.maxBytes || !limits.mimeTypes.includes(item.localFile.mimeType)) {
      throw new PublishingOperationError('invalid_request', 'aSelectedDestinationCannotPublishThisUploadedImageChoose', {}, errorText);
    }
  }
}

async function membership(actor: PublishingActor) {
  const errorText = await loadPublishingErrorText();
  const result = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!result) throw new PublishingOperationError('unauthorized', 'youAreNoLongerAMemberOfThisWorkspace', {}, errorText);
  if (!WRITERS.has(result.role)) throw new PublishingOperationError('forbidden', 'youDoNotHavePermissionToManagePosts', {}, errorText);
  return result;
}

/** Read the existing workspace approval switch through the legacy-compatible SQL view. */
async function workspaceRequiresApproval(workspaceId: string) {
  const errorText = await loadPublishingErrorText();
  const rows = await prisma.$queryRaw<Array<{ requiresApproval: boolean }>>`SELECT "requiresApproval" FROM workspaces WHERE id = ${workspaceId}`;
  if (!rows[0] || typeof rows[0].requiresApproval !== 'boolean') throw new PublishingOperationError('unavailable', 'workspacePublishingPolicyIsUnavailable', {}, errorText);
  return rows[0].requiresApproval;
}
async function setApprovalPending(tx: Prisma.TransactionClient, actor: PublishingActor, postId: string) {
  await tx.$executeRaw`UPDATE posts SET "approvalStatus" = 'pending', "submittedById" = ${actor.userId}, "submittedAt" = NOW(), "reviewedById" = NULL, "reviewedAt" = NULL, "reviewNote" = NULL WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId}`;
  await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'approval_request', postId });
}

export function validText(value: string, maxText: number, errorText: PublishingErrorText = defaultPublishingErrorText) {
  const text = value.trim();
  if (!text || text.length > maxText) throw new PublishingOperationError('invalid_request', 'postTextMustBeBetween1AndValue0Characters', {value0: maxText.toLocaleString()}, errorText);
  return text;
}

/** Normalize post text while allowing attachment-only content. First comments
 * are deliberately excluded: they cannot make an otherwise empty post valid. */
export function validatePostContent(value: string, maxText: number, attachments: { link?: string | null; media?: readonly unknown[] }, errorText: PublishingErrorText = defaultPublishingErrorText) {
  const text = value.trim();
  if (text.length > maxText) throw new PublishingOperationError('invalid_request', 'postTextMustBeBetween1AndValue0Characters', {value0: maxText.toLocaleString()}, errorText);
  if (!text && !attachments.link?.trim() && !attachments.media?.length) throw new PublishingOperationError('invalid_request', 'addPostTextALinkOrMediaBeforeSaving', {}, errorText);
  return text;
}

export function validFirstComment(value: string, maxText: number, errorText: PublishingErrorText = defaultPublishingErrorText) {
  const text = value.trim();
  if (text.length > maxText) throw new PublishingOperationError('invalid_request', 'firstCommentMustBeValue0CharactersOrFewer', {value0: maxText.toLocaleString()}, errorText);
  return text || null;
}

export async function validateTargets(actor: PublishingActor, ids: string[], maxTargets: number, media: PublishMedia[] = [], firstCommentRequested = false, link?: string | null, formatId?: string, scheduled = false) {
  const mediaText = await loadPublishingMediaText();
  const errorText = await loadPublishingErrorText();
  if (ids.length > maxTargets || new Set(ids).size !== ids.length) throw new PublishingOperationError('invalid_request', 'chooseUpToValue0DistinctDestinations', {value0: maxTargets}, errorText);
  if (actor.allowedTargetIds && ids.some(id => !actor.allowedTargetIds!.includes(id))) throw new PublishingOperationError('forbidden', 'oneOrMoreDestinationsAreOutsideYourChannelAccess', {}, errorText);
  if (!ids.length) return [];
  const targets = await prisma.target.findMany({
    where: { id: { in: ids }, workspaceId: actor.workspaceId, enabled: true, canPublish: true },
    select: { id: true, type: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true } } },
  });
  if (targets.length !== ids.length) throw new PublishingOperationError('unavailable', 'oneOrMoreDestinationsAreUnavailableOrCannotPublish', {}, errorText);
  const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
  if (!entitlements) throw new PublishingOperationError('unavailable', 'thisWorkspaceIsUnavailable', {}, errorText);
  for (const target of targets) {
    const provider = target.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'publishing') : null;
    if (!provider || !hasPlatformCapability(entitlements, provider) || !adapter?.publish || !adapter.supportsTargetKind?.(target.type, 'publishing') || target.socialAccount?.invalidatedAt || !target.accessToken) {
      throw new PublishingOperationError('unavailable', 'oneOrMoreDestinationsAreUnavailableOrCannotPublish', {}, errorText);
    }
    if (firstCommentRequested && !adapter.publishFirstComment) throw new PublishingOperationError('invalid_request', 'aSelectedDestinationCannotAddAFirstCommentClear', {}, errorText);
    if (formatId !== undefined) validateSelectedPublishingFormat(adapter.publishingFormats, formatId, { media, link, firstComment: firstCommentRequested ? 'requested' : undefined, scheduled });
    assertPublishingMediaSupport(adapter, media, link, mediaText);
    assertLocalImageLimits(adapter, media, errorText);
  }
  return targets;
}

async function assertStoredPostMediaCompatible(workspaceId: string, post: {
  message?: string | null; firstComment?: string | null; link?: string | null; media?: unknown; format?: string;
  targets: Array<{ status: string; formatId?: string | null; target?: { socialAccount?: { provider?: string | null } | null } }>;
}) {
  const mediaText = await loadPublishingMediaText();
  const errorText = await loadPublishingErrorText();
  if (post.media !== undefined && !Array.isArray(post.media)) throw new PublishingOperationError('invalid_request', 'storedPostAttachmentsNeedReviewBeforeScheduling', {}, errorText);
  const config = await limits();
  const attachments = validatePostAttachments({ link: post.link ?? undefined, media: (post.media ?? []) as PublishMedia[] }, config.maxMedia, config.maxAlt, errorText);
  validatePostContent(post.message ?? '', config.maxText, attachments, errorText);
  const resolved = await resolvePublishMedia(workspaceId, attachments.media);
  for (const destination of post.targets) {
    if (destination.status !== 'pending') continue;
    const provider = destination.target?.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'publishing') : null;
    validateSelectedPublishingFormat(adapter?.publishingFormats, destination.formatId ?? post.format, { media: resolved, link: attachments.link, firstComment: post.firstComment, scheduled: true });
    assertPublishingMediaSupport(adapter ?? { publishingMedia: undefined } as PlatformAdapter, resolved, attachments.link, mediaText);
    assertLocalImageLimits(adapter ?? {}, resolved, errorText);
  }
}

async function assertPostScope(actor: PublishingActor, postId: string) {
  const errorText = await loadPublishingErrorText();
  if (!actor.allowedTargetIds) return;
  const rows = await prisma.postTarget.findMany({ where: { postId, post: { workspaceId: actor.workspaceId } }, select: { targetId: true } });
  if (rows.some(row => !actor.allowedTargetIds!.includes(row.targetId))) throw new PublishingOperationError('forbidden', 'thisPostIsUnavailableInYourChannelScope', {}, errorText);
}

function canManage(role: string, authorId: string, userId: string) {
  return MANAGERS.has(role) || authorId === userId;
}

export type PostApprovalState = { status: string; reviewNote: string | null; reviewedAt: Date | null; reviewedByName: string | null };

/**
 * Approval workflow state for the given workspace posts. The approval columns live outside the Prisma
 * Post model, so this reads them with the same raw SQL the review writes use. Posts without a row
 * are absent from the map; callers treat them as never submitted.
 */
export async function readPostApprovalStates(workspaceId: string, postIds: readonly string[]): Promise<Map<string, PostApprovalState>> {
  if (!postIds.length) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; approvalStatus: string; reviewNote: string | null; reviewedAt: Date | null; reviewedByName: string | null }>>`
    SELECT p.id, p."approvalStatus"::text AS "approvalStatus", p."reviewNote", p."reviewedAt", u.name AS "reviewedByName"
    FROM posts p LEFT JOIN users u ON u.id = p."reviewedById"
    WHERE p."workspaceId" = ${workspaceId} AND p.id = ANY(${[...postIds]}::text[])`;
  return new Map(rows.map(row => [row.id, { status: row.approvalStatus, reviewNote: row.reviewNote, reviewedAt: row.reviewedAt, reviewedByName: row.reviewedByName }]));
}

/** Submit an authored draft for review. */
export async function submitPostForApproval(actor: PublishingActor, postId: string) {
  const errorText = await loadPublishingErrorText();
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, postId);
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, targets: { select: { id: true } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || !['draft', 'rejected'].includes(post.status) || !post.targets.length) throw new PublishingOperationError('conflict', 'thisPostCannotBeSubmittedForApproval', {}, errorText);
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
  await reviewPostDecision(actor, postId, decision, note, participant);
  // An approved post chosen for platform-held scheduling is handed over now; any failure leaves it with the application.
  if (decision === 'approve') await holdScheduledPostAtProvider(actor, postId).catch(() => null);
}

async function reviewPostDecision(actor: PublishingActor, postId: string, decision: ReviewDecision, note?: string, participant?: ReviewParticipant) {
  const errorText = await loadPublishingErrorText();
  return withPublishingOperation(actor, { postId, feature: 'publishing/approvals' }, async ({ actor, signal, lockTargets }) => {
    if (decision !== 'approve' && decision !== 'reject') throw new PublishingOperationError('invalid_request', 'chooseApproveOrReject', {}, errorText);
    if (note !== undefined && note !== null && typeof note !== 'string') throw new PublishingOperationError('invalid_request', 'enterAValidReviewNote', {}, errorText);
    if (participant !== undefined && (participant === null || typeof participant !== 'object'
      || (participant.before !== undefined && typeof participant.before !== 'function') || (participant.after !== undefined && typeof participant.after !== 'function'))) {
      throw new PublishingOperationError('unavailable', 'reviewCouldNotBeCompletedTryAgainLater', {}, errorText);
    }
    const reviewNote = (note ?? '').trim();
    if (reviewNote.length > 500) throw new PublishingOperationError('invalid_request', 'keepTheReviewNoteTo500CharactersOrFewer', {}, errorText);
    const member = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
    if (!member || !['owner', 'admin', 'editor', 'client'].includes(member.role)) throw new PublishingOperationError('forbidden', 'youDoNotHavePermissionToReviewPosts', {}, errorText);
    if (member.role === 'client') {
      const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { authorId: true } });
      if (post?.authorId === actor.userId) throw new PublishingOperationError('forbidden', 'youCannotReviewYourOwnPost', {}, errorText);
    }
    await assertPostScope(actor, postId);
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, status: true, scheduledAt: true } });
      if (!post || post.status !== 'pending_approval') throw new PublishingOperationError('conflict', 'thisPostIsNoLongerAwaitingApproval', {}, errorText);
      const status = decision === 'approve' ? (post.scheduledAt ? 'scheduled' : 'draft') : 'rejected';
      const context: ReviewParticipantContext = Object.freeze({
        actor: Object.freeze({ ...actor }), postId: post.id, decision, note: reviewNote || null,
        post: Object.freeze({ id: post.id, status: post.status, scheduledAt: post.scheduledAt }), resultingStatus: status,
      });
      await participant?.before?.(tx, context);
      signal.throwIfAborted();
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'pending_approval' }, data: { status, updatedAt: new Date() } });
      if (changed.count !== 1) throw new PublishingOperationError('conflict', 'thisPostIsNoLongerAwaitingApproval', {}, errorText);
      await tx.$executeRaw`UPDATE posts SET "approvalStatus" = ${decision === 'approve' ? 'approved' : 'rejected'}::"ApprovalStatus", "reviewedById" = ${actor.userId}, "reviewedAt" = NOW(), "reviewNote" = ${reviewNote || null} WHERE id = ${post.id} AND "workspaceId" = ${actor.workspaceId}`;
      await participant?.after?.(tx, context);
      await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'approval_decision', postId: post.id });
      signal.throwIfAborted();
      await audit(tx, actor, decision === 'approve' ? 'publishing.post_approved' : 'publishing.post_rejected', { postId: post.id, ...(reviewNote ? { note: reviewNote } : {}) });
    });
  });
}

/** Schedule a local queued post for a future time. */
export async function schedulePost(actor: PublishingActor, postId: string, scheduledAt: Date, options: { scheduleMode?: ScheduleMode; destinationScheduleModes?: DestinationScheduleModes } = {}) {
  const errorText = await loadPublishingErrorText();
  const outcome = await withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    const holdForApproval = !MANAGERS.has(role.role) && needsContributorApproval(await workspaceRequiresApproval(actor.workspaceId), role.role);
    await assertPostScope(actor, postId);
    if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new PublishingOperationError('invalid_request', 'chooseAFuturePublishingTime', {}, errorText);
    const retention = await loadVersionRetention();
    return publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, message: true, firstComment: true, format: true, link: true, media: true, targets: { select: { targetId: true, status: true, formatId: true, target: { select: { socialAccount: { select: { provider: true } } } } } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || !['draft', 'rejected'].includes(post.status) || !post.targets.length || post.targets.some(target => target.status !== 'pending')) throw new PublishingOperationError('conflict', 'thisPostCannotBeScheduled', {}, errorText);
      const resolved = await resolveScheduleModes(post.targets.map(target => target.targetId), options.scheduleMode, options.destinationScheduleModes, actor.workspaceId);
      await assertStoredPostMediaCompatible(actor.workspaceId, post);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      await tx.post.update({ where: { id: post.id }, data: { status: holdForApproval ? 'pending_approval' : 'scheduled', scheduledAt, updatedAt: new Date() } });
      await storeScheduleModes(tx, actor.workspaceId, post.id, resolved.byTarget);
      if (holdForApproval) await setApprovalPending(tx, actor, post.id);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      await audit(tx, actor, 'publishing.post_scheduled', { postId: post.id, scheduledAt: scheduledAt.toISOString(), scheduleMode: summaryMode(resolved.byTarget), ...(options.destinationScheduleModes ? { destinationScheduleModes: Object.fromEntries(resolved.byTarget) } : {}) });
      return { handOff: !holdForApproval, modes: resolved.byTarget };
    });
  });
  return { scheduleMode: summaryMode(outcome.modes), destinationScheduleModes: Object.fromEntries(outcome.modes), remoteHold: outcome.handOff && anyRemote(outcome.modes) ? await holdScheduledPostAtProvider(actor, postId).then(result => result?.remoteHold ?? NO_HOLD, () => NO_HOLD) : NO_HOLD };
}

export type RescheduleInput = { postId: string; date: string; time: string; timeZone: string };

/**
 * Move a scheduled post to a new workspace-local date and time.
 * The wall-clock time is interpreted in the workspace time zone (DST-aware) and
 * must be in the future. Existing platform-held copies move before the local time;
 * deferred destinations are offered the new time after the local change commits.
 */
export async function reschedulePost(actor: PublishingActor, input: RescheduleInput) {
  const errorText = await loadPublishingErrorText();
  if (!isValidTimeZone(input.timeZone)) throw new PublishingOperationError('unavailable', 'thisWorkspaceHasNoValidTimeZone', {}, errorText);
  const resolved = wallTimeToInstant(input.date, input.time, input.timeZone);
  if (!resolved.ok) throw new OperationError('invalid_request', resolved.reason === 'skipped' ? 'That time does not exist on that day because the clocks change. Choose another time.' : 'Choose a valid date and time.');
  return reschedulePostToInstant(actor, input.postId, resolved.instant);
}

/** Same service as {@link reschedulePost} for callers that already hold an exact instant (REST and MCP). */
export async function reschedulePostToInstant(actor: PublishingActor, postId: string, scheduledAt: Date) {
  const errorText = await loadPublishingErrorText();
  const input = { postId };
  const result = await withPublishingOperation(actor, { postId: input.postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, input.postId);
    if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime())) throw new PublishingOperationError('invalid_request', 'chooseAValidDateAndTime', {}, errorText);
    if (scheduledAt.getTime() <= Date.now()) throw new PublishingOperationError('invalid_request', 'chooseAFuturePublishingTime', {}, errorText);
    const retention = await loadVersionRetention();
    // Destinations the platform is holding move first, on the platform; the post's own time follows only when they all moved.
    const before = await prisma.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { authorId: true, status: true } });
    if (!before || !canManage(role.role, before.authorId, actor.userId)) throw new PublishingOperationError('conflict', 'thisPostCannotBeRescheduled', {}, errorText);
    if (before.status !== 'scheduled') throw new PublishingOperationError('conflict', 'onlyPostsThatAreStillWaitingToPublishCan', {}, errorText);
    await rescheduleHeldDestinations(actor, signal, input.postId, scheduledAt);
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, scheduledAt: true, message: true, firstComment: true, format: true, link: true, media: true, targets: { select: { status: true, formatId: true, remotePostId: true, target: { select: { socialAccount: { select: { provider: true } } } } } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId)) throw new PublishingOperationError('conflict', 'thisPostCannotBeRescheduled', {}, errorText);
      if (!isWaitingToReschedule(post)) throw new PublishingOperationError('conflict', 'onlyPostsThatAreStillWaitingToPublishCan', {}, errorText);
      await assertStoredPostMediaCompatible(actor.workspaceId, post);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'scheduled' }, data: { scheduledAt, updatedAt: new Date() } });
      if (changed.count !== 1) throw new PublishingOperationError('conflict', 'onlyPostsThatAreStillWaitingToPublishCan', {}, errorText);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      await audit(tx, actor, 'publishing.post_rescheduled', { postId: post.id, from: post.scheduledAt?.toISOString() ?? null, to: scheduledAt.toISOString() });
    });
    return { scheduledAt };
  });
  // Re-enter the shared publication boundary only after releasing the reschedule
  // locks. It rechecks current access, approval and each destination's saved mode;
  // the expected instant prevents this follow-up from acting on a concurrent move.
  // A failed handoff must not report the already-committed time change as failed:
  // uncertain attempts retain their journal and the ordinary recovery path.
  if (await runtimeConfig('publishing.remoteScheduling.offered').catch(() => false) === true) {
    await holdScheduledPostAtProvider(actor, postId, scheduledAt).catch(() => null);
  }
  return result;
}

/** Cancel a locally queued post back to draft while it is still pending delivery. */
export async function cancelScheduledPost(actor: PublishingActor, postId: string) {
  const errorText = await loadPublishingErrorText();
  return withPublishingOperation(actor, { postId }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    await assertPostScope(actor, postId);
    const retention = await loadVersionRetention();
    const before = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { authorId: true, status: true } });
    if (!before || !canManage(role.role, before.authorId, actor.userId) || before.status !== 'scheduled') throw new PublishingOperationError('conflict', 'thisQueuedPostCanNoLongerBeCancelledLocally', {}, errorText);
    // A platform-held copy is removed from the platform first (only while it is still scheduled there), then released locally.
    await cancelHeldDestinations(actor, signal, postId);
    await publishingTransaction(signal, async tx => {
      const post = await tx.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, targets: { select: { status: true, remotePostId: true } } } });
      if (!post || !canManage(role.role, post.authorId, actor.userId) || post.status !== 'scheduled' || post.targets.some(target => target.status !== 'pending' || target.remotePostId)) throw new PublishingOperationError('conflict', 'thisQueuedPostCanNoLongerBeCancelledLocally', {}, errorText);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      await clearScheduleModes(tx, actor.workspaceId, post.id);
      const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: actor.workspaceId, status: 'scheduled' }, data: { status: 'draft', scheduledAt: null, updatedAt: new Date() } });
      if (changed.count !== 1) throw new PublishingOperationError('conflict', 'thisQueuedPostCanNoLongerBeCancelledLocally', {}, errorText);
      await recordPostVersion(tx, post.id, actor.userId, retention);
      await audit(tx, actor, 'publishing.post_schedule_cancelled', { postId: post.id });
    });
  });
}

type CreatePostInput = { message: string; firstComment: string; targetIds: string[]; scheduledAt?: Date; scheduleMode?: ScheduleMode; destinationScheduleModes?: DestinationScheduleModes; labelId?: string | null } & PostAttachments;

/** Shared validation and persistence for single posts and atomic draft batches. */
async function preparePostCreation(actor: PublishingActor, input: CreatePostInput) {
  const errorText = await loadPublishingErrorText();
  const member = await membership(actor);
  if (input.labelId !== undefined && input.labelId !== null && (!/^[A-Za-z0-9_-]{1,200}$/.test(input.labelId))) throw new PublishingOperationError('invalid_request', 'chooseAValidPostLabel', {}, errorText);
  const holdForApproval = Boolean(input.scheduledAt) && !MANAGERS.has(member.role) && needsContributorApproval(await workspaceRequiresApproval(actor.workspaceId), member.role);
  const config = await limits();
  const firstComment = validFirstComment(input.firstComment, config.maxText, errorText);
  const firstCommentDelayMinutes = input.firstCommentDelayMinutes === undefined ? undefined : parseFirstCommentDelay(input.firstCommentDelayMinutes, await runtimeConfig('publishing.maxFirstCommentDelayMinutes'));
  const attachments = validatePostAttachments(input, config.maxMedia, config.maxAlt, errorText);
  const text = validatePostContent(input.message, config.maxText, attachments, errorText);
  const uploadMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
  const targets = await validateTargets(actor, input.targetIds, config.maxTargets, uploadMedia, Boolean(firstComment), attachments.link);
  if (input.scheduledAt && (!Number.isFinite(input.scheduledAt.getTime()) || input.scheduledAt.getTime() <= Date.now() || !targets.length)) throw new PublishingOperationError('invalid_request', 'chooseAFuturePublishingTimeAndAtLeastOne', {}, errorText);
  const destinationFormats = await resolveAuthorizedDestinationFormats(targets, input.destinationFormats, config.maxTargets, { media: uploadMedia, link: attachments.link, firstComment, scheduled: Boolean(input.scheduledAt) });
  const modes = input.scheduledAt ? await resolveScheduleModes(targets.map(target => target.id), input.scheduleMode, input.destinationScheduleModes, actor.workspaceId) : null;
  const retention = await loadVersionRetention();
  const now = new Date();
  const id = randomUUID();
  const persist = async (tx: Prisma.TransactionClient) => {
    if (input.labelId) {
      const labels = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE id = ${input.labelId} AND "workspaceId" = ${actor.workspaceId} FOR SHARE`;
      if (!labels.length) throw new PublishingOperationError('not_found', 'thisPostLabelIsUnavailableInTheCurrentWorkspace', {}, errorText);
    }
    await tx.post.create({ data: { id, workspaceId: actor.workspaceId, authorId: actor.userId, message: text, firstComment, firstCommentDelayMinutes: firstCommentDelayMinutes ?? 0, link: attachments.link, media: attachments.media, status: holdForApproval ? 'pending_approval' : input.scheduledAt ? 'scheduled' : 'draft', scheduledAt: input.scheduledAt ?? null, publishedAt: null, createdAt: now, updatedAt: now,
      targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, formatId: destinationFormats[target.id], status: 'pending' as const })) } } });
    if (input.labelId) await tx.$executeRaw`INSERT INTO post_labels ("postId", "labelId") VALUES (${id}, ${input.labelId})`;
    if (modes) await storeScheduleModes(tx, actor.workspaceId, id, modes.byTarget);
    if (holdForApproval) await setApprovalPending(tx, actor, id);
    await recordPostVersion(tx, id, actor.userId, retention);
    await audit(tx, actor, 'publishing.post_created', { postId: id, targetCount: targets.length });
    if (input.scheduledAt && modes) await audit(tx, actor, 'publishing.post_scheduled', { postId: id, scheduledAt: input.scheduledAt.toISOString(), scheduleMode: summaryMode(modes.byTarget), ...(input.destinationScheduleModes ? { destinationScheduleModes: Object.fromEntries(modes.byTarget) } : {}) });
    return { id, holdForApproval, modes: modes?.byTarget ?? null };
  };
  return persist;
}

export async function createPost(actor: PublishingActor, input: CreatePostInput) {
  const errorText = await loadPublishingErrorText();
  if (!input.scheduledAt && input.destinationScheduleModes && Object.keys(input.destinationScheduleModes).length) throw new PublishingOperationError('invalid_request', 'chooseAPublishingTimeBeforeChoosingWhereEachDestination', {}, errorText);
  const created = await withPublishingOperation(actor, { targetIds: input.targetIds }, async ({ actor, signal }) => {
    const persist = await preparePostCreation(actor, input);
    return publishingTransaction(signal, persist);
  });
  const remote = created.modes ? anyRemote(created.modes) : false;
  const remoteHold = remote && !created.holdForApproval ? await holdScheduledPostAtProvider(actor, created.id).then(result => result?.remoteHold ?? NO_HOLD, () => NO_HOLD) : NO_HOLD;
  return { id: created.id, scheduleMode: created.modes ? summaryMode(created.modes) : 'application' as ScheduleMode, ...(created.modes ? { destinationScheduleModes: Object.fromEntries(created.modes) } : {}), remoteHold };
}

/** Internal application composition: validated drafts and the caller's records commit together. No scheduling or provider writes. */
export async function createPublishingDraftBatch<T>(actor: PublishingActor, inputs: Array<Omit<CreatePostInput, 'scheduledAt' | 'scheduleMode' | 'destinationScheduleModes'>>, complete: (tx: Prisma.TransactionClient, postIds: string[]) => Promise<T>): Promise<T> {
  return withPublishingOperation(actor, { targetIds: [...new Set(inputs.flatMap(input => input.targetIds))] }, async ({ actor, signal }) => {
    const prepared: Array<Awaited<ReturnType<typeof preparePostCreation>>> = [];
    for (const input of inputs) prepared.push(await preparePostCreation(actor, { ...input, scheduledAt: undefined, scheduleMode: undefined, destinationScheduleModes: undefined }));
    return publishingTransaction(signal, async tx => {
      const postIds: string[] = [];
      for (const persist of prepared) postIds.push((await persist(tx)).id);
      return complete(tx, postIds);
    });
  });
}

export async function updatePost(actor: PublishingActor, input: { postId: string; message: string; firstComment: string; targetIds: string[] } & PostAttachments, restoreLabelIds?: readonly string[]) {
  return withPublishingOperation(actor, { postId: input.postId, targetIds: input.targetIds }, async ({ actor, signal }) => {
    return updatePostInOperation(actor, input, signal, restoreLabelIds);
  });
}

async function updatePostInOperation(actor: PublishingActor, input: { postId: string; message: string; firstComment: string; targetIds: string[] } & PostAttachments, signal: AbortSignal, restoreLabelIds?: readonly string[]) {
  const errorText = await loadPublishingErrorText();
  const role = await membership(actor);
  await assertPostScope(actor, input.postId);
  const config = await limits();
  const firstComment = validFirstComment(input.firstComment, config.maxText, errorText);
  const firstCommentDelayMinutes = input.firstCommentDelayMinutes === undefined ? undefined : parseFirstCommentDelay(input.firstCommentDelayMinutes, await runtimeConfig('publishing.maxFirstCommentDelayMinutes'));
  const attachments = validatePostAttachments(input, config.maxMedia, config.maxAlt, errorText);
  const text = validatePostContent(input.message, config.maxText, attachments, errorText);
  const uploadMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
  const targets = await validateTargets(actor, input.targetIds, config.maxTargets, uploadMedia, Boolean(firstComment), attachments.link);
  const retention = await loadVersionRetention();
  const restoreLabelLimit = restoreLabelIds ? await runtimeConfig('publishing.collab.labelsPerPostLimit') : null;
  if (restoreLabelIds && (!Number.isSafeInteger(restoreLabelLimit) || Number(restoreLabelLimit) < 1 || Number(restoreLabelLimit) > 100)) throw new PublishingOperationError('unavailable', 'postLabelLimitsAreTemporarilyUnavailable', {}, errorText);
  const saved = await publishingTransaction(signal, async tx => {
    const existing = await tx.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, format: true, status: true, publishedAt: true, targets: { select: { id: true, targetId: true, formatId: true, status: true, remotePostId: true } } } });
    if (!existing || (role.role === 'contributor' && existing.authorId !== actor.userId)) throw new PublishingOperationError('not_found', 'thisPostIsUnavailableInTheCurrentWorkspace', {}, errorText);
    if (existing.publishedAt || ['publishing', 'published', 'partially_failed', 'scheduled'].includes(existing.status) || existing.targets.some(target => target.remotePostId || target.status === 'processing' || target.status === 'published' || target.status === 'scheduled_remote')) throw new PublishingOperationError('conflict', 'thisPostCanNoLongerBeEdited', {}, errorText);
    const destinationFormats = await resolveAuthorizedDestinationFormats(targets, input.destinationFormats, config.maxTargets, { media: uploadMedia, link: attachments.link, firstComment }, { formats: new Map(existing.targets.map(target => [target.targetId, target.formatId ?? null])), legacyFormat: existing.format });
    await recordPostVersion(tx, existing.id, actor.userId, retention);
    if (restoreLabelIds) {
      if (new Set(restoreLabelIds).size !== restoreLabelIds.length || restoreLabelIds.length > Number(restoreLabelLimit)) throw new PublishingOperationError('invalid_request', 'thisVersionExceedsTheCurrentLimitOfValue0Post', {value0: restoreLabelLimit}, errorText);
      if (restoreLabelIds.length) {
        const labels = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${[...restoreLabelIds]}::text[]) FOR SHARE`;
        if (labels.length !== restoreLabelIds.length) throw new PublishingOperationError('conflict', 'aLabelInThisVersionIsNoLongerAvailable', {}, errorText);
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
  const errorText = await loadPublishingErrorText();
  return withPublishingOperation(input.actor, { postId: input.postId }, async ({ actor, signal }) => {
    const review = await prepareVersionRestore(actor, input.postId, input.snapshot);
    if (input.mode === 'preview' || (!review.exact && input.mode !== 'closest')) return { postId: input.postId, status: 'review_required', approvalReset: false, restored: false, review };
    if (!review.canRestore) throw new PublishingOperationError('invalid_request', 'noValidContentRemainsEditThePostToAdd', {}, errorText);
    if (input.mode === 'closest' && input.reviewToken !== review.token) throw new PublishingOperationError('conflict', 'theRestoreProposalChangedReviewItAgainBeforeRestoring', {}, errorText);
    const result = await updatePostInOperation(actor, { postId: input.postId, ...review.content, link: review.content.link ?? undefined }, signal, input.snapshot.labelIds);
    if (!result) throw new PublishingOperationError('upstream_failure', 'theRestoreCouldNotBeConfirmedOpenThePost', {}, errorText);
    return { postId: input.postId, status: result.status, approvalReset: result.approvalReset, restored: true, review };
  });
}

/** Shared durable deletion service owns dispatch, receipts and local recovery. */
export { deletePostDurably as deletePost } from '@/modules/publishing/server/deletion';

/** Claim each destination before the provider call. `processing` remains as a manual-reconciliation marker on ambiguous failures. */
export type RemoteHoldSummary = { held: number; deferred: number; reasons: RemoteFallbackReason[] };
const NO_HOLD: RemoteHoldSummary = { held: 0, deferred: 0, reasons: [] };

/**
 * Hand a scheduled post chosen for platform-held scheduling to the destinations that can hold it. Destinations that cannot
 * (unsupported, too soon, too far) stay with the application worker. Returns null when the post did not choose platform holding.
 */
export async function holdScheduledPostAtProvider(actor: PublishingActor, postId: string, expectedScheduledAt?: Date) {
  const rows = await prisma.$queryRaw<Array<{ publishMode: string }>>`SELECT "publishMode"::text AS "publishMode" FROM posts WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId} AND status::text = 'scheduled'`;
  if (rows[0]?.publishMode !== 'native') return null;
  return publishPost(actor, postId, expectedScheduledAt, { nativeSchedule: true, nativeFallback: true });
}

export async function publishPost(actor: PublishingActor, postId: string, expectedScheduledAt?: Date, options: { retryOnly?: boolean; nativeSchedule?: boolean; nativeFallback?: boolean } = {}) {
  const mediaText = await loadPublishingMediaText();
  const errorText = await loadPublishingErrorText();
  return withPublishingOperation(actor, { postId, allowPublicationRecovery: true }, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    const approvalRequired = !MANAGERS.has(role.role) && needsContributorApproval(await workspaceRequiresApproval(actor.workspaceId), role.role);
    await assertPostScope(actor, postId);
    const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, format: true, message: true, firstComment: true, link: true, media: true, status: true, scheduledAt: true, targets: { select: { id: true, formatId: true, status: true, remotePostId: true, target: { select: { id: true, name: true, type: true, providerId: true, canPublish: true, enabled: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true, tokenExpiresAt: true, scopes: true } } } } } } } });
    if (expectedScheduledAt !== undefined && (!post || post.status !== 'scheduled' || !post.scheduledAt || post.scheduledAt.getTime() !== expectedScheduledAt.getTime())) return { published: 0, failed: 0, needsReconciliation: 0, firstCommentsNeedingReview: 0, firstCommentsNotSent: 0, skipped: true };
    if (!post || !canManage(role.role, post.authorId, actor.userId)) throw new PublishingOperationError('not_found', 'thisPostIsUnavailableInTheCurrentWorkspace', {}, errorText);
    if (approvalRequired) {
      const approval = await prisma.$queryRaw<Array<{ approvalStatus: string }>>`SELECT "approvalStatus"::text AS "approvalStatus" FROM posts WHERE id = ${post.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (approval[0]?.approvalStatus !== 'approved') throw new PublishingOperationError('conflict', 'thisWorkspaceRequiresApprovalBeforeThisPostCanBe', {}, errorText);
    }
    if (options.retryOnly && !['failed', 'partially_failed'].includes(post.status)) throw new PublishingOperationError('conflict', 'onlyPostsWithFailedDestinationsCanBeRetried', {}, errorText);
    if (!['draft', 'scheduled', 'failed', 'partially_failed'].includes(post.status)) throw new PublishingOperationError('conflict', 'thisPostCannotBePublishedInItsCurrentState', {}, errorText);
    // Provider-held scheduling is an explicit opt-in: the destination formats must declare it (checked below).
    const nativeScheduledAt = options.nativeSchedule === true && post.status === 'scheduled' && post.scheduledAt && post.scheduledAt > new Date() ? post.scheduledAt : null;
    if (post.status === 'scheduled' && (!post.scheduledAt || post.scheduledAt > new Date()) && !nativeScheduledAt) throw new PublishingOperationError('conflict', 'thisPostIsScheduledForAFutureTime', {}, errorText);
    if (!post.targets.length) throw new PublishingOperationError('invalid_request', 'selectAtLeastOneDestinationBeforePublishing', {}, errorText);
    if (!Array.isArray(post.media)) throw new PublishingOperationError('invalid_request', 'storedPostMediaNeedsReviewBeforePublishing', {}, errorText);
    const attachments = validatePostAttachments({ link: post.link ?? undefined, media: post.media as unknown as PublishMedia[] }, Number(await runtimeConfig('publishing.maxRemoteMediaPerPost')), Number(await runtimeConfig('publishing.maxImageAltCharacters')), errorText);
    const maxMessageChars = Number(await runtimeConfig('publishing.maxMessageCharacters'));
    validatePostContent(post.message, maxMessageChars, attachments, errorText);
    // Each destination receives the variant matching its effective language, else the default text.
    const selection = await variantSelectionForPublish(actor.workspaceId, post.id, post.targets.map(item => item.target.id));
    const publishMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
    const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
    if (!entitlements) throw new PublishingOperationError('unavailable', 'thisWorkspaceIsUnavailable', {}, errorText);
    const holdIds = new Set<string>();
    const hold: RemoteHoldSummary = { held: 0, deferred: 0, reasons: [] };
    const holdMargin = nativeScheduledAt && options.nativeFallback ? Number(await runtimeConfig('publishing.remoteScheduling.leadMarginSeconds')) : 0;
    // Hand-off is per destination: only those whose stored choice is platform-held (null = follows the post, which is platform-held here).
    const storedModes = new Map<string, string | null>();
    if (nativeScheduledAt && options.nativeFallback) {
      for (const row of await prisma.$queryRaw<Array<{ id: string; scheduleMode: string | null }>>`SELECT id, "scheduleMode" FROM post_targets WHERE "postId" = ${post.id}`) storedModes.set(row.id, row.scheduleMode);
    }
    const wantsRemote = (targetRowId: string) => destinationMode(storedModes.get(targetRowId), 'remote') === 'remote';
    for (const item of post.targets) {
      if (item.status === 'published' || item.remotePostId || !['pending', 'failed'].includes(item.status)) continue;
      const provider = item.target.socialAccount?.provider;
      const adapter = provider ? await platformFor(provider, 'publishing') : null;
      if (adapter) {
        const descriptor = validateSelectedPublishingFormat(adapter.publishingFormats, item.formatId ?? post.format, { media: publishMedia, link: attachments.link, firstComment: post.firstComment });
        if (nativeScheduledAt && options.nativeFallback) {
          // Each destination's own module decides from its declared rules; the rest wait for the application worker.
          if (wantsRemote(item.id)) {
            const decision = remoteHoldDecision(descriptor, nativeScheduledAt, new Date(), holdMargin);
            if (decision.hold) holdIds.add(item.id);
            else { hold.deferred++; if (!hold.reasons.includes(decision.reason)) hold.reasons.push(decision.reason); }
          }
        } else if (nativeScheduledAt && !descriptor.scheduling.native) throw new PublishingOperationError('invalid_request', 'aSelectedDestinationCannotHoldThisPostAtThe', {}, errorText);
        assertPublishingMediaSupport(adapter, publishMedia, attachments.link, mediaText);
        assertLocalImageLimits(adapter, publishMedia, errorText);
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
    let heldExisting = 0;
    let keptWithApplication = 0;
    for (const item of post.targets) {
      if (item.status === 'scheduled_remote') { heldExisting++; continue; }
      if (item.status === 'published' || item.remotePostId) { published++; continue; }
      if (item.status === 'processing') { pending++; continue; }
      if (!['pending', 'failed'].includes(item.status)) { failed++; continue; }
      // Destinations that cannot hold this time wait for the application worker, untouched.
      if (nativeScheduledAt && options.nativeFallback && !holdIds.has(item.id)) { keptWithApplication++; continue; }
      const provider = item.target.socialAccount?.provider;
      const adapter = provider ? await platformFor(provider, 'publishing') : null;
      const credential = adapter ? readPublishingCredential(item.target, adapter, 'publishing') : null;
      const eligible = Boolean(credential && provider && hasPlatformCapability(entitlements, provider) && adapter?.publish && (!post.firstComment?.trim() || adapter.publishFirstComment) && adapter.supportsTargetKind?.(item.target.type, 'publishing') && item.target.enabled && item.target.canPublish && item.target.accessToken && !item.target.socialAccount?.invalidatedAt);
      if (!eligible) {
        // Say why, so a failed destination is actionable instead of a bare "Failed".
        const reason = !provider || !adapter?.publish ? 'This channel type cannot publish.'
          : item.target.socialAccount?.invalidatedAt || !item.target.accessToken || !credential ? 'The channel connection expired. Reconnect it in Settings › Channels.'
          : !hasPlatformCapability(entitlements, provider) ? 'Your plan does not include publishing to this network.'
          : !item.target.enabled || !item.target.canPublish ? 'This channel is turned off or lacks permission to publish.'
          : post.firstComment?.trim() && !adapter.publishFirstComment ? 'This network does not support first comments.'
          : 'This channel cannot receive this post.';
        failed++; await markTarget(actor, post.id, item.id, 'failed', signal, reason); continue;
      }
      linkSettings ??= await loadWorkspaceOperations(actor.workspaceId);
      const resolved = resolveVariantMessage(post.message, selection.variants, selection.locales.get(item.target.id) ?? selection.workspaceLocale);
      if (resolved.message !== post.message) validatePostContent(resolved.message, maxMessageChars, attachments, errorText);
      const preparedLinks = await preparePublicationLinks({ workspaceId: actor.workspaceId, postId: post.id, targetId: item.target.id,
        message: resolved.message, link: attachments.link, settings: linkSettings, targetName: item.target.name, date: taggedAt });
      const outcome = await publishDestinationInOperation({ actor, signal }, {
        postId: post.id, postTargetId: item.id, targetId: item.target.id, provider: provider!, expectedStatus: item.status as 'pending' | 'failed',
        ...(nativeScheduledAt ? { nativeScheduledFor: nativeScheduledAt } : {}),
        dispatch: operationId => adapter!.publish!({ credential: credential!, target: { id: item.target.providerId, name: '', kind: item.target.type }, formatId: item.formatId ?? post.format, text: preparedLinks.message, link: preparedLinks.link, media: publishMedia, signal, operationId,
          publication: { workspaceId: actor.workspaceId, postId: post.id, postTargetId: item.id, targetId: item.target.id, actorId: actor.userId },
          ...(nativeScheduledAt ? { scheduledAt: nativeScheduledAt } : {}) }),
        classifyFailure: error => adapter!.classifyPublishingFailure?.(error) ?? 'uncertain',
      });
      if (outcome === 'failed') { failed++; continue; }
      if (outcome !== 'published') { pending++; continue; }
      if (nativeScheduledAt) { hold.held++; continue; } // Held by the platform: the first comment follows once it is confirmed live.
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
    const heldTotal = hold.held + heldExisting;
    const waiting = heldTotal > 0 || hold.deferred > 0 || keptWithApplication > 0;
    const done = published + heldTotal;
    const status = pending ? (done ? 'partially_failed' : 'publishing') : failed ? (done ? 'partially_failed' : 'failed') : waiting ? 'scheduled' : 'published';
    await publishingTransaction(signal, async tx => {
      await tx.post.update({ where: { id: post.id }, data: { status, publishedAt: status === 'published' ? new Date() : undefined, updatedAt: new Date() } });
      if (post.status === 'scheduled' && !nativeScheduledAt) await enqueueEmptyQueueNotifications(tx, actor.workspaceId, post.id, post.targets.map(item => item.target.id));
      await audit(tx, actor, nativeScheduledAt ? 'publishing.remote_hold_finished' : 'publishing.publish_finished', { postId: post.id, published, failed, needsReconciliation: pending, firstCommentsNeedingReview, firstCommentsNotSent, ...(heldTotal || keptWithApplication ? { heldAtProvider: heldTotal, keptWithApplication } : {}) });
    });
    return { published, failed, needsReconciliation: pending, firstCommentsNeedingReview, firstCommentsNotSent, skipped: false, remoteHold: { held: hold.held, deferred: hold.deferred, reasons: hold.reasons } satisfies RemoteHoldSummary };
  });
}

export { syncPublicationStatus as syncPostStatus } from '@/modules/publishing/server/status';

/** Strict CSV with readable, semicolon-separated channel labels. */
export async function importPostsCsv(actor: PublishingActor, csv: string) {
  const errorText = await loadPublishingErrorText();
  return withPublishingOperation(actor, {}, async ({ actor, signal, lockTargets }) => {
    const role = await membership(actor);
    if (!MANAGERS.has(role.role)) throw new PublishingOperationError('forbidden', 'onlyWorkspaceManagersCanImportBatchesOfPosts', {}, errorText);
    const config = await limits();
    if (new TextEncoder().encode(csv).length > config.maxImportBytes) throw new PublishingOperationError('invalid_request', 'cSVFileMustBeValue0KiBOrSmaller', {value0: Math.ceil(config.maxImportBytes / 1024)}, errorText);
    const rows = parsePublishingCsv(csv, errorText);
    if (rows.length < 2 || rows.length > config.maxImportRows + 1) throw new PublishingOperationError('invalid_request', 'cSVMustIncludeAHeaderAndContainAtMost', {value0: config.maxImportRows}, errorText);
    const header = rows[0]!.map(value => value.trim());
    const optionalColumns = header.slice(3);
    if (header[0] !== 'message' || header[1] !== 'firstComment' || header[2] !== 'channels' ||
      optionalColumns.some(column => !['destinationFormats', 'firstCommentDelayMinutes'].includes(column)) || new Set(header).size !== header.length)
      throw new PublishingOperationError('invalid_request', 'cSVHeaderMustBeMessagefirstCommentchannelsWithOptionalDestinationFormatsAnd', {}, errorText);
    const formatsColumn = header.indexOf('destinationFormats'), delayColumn = header.indexOf('firstCommentDelayMinutes');
    const maxCommentDelay = delayColumn >= 0 ? await runtimeConfig('publishing.maxFirstCommentDelayMinutes') : undefined;
    const available = await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, enabled: true, canPublish: true, ...(actor.allowedTargetIds ? { id: { in: [...actor.allowedTargetIds] } } : {}) }, select: { id: true, name: true, type: true, socialAccount: { select: { provider: true } } } });
    const choices = available.map(target => ({ id: target.id, name: target.name, type: target.type, provider: target.socialAccount?.provider ?? null }));
    const inputs = rows.slice(1).map((row, index) => {
      if (row.length !== header.length) throw new PublishingOperationError('invalid_request', 'cSVRowValue0MustMatchTheHeaderColumns', {value0: index + 2}, errorText);
      let destinationFormats: unknown;
      if (formatsColumn >= 0 && row[formatsColumn]?.trim()) { try { destinationFormats = JSON.parse(row[formatsColumn]); } catch { throw new PublishingOperationError('invalid_request', 'cSVRowValue0NeedsAValidDestinationFormatsJSONObject', {value0: index + 2}, errorText); } }
      return { destinationFormats, firstCommentDelayMinutes: delayColumn < 0 ? 0 : parseFirstCommentDelay(row[delayColumn], maxCommentDelay!), message: validText(row[0]!, config.maxText, errorText), firstComment: validFirstComment(row[1]!, config.maxText, errorText), targetIds: resolveCsvDestinationIds(row[2]!, choices, index + 2) };
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

export function parsePublishingCsv(source: string, errorText: PublishingErrorText = defaultPublishingErrorText): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (closedQuote && char !== ',' && char !== '\n' && char !== '\r') throw new PublishingOperationError('invalid_request', 'cSVHasCharactersAfterAClosingQuote', {}, errorText);
    else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; closedQuote = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = []; closedQuote = false;
    } else cell += char;
  }
  if (quoted) throw new PublishingOperationError('invalid_request', 'cSVContainsAnUnclosedQuotedField', {}, errorText);
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

async function markTarget(actor: PublishingActor, postId: string, id: string, status: 'failed', signal: AbortSignal, reason?: string) {
  await publishingTransaction(signal, async tx => {
    await tx.postTarget.updateMany({ where: { id, post: { workspaceId: actor.workspaceId }, status: { in: ['pending', 'failed', 'processing'] }, remotePostId: null }, data: { status } });
    await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'publish_failure', postId });
    await audit(tx, actor, 'publishing.target_failed', { postTargetId: id, ...(reason ? { reason } : {}) });
  });
}

async function audit(tx: Prisma.TransactionClient, actor: PublishingActor, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`pub_${randomBytes(12).toString('hex')}`}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}
