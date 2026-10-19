import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { loadEntitlements } from '@/server/entitlements';
import type { PublishMedia } from '@/platforms/types';
import { limits, validatePostContent, validFirstComment, validateTargets, resolvePublishMedia, validatePostAttachments } from '@/server/publishing/lifecycle';
import { withPublishingOperation, withPublishingTransaction } from './guard';
import { selectedPublishingTargetIds, publishingPostVisibilityWhere } from './read-scope';
import type { PublishingActor } from './types';
import { loadVersionRetention, recordPostVersion } from '../collaboration/server/versions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MANAGERS = new Set(['owner', 'admin', 'editor']);

function parseInput(input: unknown): { sourcePostId: string; requestId: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_request', 'Choose a valid post to duplicate.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 3 || typeof value.postId !== 'string' || !value.postId || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || value.confirmation !== `DUPLICATE POST ${value.postId}`) {
    throw new OperationError('invalid_request', 'Confirm duplication of this post and provide a valid request ID.');
  }
  return { sourcePostId: value.postId, requestId: value.requestId };
}

/** Create a local draft copy. The source post lock serializes retries and its
 * complete current visibility is checked before consulting the receipt. */
export async function duplicatePost(actor: PublishingActor, input: unknown): Promise<{ sourcePostId: string; postId: string; draftCreated: true; replayed: boolean }> {
  const { sourcePostId, requestId } = parseInput(input);
  return withPublishingOperation(actor, { postId: sourcePostId }, async context => {
    const entitlements = await loadEntitlements(context.actor.userId, context.actor.workspaceId);
    if (!entitlements) throw new OperationError('unavailable', 'This workspace is unavailable.');
    const selectedIds = await selectedPublishingTargetIds(context.actor.workspaceId, entitlements, context.actor.allowedTargetIds);
    const source = await prisma.post.findFirst({
      where: { id: sourcePostId, ...publishingPostVisibilityWhere(context.actor.workspaceId, selectedIds, context.actor.allowedTargetIds !== undefined || context.role === 'contributor' ? context.actor.userId : undefined) },
      select: { id: true, workspaceId: true, authorId: true, message: true, firstComment: true, format: true, link: true, media: true, status: true, scheduledAt: true, publishedAt: true,
        targets: { select: { targetId: true, status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true, publishedAt: true } } },
    });
    if (!source || (context.role === 'contributor' && source.authorId !== context.actor.userId)) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
    if (!MANAGERS.has(context.role) && !(context.role === 'contributor' && source.authorId === context.actor.userId)) throw new OperationError('forbidden', 'You do not have permission to duplicate posts.');

    const receiptId = `duplicate:${requestId}`;
    const receipt = await prisma.$queryRaw<Array<{ actorId: string | null; action: string; detail: unknown }>>`SELECT "actorId", action, detail FROM root_activities WHERE id = ${receiptId}`;
    if (receipt.length) {
      const detail = receipt[0]!.detail as Record<string, unknown> | null;
      if (receipt[0]!.actorId !== context.actor.userId || receipt[0]!.action !== 'publishing.post_duplicated' || detail?.workspaceId !== context.actor.workspaceId || detail?.sourcePostId !== sourcePostId || detail?.requestId !== requestId || detail?.postId !== requestId) throw new OperationError('conflict', 'This duplication request ID is already in use.');
      const existing = await prisma.post.findFirst({ where: { id: requestId, workspaceId: context.actor.workspaceId, authorId: context.actor.userId }, select: { id: true } });
      if (!existing) throw new OperationError('conflict', 'The draft created by this request is no longer available.');
      return { sourcePostId, postId: requestId, draftCreated: true, replayed: true };
    }
    if (['processing', 'publishing', 'scheduled_remote'].includes(source.status) || source.targets.some(target => target.status === 'processing' || target.status === 'scheduled_remote')) {
      throw new OperationError('conflict', 'This post has an uncertain or active publishing state and cannot be duplicated.');
    }
    const config = await limits();
    const firstComment = validFirstComment(source.firstComment ?? '', config.maxText);
    if (!Array.isArray(source.media)) throw new OperationError('invalid_request', 'Stored post attachments need review before duplication.');
    const attachments = validatePostAttachments({ link: source.link ?? undefined, media: source.media as unknown as PublishMedia[] }, config.maxMedia, config.maxAlt);
    const message = validatePostContent(source.message, config.maxText, attachments);
    const media = await resolvePublishMedia(context.actor.workspaceId, attachments.media);
    const targets = await validateTargets(context.actor, source.targets.map(target => target.targetId), config.maxTargets, media, Boolean(firstComment), attachments.link, source.format);
    const retention = await loadVersionRetention();
    const now = new Date();
    try {
      await withPublishingTransaction(context.signal, async tx => {
        await tx.post.create({ data: { id: requestId, workspaceId: context.actor.workspaceId, authorId: context.actor.userId, format: source.format, message, firstComment, link: attachments.link, media: attachments.media, status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
          targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, status: 'pending' as const })) } } });
        await recordPostVersion(tx, requestId, context.actor.userId, retention);
        const detail = JSON.stringify({ workspaceId: context.actor.workspaceId, postId: requestId, sourcePostId, requestId });
        await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${receiptId}, ${context.actor.userId}, 'publishing.post_duplicated', ${detail}::jsonb, ${now})`;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002') throw new OperationError('conflict', 'This duplication request ID is already in use.');
      throw error;
    }
    return { sourcePostId, postId: requestId, draftCreated: true, replayed: false };
  });
}
