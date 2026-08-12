import { prisma } from './prisma';
import { env } from './env';
import { decryptSecret } from './crypto';
import {
  mediaColumns,
  toJson,
  toJsonOrNull,
  parseMedia,
  parseLinkPreview,
  type PostMedia,
  type LinkPreview,
} from './json';
import { localInputToUtc, nextAvailableSlot, wallClockExists } from './time';
import { resolveMediaForPublish } from './media';
import { resolveLinkPreview } from './facebook/opengraph';
import { publishPost } from './facebook/publish';
import { asGraphError, GraphError } from './facebook/graph';
import { errors } from './errors';
import { logActivity, publishNow, refreshPostStatus } from './scheduler/runner';
import type { CreatePostInput, UpdatePostInput } from './validation';
import type { PublishMode, TargetType } from './constants';
import { initialApprovalStatus } from './approvals';
import {
  canManageOthersPosts,
  canPublishWithoutApproval,
  postEditBlocker,
  PUBLISHABLE_APPROVAL_STATUSES,
  QUEUE_OCCUPYING_STATUSES,
} from './constants';
import { notifyApprovalRequest } from './email/notify';
import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

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

/**
 * The slice of the client both `prisma` and a transaction handle satisfy.
 *
 * Queue allocation has to be able to run inside the same transaction as the
 * post it is allocating for; everything else keeps calling it with the plain
 * client and never notices.
 */
type PrismaClientLike = Pick<typeof prisma, 'queueSlot' | 'post'>;

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
  /** Runs inside the caller's transaction when the queue is being allocated. */
  client: PrismaClientLike = prisma,
): Promise<ResolvedSchedule> {
  if (input.saveAsDraft) {
    return { scheduledAt: null, timezone: input.timezone, publishMode: input.publishMode, usedQueueSlot: false };
  }

  if (input.publishMode === 'immediate') {
    return { scheduledAt: now, timezone: input.timezone, publishMode: 'immediate', usedQueueSlot: false };
  }

  if (input.useQueue) {
    const [slots, taken] = await Promise.all([
      client.queueSlot.findMany({ where: { workspaceId } }),
      client.post.findMany({
        where: {
          workspaceId,
          status: { in: [...QUEUE_OCCUPYING_STATUSES] },
          scheduledAt: { gte: now },
        },
        select: { scheduledAt: true },
      }),
    ]);

    if (slots.length === 0) throw errors.queueEmpty();

    const slot = nextAvailableSlot({
      slots,
      timeZone: input.timezone,
      takenUtc: taken.map((post) => post.scheduledAt).filter((date): date is Date => Boolean(date)),
      now,
    });

    if (!slot) throw errors.queueFull();
    return { scheduledAt: slot, timezone: input.timezone, publishMode: input.publishMode, usedQueueSlot: true };
  }

  if (!input.scheduledAtLocal) throw errors.pickDateTime();

  // Once a year an hour does not happen, and the conversion does not object:
  // it quietly returns an instant an hour before the one that was asked for.
  // Silently moving somebody's post is worse than refusing to schedule it.
  if (!wallClockExists(input.scheduledAtLocal, input.timezone)) {
    throw errors.clocksGoForward(input.scheduledAtLocal.slice(11, 16));
  }

  const scheduledAt = localInputToUtc(input.scheduledAtLocal, input.timezone);
  if (scheduledAt.getTime() <= now.getTime()) throw errors.timePassed();

  return { scheduledAt, timezone: input.timezone, publishMode: input.publishMode, usedQueueSlot: false };
}

/** Load the workspace's targets, rejecting ids that do not belong to it. */
async function loadTargets(workspaceId: string, targetIds: string[]) {
  const targets = await prisma.target.findMany({
    where: { id: { in: targetIds }, workspaceId },
    include: { socialAccount: true },
  });

  if (targets.length !== targetIds.length) throw errors.targetsUnavailable();

  const disabled = targets.filter((target) => !target.enabled);
  if (disabled.length > 0) {
    throw errors.targetsDisabled(disabled.map((target) => target.name).join(', '));
  }
  return targets;
}

/**
 * Refuse a CSV bigger than one request should take on.
 *
 * Nothing bounded this. Each row can scrape its link for a preview card, so a
 * few thousand rows is one request making a few thousand outbound fetches: it
 * runs for minutes, and on a platform with a request timeout it is killed
 * part-way, leaving posts scheduled that the uploader never saw confirmed and
 * cannot tell apart from the ones that failed. Refusing the whole file is the
 * kinder answer — nothing was scheduled, and there is nothing to reconcile.
 */
export function assertBulkRowsAllowed(rows: number): void {
  const limit = env.bulkRowLimit;
  if (rows > limit) throw errors.bulkTooManyRows(rows, limit);
}

