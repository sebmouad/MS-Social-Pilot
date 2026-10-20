import { prisma } from '@/server/data';
import { FIRST_COMMENT_LABELS, FIRST_COMMENT_REJECTED, firstCommentState } from '../first-comment-state';
import { parsePublishingMedia } from '../media-support';
import type { ScheduleMode } from '../remote-scheduling';
import type { DestinationScheduleModes } from './schedule-modes';
import { createPost } from './lifecycle';
import { readPublishingPostList } from './read';
import type { PublishingActor } from './types';

/**
 * Thin seams for key-authenticated surfaces (MCP list_posts, REST /api/v1/posts). They wrap the existing Publishing services without
 * adding or duplicating rules: authorization, channel ceilings, approval holds, format and media validation and audit all live in
 * `readPublishingPostList` and `createPost`.
 */

/** The bounded post list with per-destination first-comment state, exactly as the MCP `list_posts` tool returns it. */
export async function listPostsWithFirstComment(actor: PublishingActor, input: unknown, maxItems: number) {
  const posts = await readPublishingPostList(actor, input, { maxItems });
  return posts.map(post => ({ ...post, targets: post.targets.map(row => {
    const state = firstCommentState(post.firstComment, row);
    return { id: row.id, status: row.status, remotePostId: row.remotePostId, remoteUrl: row.remoteUrl, publishedAt: row.publishedAt, target: row.target,
      firstComment: { state, retryAvailable: state === 'ready' && row.firstCommentError === FIRST_COMMENT_REJECTED, label: FIRST_COMMENT_LABELS[state], ...(row.firstCommentAt ? { attemptedAt: row.firstCommentAt } : {}), ...(row.firstCommentId ? { remoteCommentId: row.firstCommentId } : {}), errorPresent: Boolean(row.firstCommentError) } };
  }) }));
}

export type ApiPostInput = {
  message: string; targetIds: string[]; firstComment?: string; firstCommentDelayMinutes?: number; link?: string;
  media?: unknown; destinationFormats?: Record<string, string>; scheduledAt?: Date;
  scheduleMode?: ScheduleMode; destinationScheduleModes?: DestinationScheduleModes;
};

/**
 * Create a post as the actor: a local draft, or (with `scheduledAt`) a scheduled one. The shared `createPost` decides whether a
 * contributor's scheduled post is held for approval; the resulting status is read back so callers see the real outcome.
 */
export async function createPostForApi(actor: PublishingActor, input: ApiPostInput) {
  const media = parsePublishingMedia(input.media ?? []);
  const created = await createPost(actor, {
    message: input.message, firstComment: input.firstComment ?? '',
    ...(input.firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes: input.firstCommentDelayMinutes }),
    destinationFormats: input.destinationFormats, targetIds: input.targetIds, link: input.link, media,
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt, ...(input.scheduleMode ? { scheduleMode: input.scheduleMode } : {}), ...(input.destinationScheduleModes ? { destinationScheduleModes: input.destinationScheduleModes } : {}) } : {}),
  });
  const { id } = created;
  const row = await prisma.post.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { status: true, scheduledAt: true } });
  return { id, status: row?.status ?? (input.scheduledAt ? 'scheduled' : 'draft'), scheduledAt: row?.scheduledAt ?? null,
    ...(input.scheduledAt ? { scheduleMode: created.scheduleMode, destinationScheduleModes: created.destinationScheduleModes, remoteHold: created.remoteHold } : {}) };
}
