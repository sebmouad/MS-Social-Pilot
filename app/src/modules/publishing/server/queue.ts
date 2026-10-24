
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { getBestTimeSuggestions } from './best-time';
import { randomUUID } from 'node:crypto';
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { resolveAuthorizedDestinationFormats } from '@/modules/publishing/server/formats';
import { OperationError } from '@/lib/operation-error';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { authorizePublishing } from '@/modules/publishing/server/access';
import { withPublishingOperation, withPublishingTransaction } from '@/modules/publishing/server/guard';
import type { PublishingActor } from '@/modules/publishing/server/types';
import { needsContributorApproval } from '@/modules/settings/workspace-policy';
import { isValidTimeZone } from '@/lib/calendar-dates';
import { allocateQueueTime } from '@/modules/publishing/collaboration/server/executors';
import { audit as collabAudit, bounds, exact, lockActor, parse } from '@/modules/publishing/collaboration/server/core';
import { loadVersionRetention, recordPostVersion } from '@/modules/publishing/collaboration/server/versions';
import { ID } from '@/modules/publishing/collaboration/schemas';
import { holdScheduledPostAtProvider, limits, resolvePublishMedia, validatePostAttachments, validatePostContent, validFirstComment, validateTargets } from './lifecycle';
import { SCHEDULE_MODES, type ScheduleMode } from '@/modules/publishing/remote-scheduling';
import { anyRemote, resolveScheduleModes, storeScheduleModes, summaryMode, type DestinationScheduleModes } from './schedule-modes';

const MANAGERS = new Set(['owner', 'admin', 'editor']);
const MODE = z.enum(SCHEDULE_MODES);
const QUEUE_REQUEST = z.object({ postId: ID, confirmation: z.string(), scheduleMode: MODE.optional(), destinationScheduleModes: z.record(z.string().min(1).max(200), MODE).refine(value => Object.keys(value).length <= 50).optional() }).strict();

export const queuePostConfirmation = (postId: string) => `QUEUE POST ${postId}`;

/** Strict shared HTTP/MCP mutation entrypoint with an exact, post-bound confirmation. */
export async function queuePostRequest(actor: PublishingActor, input: unknown) {
  const data = parse(QUEUE_REQUEST, input);
  exact(data.confirmation, queuePostConfirmation(data.postId));
  return queuePost(actor, data.postId, { ...(data.scheduleMode ? { scheduleMode: data.scheduleMode } : {}), ...(data.destinationScheduleModes ? { destinationScheduleModes: data.destinationScheduleModes } : {}) });
}

export type QueueScheduleOptions = { scheduleMode?: ScheduleMode; destinationScheduleModes?: DestinationScheduleModes };

/**
 * Schedule an editable local post at its next available weekly queue time. Where each destination's schedule waits follows the same
 * choice as an ordinary schedule: its own override, the post-level choice, or the Root default; platform-held destinations are handed
 * to their platform right after the queue time is saved.
 */
export async function queuePost(actor: PublishingActor, postId: string, options: QueueScheduleOptions = {}) {
  const queued = await queuePostInOperation(actor, postId, options);
  const remoteHold = queued.status === 'scheduled' && anyRemote(queued.modes)
    ? await holdScheduledPostAtProvider(actor, postId).then(result => result?.remoteHold ?? NO_REMOTE_HOLD, () => NO_REMOTE_HOLD) : NO_REMOTE_HOLD;
  return { postId: queued.postId, scheduledAt: queued.scheduledAt, status: queued.status, scheduleMode: summaryMode(queued.modes), destinationScheduleModes: Object.fromEntries(queued.modes), remoteHold };
}
const NO_REMOTE_HOLD = { held: 0, deferred: 0, reasons: [] as string[] };