export interface CreatePostResult {
  postId: string;
  status: string;
  scheduledAt: Date | null;
  /** Per-destination outcome, populated for immediate and native publishing. */
  results: Array<{ targetId: string; targetName: string; status: string; url?: string; error?: string }>;
}

export async function createPost(
  context: { workspaceId: string; userId: string; role: WorkspaceRole; requiresApproval: boolean },
  input: CreatePostInput,
  now: Date = new Date(),
): Promise<CreatePostResult> {
  const targets = await loadTargets(context.workspaceId, input.targetIds);

  // Decided once, here, and stored on the row: recomputing it later from
  // settings that may since have changed would let a post slip through.
  const approvalStatus = initialApprovalStatus({
    requiresApproval: context.requiresApproval,
    role: context.role,
    saveAsDraft: input.saveAsDraft,
  });
  const needsApproval = approvalStatus === ApprovalStatus.pending;

  // Native scheduling is a Pages-only Graph feature; fall back cleanly rather
  // than letting Graph reject the whole batch.
  if (input.publishMode === 'native') {
    const groups = targets.filter((target) => target.type === 'group');
    if (groups.length > 0) {
      throw errors.nativeGroupsUnsupported(groups.map((group) => group.name).join(', '));
    }

    // Instagram has no equivalent at all: its API publishes immediately, so
    // "let Instagram hold it" would silently become "publish it now".
    const instagram = targets.filter((target) => target.type === 'instagram');
    if (instagram.length > 0) {
      throw errors.nativeInstagramUnsupported(instagram.map((item) => item.name).join(', '));
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

  /**
   * Pick the time and write the row together.
   *
   * Split apart, they race: two people pressing "add to queue" both read the
   * same set of taken slots and are both handed the same one. The window is not
   * theoretical — the Open Graph scrape above sits between the two halves, so it
   * can be seconds wide, and the result is the double-booking the queue exists
   * to prevent.
   */
  const write = async (client: PrismaClientLike, at: Date = now) => {
    const schedule = await resolveSchedule(context.workspaceId, input, at, client);

    const status: PostStatus = input.saveAsDraft
      ? PostStatus.draft
      : needsApproval
        ? PostStatus.pending_approval
        : schedule.publishMode === 'immediate'
          ? PostStatus.publishing
          : PostStatus.scheduled;

    const created = await client.post.create({
      data: {
        workspaceId: context.workspaceId,
        authorId: context.userId,
        message: input.message,
        link: input.link ?? null,
        linkPreview: toJsonOrNull(linkPreview),
        ...mediaColumns(input.media),
        status,
        approvalStatus,
        submittedById: needsApproval ? context.userId : null,
        submittedAt: needsApproval ? now : null,
        publishMode: schedule.publishMode,
        scheduledAt: schedule.scheduledAt,
        timezone: schedule.timezone,
        targets: {
          create: targets.map((target) => ({ targetId: target.id, status: 'pending' })),
        },
      },
      include: { targets: true },
    });

    return { post: created, schedule, status };
  };

  const allocatesSlot = !input.saveAsDraft && input.publishMode !== 'immediate' && input.useQueue;

  const written = allocatesSlot
    ? await prisma.$transaction(async (tx) => {
        // Serialised per workspace, so concurrent requests queue up behind each
        // other rather than reading the same free slot. Transaction-scoped, so
        // it is released with the transaction whatever happens — including a
        // rollback — and one workspace never blocks another.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.workspaceId}))`;
        return write(tx);
      })
    : await write(prisma);

  const { post, schedule, status } = written;

  await logActivity(context.workspaceId, 'post.created', {
    postId: post.id,
    targets: targets.length,
    mode: schedule.publishMode,
    scheduledAt: schedule.scheduledAt?.toISOString() ?? null,
  }, context.userId);

  if (input.saveAsDraft) {
    return { postId: post.id, status: PostStatus.draft, scheduledAt: null, results: [] };
  }

  // Held for review: no publishing of any kind happens now, including
  // "publish immediately", which is exactly what approval is for.
  if (needsApproval) {
    const author = await prisma.user.findUniqueOrThrow({ where: { id: context.userId } });
    await notifyApprovalRequest({
      workspaceId: context.workspaceId,
      authorName: author.name,
      scheduledAt: schedule.scheduledAt,
    });
    return { postId: post.id, status, scheduledAt: schedule.scheduledAt, results: [] };
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
/** Contributors act on their own posts; editors and above on anyone's. */
function assertMayAct(
  post: { authorId: string },
  context: { userId: string; role: WorkspaceRole },
): void {
  if (post.authorId !== context.userId && !canManageOthersPosts(context.role)) {
    throw errors.noPermission();
  }
}

/**
 * Whether an edit changes anything the reviewer actually looked at.
 *
 * Compared against the stored row rather than assumed from the request,
 * because the composer PATCHes the whole form: treating every save as a change
 * would bounce a post back into the queue for opening and closing it.
 */
function changesWhatWasReviewed(
  post: { message: string; link: string | null; mediaKeys: string[]; scheduledAt: Date | null },
  currentTargetIds: string[],
  input: UpdatePostInput,
  nextScheduledAt: Date | null | undefined,
): boolean {
  if (input.message !== undefined && input.message !== post.message) return true;
  if (input.link !== undefined && (input.link ?? null) !== post.link) return true;

  if (input.media !== undefined) {
    const next = mediaColumns(input.media).mediaKeys;
    if (next.length !== post.mediaKeys.length) return true;
    if (next.some((key, index) => key !== post.mediaKeys[index])) return true;
  }

  if (nextScheduledAt !== undefined) {
    const before = post.scheduledAt?.getTime() ?? null;
    const after = nextScheduledAt?.getTime() ?? null;
    if (before !== after) return true;
  }

  if (input.targetIds !== undefined) {
    const before = [...currentTargetIds].sort();
    const after = [...input.targetIds].sort();
    if (before.length !== after.length) return true;
    if (after.some((id, index) => id !== before[index])) return true;
  }

  return false;
}

/**
 * Edit a post.
 *
 * The subtle part is approval. A contributor whose post has been approved can
 * still edit it right up until it publishes, and without this the reviewer's
 * decision travels with the row rather than with the content — sign-off on one
 * message, a different one goes out. So an edit by someone who cannot publish
 * without review sends the post back to the queue.
 *
 * Editors and above keep their approval, because they never needed it: in a
 * workspace with review on, `initialApprovalStatus` already grants them
 * `approved` at creation, and bouncing their own edits into a queue they are
 * exempt from would be theatre.
 */
export async function updatePost(
  context: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    requiresApproval: boolean;
  },
  postId: string,
  input: UpdatePostInput,
): Promise<void> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    include: { targets: true },
  });
  if (!post) throw errors.postNotFound();

  assertMayAct(post, context);

  const blocker = postEditBlocker(post);
  if (blocker === 'publishing') throw errors.alreadyPublishing();
  if (blocker === 'published') throw errors.alreadyPublished();
  if (blocker === 'scheduled_remote') throw errors.scheduledInFacebook();

  const data: Record<string, unknown> = {};
  if (input.message !== undefined) data.message = input.message;
  if (input.media !== undefined) {
    // Both columns or neither: stale keys would let a file in use be swept.
    const columns = mediaColumns(input.media);
    data.media = columns.media;
    data.mediaKeys = columns.mediaKeys;
  }
  if (input.publishMode !== undefined) data.publishMode = input.publishMode;
  if (input.timezone !== undefined) data.timezone = input.timezone;

  if (input.link !== undefined) {
    data.link = input.link ?? null;
    data.linkPreview = toJsonOrNull(null);
    if (input.link && input.link !== post.link) {
      try {
        data.linkPreview = toJson(await resolveLinkPreview(input.link));
      } catch {
        // Preview refresh is best-effort.
      }
    } else if (input.link === post.link) {
      data.linkPreview = toJsonOrNull(parseLinkPreview(post.linkPreview));
    }
  }

  let nextScheduledAt: Date | null | undefined;
  if (input.scheduledAtLocal !== undefined) {
    if (input.scheduledAtLocal === null) {
      data.scheduledAt = null;
      data.status = 'draft';
      nextScheduledAt = null;
    } else {
      const timezone = input.timezone ?? post.timezone;
      if (!wallClockExists(input.scheduledAtLocal, timezone)) {
        throw errors.clocksGoForward(input.scheduledAtLocal.slice(11, 16));
      }

      const scheduledAt = localInputToUtc(input.scheduledAtLocal, timezone);
      if (scheduledAt.getTime() <= Date.now()) {
        throw new GraphError({
          message: 'That time has already passed. Choose a time in the future.',
          kind: 'invalid_request',
        });
      }
      data.scheduledAt = scheduledAt;
      data.status = 'scheduled';
      nextScheduledAt = scheduledAt;
    }
  }

  if (input.status !== undefined) data.status = input.status;

  // Send it back for review if the reviewer's decision no longer covers what
  // is about to go out. Checked before the write, against the stored row.
  const needsReReview =
    context.requiresApproval &&
    post.approvalStatus === ApprovalStatus.approved &&
    !canPublishWithoutApproval(context.role) &&
    changesWhatWasReviewed(
      post,
      post.targets.map((target) => target.targetId),
      input,
      nextScheduledAt,
    );

  if (needsReReview) {
    data.approvalStatus = ApprovalStatus.pending;
    data.status = PostStatus.pending_approval;
    data.submittedById = context.userId;
    data.submittedAt = new Date();
    data.reviewedById = null;
    data.reviewedAt = null;
    data.reviewNote = null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: postId }, data });

    if (input.targetIds) {
      const valid = await tx.target.findMany({
        where: { id: { in: input.targetIds }, workspaceId: context.workspaceId },
        select: { id: true },
      });
      if (valid.length !== input.targetIds.length) throw errors.targetsUnavailable();

      // Only rows nothing is holding. `postEditBlocker` has already refused an
      // edit while a worker has one claimed, but that check and this write are
      // two statements: a worker can claim in between. Narrowing the delete
      // means the worst a lost race can do is leave a destination behind,
      // rather than delete the row that is the only record of a post already
      // on its way to Facebook.
      await tx.postTarget.deleteMany({
        where: { postId, status: { in: ['pending', 'failed', 'cancelled'] } },
      });
      // `skipDuplicates` for the same reason: a destination whose row survived
      // the narrowed delete must not gain a second one.
      await tx.postTarget.createMany({
        data: valid.map((target) => ({ postId, targetId: target.id, status: 'pending' })),
        skipDuplicates: true,
      });
    }

    // A retried post starts from a clean slate on every destination.
    if (data.status === PostStatus.scheduled) {
      await tx.postTarget.updateMany({
        where: { postId, status: { in: ['failed', 'cancelled'] } },
        data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorCode: null, errorMessage: null },
      });
    }
  });

  await logActivity(context.workspaceId, 'post.updated', { postId }, context.userId);

  if (needsReReview) {
    const author = await prisma.user.findUniqueOrThrow({ where: { id: context.userId } });
    await notifyApprovalRequest({
      workspaceId: context.workspaceId,
      authorName: author.name,
      scheduledAt: (data.scheduledAt as Date | null | undefined) ?? post.scheduledAt,
    });
    await logActivity(context.workspaceId, 'post.submitted', { postId }, context.userId);
  }
}

