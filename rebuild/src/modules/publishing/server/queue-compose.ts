import { getBestTimeSuggestions } from './best-time';
import { isValidTimeZone } from '@/lib/calendar-dates';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { allocateQueueTime } from '@/modules/publishing/collaboration/server/executors';
import { bounds } from '@/modules/publishing/collaboration/server/core';
import { authorizePublishing } from '@/modules/publishing/server/access';
import { createPost, updatePost, validateTargets, limits } from '@/modules/publishing/server/lifecycle';
import { queuePost } from '@/modules/publishing/server/queue';
import type { PublishingActor } from '@/modules/publishing/server/types';

export type QueuePreview = {
  /** The time the post will take: the first free time every selected channel shares. Null when none is free. */
  scheduledAt: Date | null;
  /** The next free time each channel would have on its own, for context. */
  channels: Array<{ targetId: string; nextAt: Date | null }>;
};

/**
 * Read-only look at where "Add to queue" would place a post for these channels. It takes no lock, so the time is an
 * estimate: the save allocates under the workspace lock and reports the time it really assigned.
 */
export async function previewQueueTimes(actor: PublishingActor, targetIds: readonly string[]): Promise<QueuePreview> {
  const auth = await authorizePublishing(actor, 'publishing/queue', 'read');
  const max = (await limits()).maxTargets;
  if (!Array.isArray(targetIds) || targetIds.some(id => typeof id !== 'string')) throw new OperationError('invalid_request', 'Choose valid destinations.');
  const ids = [...new Set(targetIds)];
  if (!ids.length || ids.length > max) throw new OperationError('invalid_request', 'Choose at least one destination to see its queue time.');
  const allowed = auth.actor.allowedTargetIds;
  if (allowed && ids.some(id => !allowed.includes(id))) throw new OperationError('forbidden', 'One or more destinations are outside your channel access.');
  await validateTargets(auth.actor, ids, max);
  const rows = await prisma.$queryRaw<Array<{ timezone: string; bestTimeMode: string }>>`SELECT timezone, "bestTimeMode" FROM workspaces WHERE id = ${actor.workspaceId}`;
  const timezone = rows[0]?.timezone;
  if (typeof timezone !== 'string' || !isValidTimeZone(timezone)) throw new OperationError('unavailable', 'Workspace scheduling settings are unavailable.');
  const days = (await bounds()).queueLookaheadDays;
  const now = new Date();
  const suggested = rows[0]?.bestTimeMode === 'apply' ? (await getBestTimeSuggestions(auth.actor, { targetIds: ids }, now)).suggestions : [];
  const preference = suggested.length ? [suggested] as const : [];
  const [scheduledAt, ...channels] = await Promise.all([
    allocateQueueTime(prisma, actor.workspaceId, timezone, ids, now, days, ...preference),
    ...ids.map(id => allocateQueueTime(prisma, actor.workspaceId, timezone, [id], now, days, ...preference)),
  ]);
  return { scheduledAt: scheduledAt ?? null, channels: ids.map((targetId, index) => ({ targetId, nextAt: channels[index] ?? null })) };
}

type ComposedPost = Parameters<typeof createPost>[1];

/** The post was saved as a draft but could not be queued; the draft id lets a retry reuse it instead of duplicating it. */
export class QueueAfterSaveError extends Error {
  constructor(readonly draftPostId: string, readonly cause: unknown) {
    super(cause instanceof Error && cause.message ? cause.message : 'The post could not be added to the queue.');
  }
}

/**
 * Composer "Add to queue": save the post as a draft, then place it in the next free queue time through the ordinary queue
 * service. A retry with `draftPostId` updates that draft rather than creating a second post.
 */
export async function createQueuedPost(actor: PublishingActor, input: Omit<ComposedPost, 'scheduledAt'>, draftPostId?: string) {
  await authorizePublishing(actor, 'publishing/queue', 'write');
  const { scheduleMode, destinationScheduleModes, ...content } = input;
  let postId = draftPostId;
  if (postId) await updatePost(actor, { ...content, postId });
  else postId = (await createPost(actor, content)).id;
  try {
    const receipt = await queuePost(actor, postId, { ...(scheduleMode ? { scheduleMode } : {}), ...(destinationScheduleModes ? { destinationScheduleModes } : {}) });
    return { postId, scheduledAt: receipt.scheduledAt, status: receipt.status, scheduleMode: receipt.scheduleMode, remoteHold: receipt.remoteHold };
  } catch (error) {
    throw new QueueAfterSaveError(postId, error);
  }
}
