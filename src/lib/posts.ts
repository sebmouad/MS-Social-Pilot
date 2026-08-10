import { prisma } from './prisma';
import { decryptSecret } from './crypto';
import { stringifyJson, parseMedia, type PostMedia, type LinkPreview } from './json';
import { localInputToUtc, nextAvailableSlot } from './time';
import { resolveMediaForPublish } from './media';
import { resolveLinkPreview } from './facebook/opengraph';
import { publishPost } from './facebook/publish';
import { asGraphError, GraphError } from './facebook/graph';
import { logActivity, publishNow, refreshPostStatus } from './scheduler/runner';
import type { CreatePostInput, UpdatePostInput } from './validation';
import type { PublishMode, TargetType } from './constants';

/**
 * Post lifecycle: composing, scheduling, editing and cancelling.
 *
 * Three scheduling modes coexist, and the difference matters operationally:
 *
 *   immediate — publish during the request.
 *   worker    — we hold the post and publish it at the scheduled time. Works
 *               for Pages and Groups, and stays editable until it goes out.
 *   native    — hand the post to Facebook now with a scheduled_publish_time.
 *               Survives our server being down, but Pages only, and editing
 *               afterwards means deleting it on Facebook and re-creating it.
 */

export interface ResolvedSchedule {
  scheduledAt: Date | null;
  timezone: string;
  publishMode: PublishMode;
  usedQueueSlot: boolean;
}

/**
 * Work out when a post should go out, from whichever of the three inputs the
 * composer supplied (explicit time, queue slot, or "now").
 */
export async function resolveSchedule(
  workspaceId: string,
  input: Pick<CreatePostInput, 'publishMode' | 'scheduledAtLocal' | 'timezone' | 'useQueue' | 'saveAsDraft'>,
  now: Date = new Date(),
): Promise<ResolvedSchedule> {
  if (input.saveAsDraft) {
    return { scheduledAt: null, timezone: input.timezone, publishMode: input.publishMode, usedQueueSlot: false };
  }

  if (input.publishMode === 'immediate') {
    return { scheduledAt: now, timezone: input.timezone, publishMode: 'immediate', usedQueueSlot: false };
  }

  if (input.useQueue) {
    const [slots, taken] = await Promise.all([
      prisma.queueSlot.findMany({ where: { workspaceId } }),
      prisma.post.findMany({
        where: { workspaceId, status: { in: ['scheduled', 'publishing'] }, scheduledAt: { gte: now } },
        select: { scheduledAt: true },
      }),
    ]);

    if (slots.length === 0) {
      throw new GraphError({
        message: 'Your posting queue is empty. Add publishing times in Settings first.',
        kind: 'invalid_request',
      });
    }

    const slot = nextAvailableSlot({
      slots,
      timeZone: input.timezone,
      takenUtc: taken.map((post) => post.scheduledAt).filter((date): date is Date => Boolean(date)),
      now,
    });

    if (!slot) {
      throw new GraphError({
        message: 'Every queue slot in the next 90 days is taken. Add more times or pick a date.',
        kind: 'invalid_request',
      });
    }
    return { scheduledAt: slot, timezone: input.timezone, publishMode: input.publishMode, usedQueueSlot: true };
  }

  if (!input.scheduledAtLocal) {
    throw new GraphError({ message: 'Pick a date and time for this post.', kind: 'invalid_request' });
  }

  const scheduledAt = localInputToUtc(input.scheduledAtLocal, input.timezone);
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new GraphError({
      message: 'That time has already passed. Choose a time in the future.',
      kind: 'invalid_request',
    });
  }

  return { scheduledAt, timezone: input.timezone, publishMode: input.publishMode, usedQueueSlot: false };
}

/** Load the workspace's targets, rejecting ids that do not belong to it. */
async function loadTargets(workspaceId: string, targetIds: string[]) {
  const targets = await prisma.target.findMany({
    where: { id: { in: targetIds }, workspaceId },
    include: { socialAccount: true },
  });

  if (targets.length !== targetIds.length) {
    throw new GraphError({
      message: 'One or more selected destinations are no longer available.',
      kind: 'invalid_request',
    });
  }

  const disabled = targets.filter((target) => !target.enabled);
  if (disabled.length > 0) {
    throw new GraphError({
      message: `These destinations are turned off: ${disabled.map((target) => target.name).join(', ')}.`,
      kind: 'invalid_request',
    });
  }
  return targets;
}