/**
 * Cancel a scheduled post. Destinations already handed to Facebook are deleted
 * remotely, because otherwise "cancelled" here would still publish there.
 */
export async function cancelPost(
  context: { workspaceId: string; userId: string; role: WorkspaceRole },
  postId: string,
): Promise<{ removedFromFacebook: number; failures: string[] }> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    include: { targets: { include: { target: { include: { socialAccount: true } } } } },
  });
  if (!post) throw errors.postNotFound();
  assertMayAct(post, context);

  const failures: string[] = [];
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
        failures.push(`${postTarget.target.name}: ${asGraphError(error).displayMessage}`);
      }
    }
  }

  await prisma.postTarget.updateMany({
    where: { postId, status: { in: ['pending', 'scheduled_remote', 'failed'] } },
    data: { status: 'cancelled', nextAttemptAt: null },
  });
  await prisma.post.update({ where: { id: postId }, data: { status: 'cancelled' } });

  await logActivity(context.workspaceId, 'post.cancelled', { postId, removedFromFacebook }, context.userId);
  return { removedFromFacebook, failures };
}

/** Reset failed destinations so the scheduler picks them up again. */
export async function retryPost(
  context: { workspaceId: string; userId: string; role: WorkspaceRole },
  postId: string,
): Promise<number> {
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: context.workspaceId } });
  if (!post) throw errors.postNotFound();
  assertMayAct(post, context);

  const { count } = await prisma.postTarget.updateMany({
    where: { postId, status: 'failed' },
    data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorCode: null, errorMessage: null },
  });

  if (count > 0) {
    // Held posts must not come back reading "Scheduled". A post can be waiting
    // for review with failed destinations behind it — an approved post loses
    // one Page, then the author edits it and it returns to the queue — and a
    // status that promises publication the scheduler will never perform is the
    // silent failure this product exists to avoid. The retry still clears the
    // errors; it just says where the post really stands.
    const publishable = PUBLISHABLE_APPROVAL_STATUSES.includes(post.approvalStatus);

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: publishable ? PostStatus.scheduled : PostStatus.pending_approval,
        // Due immediately: a manual retry should not wait for the original slot.
        scheduledAt: new Date(),
      },
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
  if (!post) throw errors.postNotFound();

  const copy = await prisma.post.create({
    data: {
      workspaceId: post.workspaceId,
      authorId: context.userId,
      message: post.message,
      link: post.link,
      linkPreview: toJsonOrNull(parseLinkPreview(post.linkPreview)),
      ...mediaColumns(parseMedia(post.media)),
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
