
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { resolveAuthorizedDestinationFormats } from './formats';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { loadEntitlements } from '@/server/entitlements';
import type { PublishMedia } from '@/platforms/types';
import { limits, validatePostContent, validFirstComment, validateTargets, resolvePublishMedia, validatePostAttachments } from '@/modules/publishing/server/lifecycle';
import { withPublishingOperation, withPublishingTransaction } from './guard';
import { selectedPublishingTargetIds, publishingPostVisibilityWhere } from './read-scope';
import type { PublishingActor } from './types';
import { loadVersionRetention, recordPostVersion } from '../collaboration/server/versions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MANAGERS = new Set(['owner', 'admin', 'editor']);

function parseInput(input: unknown, errorText: PublishingErrorText = defaultPublishingErrorText): { sourcePostId: string; requestId: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublishingOperationError('invalid_request', 'chooseAValidPostToDuplicate', {}, errorText);
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 3 || typeof value.postId !== 'string' || !value.postId || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || value.confirmation !== `DUPLICATE POST ${value.postId}`) {
    throw new PublishingOperationError('invalid_request', 'confirmDuplicationOfThisPostAndProvideAValid', {}, errorText);
  }
  return { sourcePostId: value.postId, requestId: value.requestId };
}

/** Create a local draft copy. The source post lock serializes retries and its
 * complete current visibility is checked before consulting the receipt. */
export async function duplicatePost(actor: PublishingActor, input: unknown): Promise<{ sourcePostId: string; postId: string; draftCreated: true; replayed: boolean }> {
  const errorText = await loadPublishingErrorText();
  const { sourcePostId, requestId } = parseInput(input, errorText);
  return withPublishingOperation(actor, { postId: sourcePostId }, async context => {
    const entitlements = await loadEntitlements(context.actor.userId, context.actor.workspaceId);
    if (!entitlements) throw new PublishingOperationError('unavailable', 'thisWorkspaceIsUnavailable', {}, errorText);
    const selectedIds = await selectedPublishingTargetIds(context.actor.workspaceId, entitlements, context.actor.allowedTargetIds);
    const source = await prisma.post.findFirst({
      where: { id: sourcePostId, ...publishingPostVisibilityWhere(context.actor.workspaceId, selectedIds, context.actor.allowedTargetIds !== undefined || context.role === 'contributor' ? context.actor.userId : undefined) },
      select: { id: true, workspaceId: true, authorId: true, message: true, firstComment: true, firstCommentDelayMinutes: true, format: true, link: true, media: true, status: true, scheduledAt: true, publishedAt: true,
        targets: { select: { targetId: true, formatId: true, status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true, publishedAt: true } } },
    });
    if (!source || (context.role === 'contributor' && source.authorId !== context.actor.userId)) throw new PublishingOperationError('not_found', 'thisPostIsUnavailableInTheCurrentWorkspace', {}, errorText);
    if (!MANAGERS.has(context.role) && !(context.role === 'contributor' && source.authorId === context.actor.userId)) throw new PublishingOperationError('forbidden', 'youDoNotHavePermissionToDuplicatePosts', {}, errorText);

    const receiptId = `duplicate:${requestId}`;
    const receipt = await prisma.$queryRaw<Array<{ actorId: string | null; action: string; detail: unknown }>>`SELECT "actorId", action, detail FROM root_activities WHERE id = ${receiptId}`;
    if (receipt.length) {
      const detail = receipt[0]!.detail as Record<string, unknown> | null;
      if (receipt[0]!.actorId !== context.actor.userId || receipt[0]!.action !== 'publishing.post_duplicated' || detail?.workspaceId !== context.actor.workspaceId || detail?.sourcePostId !== sourcePostId || detail?.requestId !== requestId || detail?.postId !== requestId) throw new PublishingOperationError('conflict', 'thisDuplicationRequestIDIsAlreadyInUse', {}, errorText);
      const existing = await prisma.post.findFirst({ where: { id: requestId, workspaceId: context.actor.workspaceId, authorId: context.actor.userId }, select: { id: true } });
      if (!existing) throw new PublishingOperationError('conflict', 'theDraftCreatedByThisRequestIsNoLonger', {}, errorText);
      return { sourcePostId, postId: requestId, draftCreated: true, replayed: true };
    }
    if (['processing', 'publishing', 'scheduled_remote'].includes(source.status) || source.targets.some(target => target.status === 'processing' || target.status === 'scheduled_remote')) {
      throw new PublishingOperationError('conflict', 'thisPostHasAnUncertainOrActivePublishingState', {}, errorText);
    }
    const config = await limits();
    const firstComment = validFirstComment(source.firstComment ?? '', config.maxText, errorText);
    if (!Array.isArray(source.media)) throw new PublishingOperationError('invalid_request', 'storedPostAttachmentsNeedReviewBeforeDuplication', {}, errorText);
    const attachments = validatePostAttachments({ link: source.link ?? undefined, media: source.media as unknown as PublishMedia[] }, config.maxMedia, config.maxAlt, errorText);
    const message = validatePostContent(source.message, config.maxText, attachments, errorText);
    const media = await resolvePublishMedia(context.actor.workspaceId, attachments.media);
    const targets = await validateTargets(context.actor, source.targets.map(target => target.targetId), config.maxTargets, media, Boolean(firstComment), attachments.link);
    const destinationFormats = await resolveAuthorizedDestinationFormats(targets, undefined, config.maxTargets, {media,link:attachments.link,firstComment}, {formats:new Map(source.targets.map(t=>[t.targetId,t.formatId ?? null])),legacyFormat:source.format});
    const retention = await loadVersionRetention();
    const now = new Date();
    try {
      await withPublishingTransaction(context.signal, async tx => {
        await tx.post.create({ data: { id: requestId, workspaceId: context.actor.workspaceId, authorId: context.actor.userId, format: source.format, message, firstComment, firstCommentDelayMinutes: source.firstCommentDelayMinutes ?? 0, link: attachments.link, media: attachments.media, status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
          targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, formatId: destinationFormats[target.id], status: 'pending' as const })) } } });
        await recordPostVersion(tx, requestId, context.actor.userId, retention);
        const detail = JSON.stringify({ workspaceId: context.actor.workspaceId, postId: requestId, sourcePostId, requestId });
        await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${receiptId}, ${context.actor.userId}, 'publishing.post_duplicated', ${detail}::jsonb, ${now})`;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002') throw new PublishingOperationError('conflict', 'thisDuplicationRequestIDIsAlreadyInUse', {}, errorText);
      throw error;
    }
    return { sourcePostId, postId: requestId, draftCreated: true, replayed: false };
  });
}