export interface CreatePostResult {
  postId: string;
  status: string;
  scheduledAt: Date | null;
  /** Per-destination outcome, populated for immediate and native publishing. */
  results: Array<{ targetId: string; targetName: string; status: string; url?: string; error?: string }>;
}

export async function createPost(
  context: { workspaceId: string; userId: string },
  input: CreatePostInput,
  now: Date = new Date(),
): Promise<CreatePostResult> {
  const targets = await loadTargets(context.workspaceId, input.targetIds);
  const schedule = await resolveSchedule(context.workspaceId, input, now);

  // Native scheduling is a Pages-only Graph feature; fall back cleanly rather
  // than letting Graph reject the whole batch.
  if (schedule.publishMode === 'native') {
    const groups = targets.filter((target) => target.type === 'group');
    if (groups.length > 0) {
      throw new GraphError({
        message: `Facebook cannot natively schedule Group posts (${groups
          .map((group) => group.name)
          .join(', ')}). Use the built-in scheduler for these.`,
        kind: 'invalid_request',
      });
    }
  }

  // Cache the link's Open Graph card so the composer preview and the post list
  // do not have to re-scrape on every render.
  let linkPreview: LinkPreview | null = null;
  if (input.link) {
    try {
      linkPreview = await resolveLinkPreview(input.link);
    } catch {
      // A preview is a nicety; never block publishing on it.
    }
  }

  const status = input.saveAsDraft ? 'draft' : schedule.publishMode === 'immediate' ? 'publishing' : 'scheduled';

  const post = await prisma.post.create({
    data: {
      workspaceId: context.workspaceId,
      authorId: context.userId,
      message: input.message,
      link: input.link ?? null,
      linkPreview: linkPreview ? stringifyJson(linkPreview) : null,
      media: stringifyJson(input.media),
      status,
      publishMode: schedule.publishMode,
      scheduledAt: schedule.scheduledAt,
      timezone: schedule.timezone,
      targets: {
        create: targets.map((target) => ({ targetId: target.id, status: 'pending' })),
      },
    },
    include: { targets: true },
  });

  await logActivity(context.workspaceId, 'post.created', {
    postId: post.id,
    targets: targets.length,
    mode: schedule.publishMode,
    scheduledAt: schedule.scheduledAt?.toISOString() ?? null,
  }, context.userId);

  if (input.saveAsDraft) {
    return { postId: post.id, status: 'draft', scheduledAt: null, results: [] };
  }

  if (schedule.publishMode === 'immediate') {
    await publishNow(post.id);
    return summarise(post.id);
  }

  if (schedule.publishMode === 'native' && schedule.scheduledAt) {
    await handOffToFacebook(post.id, schedule.scheduledAt);
    return summarise(post.id);
  }

  return { postId: post.id, status, scheduledAt: schedule.scheduledAt, results: [] };
}

/**
 * Create the post on Facebook now, with Facebook holding it until the
 * scheduled time. Each destination is attempted independently so one failure
 * does not strand the rest.
 */