async function queuePostInOperation(actor: PublishingActor, postId: string, options: QueueScheduleOptions) {
  const errorText = await loadPublishingErrorText();
  return withPublishingOperation(actor, { postId, feature: 'publishing/queue' }, async context => {
    // Queue access alone does not grant permission to publish or manage a post.
    await authorizePublishing(context.actor, 'publishing/posts', 'write');
    const [policy, collaborationBounds, retention, post] = await Promise.all([
      prisma.$queryRaw<Array<{ timezone: string; requiresApproval: boolean; bestTimeMode: string }>>`SELECT timezone, "requiresApproval", "bestTimeMode" FROM workspaces WHERE id = ${actor.workspaceId}`,
      bounds(), loadVersionRetention(),
      prisma.post.findFirst({
        where: { id: postId, workspaceId: actor.workspaceId },
        select: {
          id: true, authorId: true, status: true, publishedAt: true, message: true, firstComment: true, format: true, link: true, media: true,
          targets: { select: { id: true, targetId: true, formatId: true, status: true, remotePostId: true } },
        },
      }),
    ]);
    if (!policy[0] || typeof policy[0].timezone !== 'string' || !isValidTimeZone(policy[0].timezone) || typeof policy[0].requiresApproval !== 'boolean') {
      throw new PublishingOperationError('unavailable', 'workspaceSchedulingSettingsAreUnavailable', {}, errorText);
    }
    const role = context.role;
    if (!post || (role === 'contributor' && post.authorId !== actor.userId)) throw new PublishingOperationError('not_found', 'thisPostIsUnavailableInYourWorkspace', {}, errorText);
    if (!MANAGERS.has(role) && role !== 'contributor') throw new PublishingOperationError('forbidden', 'youDoNotHavePermissionToQueuePosts', {}, errorText);
    if (!['draft', 'rejected'].includes(String(post.status)) || post.publishedAt || !post.targets.length || post.targets.some(t => t.status !== 'pending' || t.remotePostId)) {
      throw new PublishingOperationError('conflict', 'thisPostCannotBeQueuedInItsCurrentState', {}, errorText);
    }
    if (!Array.isArray(post.media)) throw new PublishingOperationError('invalid_request', 'storedPostAttachmentsNeedReviewBeforeQueueing', {}, errorText);

    const targetIds = post.targets.map(t => t.targetId);
    const modes = await resolveScheduleModes(targetIds, options.scheduleMode, options.destinationScheduleModes);
    await context.lockTargets(targetIds);
    const publishingLimits = await limits();
    const firstComment = validFirstComment(post.firstComment ?? '', publishingLimits.maxText, errorText);
    const attachments = validatePostAttachments({ link: post.link ?? undefined, media: (post.media ?? []) as unknown as import('@/platforms/types').PublishMedia[] }, publishingLimits.maxMedia, publishingLimits.maxAlt, errorText);
    const message = validatePostContent(post.message ?? '', publishingLimits.maxText, attachments, errorText);
    const resolvedMedia = await resolvePublishMedia(actor.workspaceId, attachments.media);
    const destinations = await validateTargets(context.actor, targetIds, publishingLimits.maxTargets, resolvedMedia, Boolean(firstComment), attachments.link);
    await resolveAuthorizedDestinationFormats(destinations, undefined, publishingLimits.maxTargets, {media:resolvedMedia,link:attachments.link,firstComment,scheduled:true},{formats:new Map(post.targets.map(t=>[t.targetId,t.formatId ?? null])),legacyFormat:post.format});
    const holdForApproval = !MANAGERS.has(role) && needsContributorApproval(policy[0].requiresApproval, role);

    const suggested = policy[0].bestTimeMode === 'apply'
      ? (await getBestTimeSuggestions(context.actor, { targetIds })).suggestions : [];
    return withPublishingTransaction(context.signal, async tx => {
      // Match queue-slot replacement's advisory key and hold it through allocation and the post write.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
      const lockedAuth = await lockActor(tx, context.actor, 'publishing/queue', true);
      if (lockedAuth.role !== role) throw new PublishingOperationError('conflict', 'yourWorkspaceAccessChangedRefreshAndTryAgain', {}, errorText);
      const postsAuth = await authorizePublishing(context.actor, 'publishing/posts', 'write');
      if (postsAuth.role !== role) throw new PublishingOperationError('conflict', 'yourWorkspaceAccessChangedRefreshAndTryAgain', {}, errorText);
      // The outer workspace-operation guard already holds FOR SHARE on this row;
      // taking FOR UPDATE in the inner transaction would deadlock against it.
      // FOR SHARE still fences concurrent edits to these policy fields.
      const workspace = await tx.$queryRaw<Array<{ timezone: string; requiresApproval: boolean; bestTimeMode: string }>>`SELECT timezone, "requiresApproval", "bestTimeMode" FROM workspaces WHERE id = ${actor.workspaceId} FOR SHARE`;
      if (!workspace[0] || workspace[0].timezone !== policy[0]!.timezone || workspace[0].requiresApproval !== policy[0]!.requiresApproval || workspace[0].bestTimeMode !== policy[0]!.bestTimeMode) {
        throw new PublishingOperationError('conflict', 'workspaceSchedulingSettingsChangedRefreshAndTryAgain', {}, errorText);
      }
      const current = await tx.post.findFirst({
        where: { id: postId, workspaceId: actor.workspaceId },
        select: { id: true, authorId: true, status: true, publishedAt: true, message: true, firstComment: true, format: true, link: true, media: true, targets: { select: { targetId: true, formatId: true, status: true, remotePostId: true } } },
      });
      if (!current || current.authorId !== post.authorId || current.status !== post.status || current.targets.length !== targetIds.length ||
        current.publishedAt || current.message !== post.message || current.firstComment !== post.firstComment || current.format !== post.format || current.link !== post.link ||
        JSON.stringify(current.media) !== JSON.stringify(post.media) || current.targets.some(t => t.status !== 'pending' || t.remotePostId || !targetIds.includes(t.targetId) || t.formatId !== post.targets.find(original => original.targetId === t.targetId)?.formatId)) {
        throw new PublishingOperationError('conflict', 'thisPostChangedWhileItWasBeingQueuedRefresh', {}, errorText);
      }
      const scheduledAt = await allocateQueueTime(tx, actor.workspaceId, workspace[0].timezone, targetIds, new Date(), collaborationBounds.queueLookaheadDays, ...(suggested.length ? [suggested] as const : []));
      if (!scheduledAt) throw new PublishingOperationError('conflict', 'noQueueTimeIsAvailableForThisPostChange', {}, errorText);

      await recordPostVersion(tx, postId, context.actor.userId, retention);
      const changed = await tx.post.updateMany({
        where: { id: postId, workspaceId: actor.workspaceId, status: post.status },
        data: { status: holdForApproval ? 'pending_approval' : 'scheduled', scheduledAt, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new PublishingOperationError('conflict', 'thisPostChangedWhileItWasBeingQueuedRefresh', {}, errorText);
      await storeScheduleModes(tx, actor.workspaceId, postId, modes.byTarget);
      const timezoneUpdated = await tx.$executeRaw`UPDATE posts SET timezone = ${workspace[0].timezone} WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId}`;
      if (timezoneUpdated !== 1) throw new PublishingOperationError('conflict', 'thisPostChangedWhileItWasBeingQueuedRefresh', {}, errorText);
      if (holdForApproval) {
        const approvalUpdated = await tx.$executeRaw`UPDATE posts SET "approvalStatus" = 'pending', "submittedById" = ${context.actor.userId}, "submittedAt" = NOW(), "reviewedById" = NULL, "reviewedAt" = NULL, "reviewNote" = NULL WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId}`;
        if (approvalUpdated === 1) await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: randomUUID(), kind: 'approval_request', postId });
        if (approvalUpdated !== 1) throw new PublishingOperationError('conflict', 'thisPostChangedWhileItWasBeingQueuedRefresh', {}, errorText);
      }
      await recordPostVersion(tx, postId, context.actor.userId, retention);
      await collabAudit(tx, context.actor, 'publishing.post_queued', { postId, scheduledAt: scheduledAt.toISOString(), status: holdForApproval ? 'pending_approval' : 'scheduled', approvalReset: holdForApproval });
      return { postId, scheduledAt, status: holdForApproval ? 'pending_approval' as const : 'scheduled' as const, modes: modes.byTarget };
    });
  });
}