async function handOffToFacebook(postId: string, scheduledAt: Date): Promise<void> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { targets: { include: { target: { include: { socialAccount: true } } } } },
  });

  const media = await resolveMediaForPublish(parseMedia(post.media));

  for (const postTarget of post.targets) {
    const { target } = postTarget;
    try {
      const encrypted = target.accessToken ?? target.socialAccount?.accessToken ?? null;
      if (!encrypted) {
        throw new GraphError({ message: 'No token stored for this destination.', kind: 'auth' });
      }

      const result = await publishPost({
        targetType: target.type as TargetType,
        targetId: target.providerId,
        accessToken: decryptSecret(encrypted),
        message: post.message,
        link: post.link,
        media,
        scheduledPublishTime: scheduledAt,
      });

      await prisma.postTarget.update({
        where: { id: postTarget.id },
        data: {
          status: 'scheduled_remote',
          remotePostId: result.remotePostId,
          remoteUrl: result.remoteUrl,
          nativeScheduledFor: scheduledAt,
          attempts: postTarget.attempts + 1,
          errorCode: null,
          errorMessage: null,
        },
      });
    } catch (error) {
      const graphError = asGraphError(error);
      await prisma.postTarget.update({
        where: { id: postTarget.id },
        data: {
          status: 'failed',
          attempts: postTarget.attempts + 1,
          errorCode: graphError.code ? String(graphError.code) : graphError.kind,
          errorMessage: graphError.displayMessage,
        },
      });
    }
  }

  await refreshPostStatus(postId);
}

async function summarise(postId: string): Promise<CreatePostResult> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { targets: { include: { target: true } } },
  });

  return {
    postId: post.id,
    status: post.status,
    scheduledAt: post.scheduledAt,
    results: post.targets.map((postTarget) => ({
      targetId: postTarget.targetId,
      targetName: postTarget.target.name,
      status: postTarget.status,
      url: postTarget.remoteUrl ?? undefined,
      error: postTarget.errorMessage ?? undefined,
    })),
  };
}

/**
 * Edit a post that has not gone out yet.
 *
 * Published and in-flight posts are refused: Facebook's edit endpoint cannot
 * change a post's attachments, and silently doing nothing would be worse than
 * saying so.
 */
export async function updatePost(
  context: { workspaceId: string; userId: string },
  postId: string,
  input: UpdatePostInput,
): Promise<void> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    include: { targets: true },
  });
  if (!post) throw new GraphError({ message: 'Post not found.', kind: 'invalid_request' });

  if (post.status === 'publishing') {
    throw new GraphError({
      message: 'This post is being published right now and can no longer be edited.',
      kind: 'invalid_request',
    });
  }
  if (post.status === 'published' || post.status === 'partially_failed') {
    throw new GraphError({
      message: 'This post has already been published. Create a new post instead.',
      kind: 'invalid_request',
    });
  }
  if (post.targets.some((target) => target.status === 'scheduled_remote')) {
    throw new GraphError({
      message:
        'This post is scheduled inside Facebook. Cancel it first, which deletes it from Facebook, then schedule a new one.',
      kind: 'invalid_request',
    });
  }

  const data: Record<string, unknown> = {};
  if (input.message !== undefined) data.message = input.message;
  if (input.media !== undefined) data.media = stringifyJson(input.media);
  if (input.publishMode !== undefined) data.publishMode = input.publishMode;
  if (input.timezone !== undefined) data.timezone = input.timezone;

  if (input.link !== undefined) {
    data.link = input.link ?? null;
    data.linkPreview = null;
    if (input.link && input.link !== post.link) {
      try {
        data.linkPreview = stringifyJson(await resolveLinkPreview(input.link));
      } catch {
        // Preview refresh is best-effort.
      }
    } else if (input.link === post.link) {
      data.linkPreview = post.linkPreview;
    }
  }

  if (input.scheduledAtLocal !== undefined) {
    if (input.scheduledAtLocal === null) {
      data.scheduledAt = null;
      data.status = 'draft';
    } else {
      const timezone = input.timezone ?? post.timezone;
      const scheduledAt = localInputToUtc(input.scheduledAtLocal, timezone);
      if (scheduledAt.getTime() <= Date.now()) {
        throw new GraphError({
          message: 'That time has already passed. Choose a time in the future.',
          kind: 'invalid_request',
        });
      }
      data.scheduledAt = scheduledAt;
      data.status = 'scheduled';
    }
  }

  if (input.status !== undefined) data.status = input.status;

  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: postId }, data });

    if (input.targetIds) {
      const valid = await tx.target.findMany({
        where: { id: { in: input.targetIds }, workspaceId: context.workspaceId },
        select: { id: true },
      });
      if (valid.length !== input.targetIds.length) {
        throw new GraphError({ message: 'Unknown destination selected.', kind: 'invalid_request' });
      }

      // Replace the fan-out wholesale; nothing has been published yet, so no
      // per-destination history is lost.
      await tx.postTarget.deleteMany({ where: { postId } });
      await tx.postTarget.createMany({
        data: valid.map((target) => ({ postId, targetId: target.id, status: 'pending' })),
      });
    }

    // A retried post starts from a clean slate on every destination.
    if (data.status === 'scheduled') {
      await tx.postTarget.updateMany({
        where: { postId, status: { in: ['failed', 'cancelled'] } },
        data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorCode: null, errorMessage: null },
      });
    }
  });

  await logActivity(context.workspaceId, 'post.updated', { postId }, context.userId);
}

/**
 * Cancel a scheduled post. Destinations already handed to Facebook are deleted
 * remotely, because otherwise "cancelled" here would still publish there.
 */
export async function cancelPost(
  context: { workspaceId: string; userId: string },
  postId: string,
): Promise<{ removedFromFacebook: number; errors: string[] }> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    include: { targets: { include: { target: { include: { socialAccount: true } } } } },
  });
  if (!post) throw new GraphError({ message: 'Post not found.', kind: 'invalid_request' });

  const errors: string[] = [];
  let removedFromFacebook = 0;

  for (const postTarget of post.targets) {
    if (postTarget.status === 'scheduled_remote' && postTarget.remotePostId) {
      try {
        const encrypted = postTarget.target.accessToken ?? postTarget.target.socialAccount?.accessToken ?? null;
        if (encrypted) {
          const { deleteRemotePost } = await import('./facebook/publish');
          await deleteRemotePost(postTarget.remotePostId, decryptSecret(encrypted));
          removedFromFacebook += 1;
        }
      } catch (error) {
        errors.push(`${postTarget.target.name}: ${asGraphError(error).displayMessage}`);
      }
    }
  }

  await prisma.postTarget.updateMany({
    where: { postId, status: { in: ['pending', 'scheduled_remote', 'failed'] } },
    data: { status: 'cancelled', nextAttemptAt: null },
  });
  await prisma.post.update({ where: { id: postId }, data: { status: 'cancelled' } });

  await logActivity(context.workspaceId, 'post.cancelled', { postId, removedFromFacebook }, context.userId);
  return { removedFromFacebook, errors };
}

/** Reset failed destinations so the scheduler picks them up again. */
export async function retryPost(
  context: { workspaceId: string; userId: string },
  postId: string,
): Promise<number> {
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: context.workspaceId } });
  if (!post) throw new GraphError({ message: 'Post not found.', kind: 'invalid_request' });

  const { count } = await prisma.postTarget.updateMany({
    where: { postId, status: 'failed' },
    data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorCode: null, errorMessage: null },
  });

  if (count > 0) {
    await prisma.post.update({
      where: { id: postId },
      // Due immediately: a manual retry should not wait for the original slot.
      data: { status: 'scheduled', scheduledAt: new Date() },
    });
  }

  await logActivity(context.workspaceId, 'post.retried', { postId, destinations: count }, context.userId);
  return count;
}

export async function duplicatePost(
  context: { workspaceId: string; userId: string },
  postId: string,
): Promise<string> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    include: { targets: true },
  });
  if (!post) throw new GraphError({ message: 'Post not found.', kind: 'invalid_request' });

  const copy = await prisma.post.create({
    data: {
      workspaceId: post.workspaceId,
      authorId: context.userId,
      message: post.message,
      link: post.link,
      linkPreview: post.linkPreview,
      media: post.media,
      status: 'draft',
      publishMode: post.publishMode,
      timezone: post.timezone,
      targets: { create: post.targets.map((target) => ({ targetId: target.targetId, status: 'pending' })) },
    },
  });
  return copy.id;
}

export function mediaFromInput(media: CreatePostInput['media']): PostMedia[] {
  return media.map((item) => ({
    id: item.id,
    kind: item.kind,
    url: item.url,
    storageKey: item.storageKey,
    mimeType: item.mimeType,
    altText: item.altText,
  }));
}
