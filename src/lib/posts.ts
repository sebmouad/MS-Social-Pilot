import { assertMonthlyRoom } from './plans';
import { NETWORK_LABELS, networkProblems } from './networks';
import { ownLabels } from './page-groups';
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
import { adjustDaySlots, adjustmentFor } from './seasons';
import { formatInTimeZone } from 'date-fns-tz';
import { resolveMediaForPublish } from './media';
import { resolveLinkPreview } from './facebook/opengraph';
import { publishPost } from './facebook/publish';
import { asGraphError, GraphError } from './facebook/graph';
import { AppError, errors } from './errors';
import { logActivity, publishNow, refreshPostStatus } from './scheduler/runner';
import type { CreatePostInput, UpdatePostInput } from './validation';
import type { PublishMode, TargetType } from './constants';
import { initialApprovalStatus } from './approvals';
import {
  canManageOthersPosts,
  canPublishWithoutApproval,
  NATIVE_SCHEDULE_MAX_SECONDS,
  NATIVE_SCHEDULE_MIN_SECONDS,
  postEditBlocker,
  PUBLISHABLE_APPROVAL_STATUSES,
  QUEUE_OCCUPYING_STATUSES,
} from './constants';
import { notifyApprovalRequest } from './email/notify';
import { ApprovalStatus, PostStatus, Prisma, WorkspaceRole } from '@prisma/client';
import { prepareLinks } from './links';
import { hasPostContent } from './validation';
import { emitWebhook } from './webhooks';
import { recordVersion } from './post-versions';

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
type PrismaClientLike = Pick<typeof prisma, 'queueSlot' | 'post' | 'seasonalMode'>;

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
  input: Pick<CreatePostInput, 'publishMode' | 'scheduledAtLocal' | 'timezone' | 'useQueue' | 'saveAsDraft'> & {
    /** The Pages it goes to: the queue keeps a timetable per Page. */
    targetIds?: string[];
  },
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
    const slot = await nextQueueSlot(client, workspaceId, input.timezone, now, input.targetIds ?? []);
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

/**
 * The next queue slot nothing has claimed, without taking the workspace lock.
 *
 * On its own this races — two callers read the same free slot — so anything
 * that writes a post into the slot goes through {@link allocateQueueSlot}, or
 * takes {@link lockWorkspaceQueue} itself first, as `createPost` does.
 */
async function nextQueueSlot(
  client: PrismaClientLike,
  workspaceId: string,
  timeZone: string,
  now: Date,
  targetIds: string[] = [],
): Promise<Date> {
  const [rows, taken, seasons] = await Promise.all([
    client.queueSlot.findMany({
      where: { workspaceId, OR: [{ targetId: null }, ...(targetIds.length ? [{ targetId: { in: targetIds } }] : [])] },
      select: { dayOfWeek: true, hour: true, minute: true, targetId: true },
    }),
    client.post.findMany({
      where: {
        workspaceId,
        status: { in: [...QUEUE_OCCUPYING_STATUSES] },
        scheduledAt: { gte: now },
        // A time is taken for these Pages when a post already goes to one of
        // them then. A post for another Page at the same minute does not
        // stand in the way: each Page has its own feed to fill.
        ...(targetIds.length ? { targets: { some: { targetId: { in: targetIds } } } } : {}),
      },
      select: { scheduledAt: true },
    }),
    // Seasonal modes (H2) still running or to come; dates are compared as text.
    client.seasonalMode.findMany({
      where: { workspaceId, endsOn: { gte: formatInTimeZone(now, timeZone, 'yyyy-MM-dd') } },
      select: { startsOn: true, endsOn: true, targetIds: true, rule: true, shiftMinutes: true, extraTimes: true },
    }),
  ]);

  const slots = slotsForPages(rows, targetIds);
  if (slots.length === 0) throw errors.queueEmpty();

  const slot = nextAvailableSlot({
    slots,
    timeZone,
    takenUtc: taken.map((post) => post.scheduledAt).filter((date): date is Date => Boolean(date)),
    now,
    adjustDay: seasons.length ? (day, daySlots) => adjustDaySlots(daySlots, adjustmentFor(seasons, targetIds, day)) : undefined,
  });

  if (!slot) throw errors.queueFull();
  return slot;
}

/**
 * The queue times a post to these Pages can take.
 *
 * Every Page shares the workspace's times (`targetId` null), and a Page can
 * have times of its own on top. A post going to several Pages goes out once,
 * at one moment, so it can only take a time that is a queue time for every
 * one of them: a shared time, or a time each of its Pages has of its own.
 */
export function slotsForPages(
  rows: Array<{ dayOfWeek: number; hour: number; minute: number; targetId: string | null }>,
  targetIds: string[],
): Array<{ dayOfWeek: number; hour: number; minute: number }> {
  const key = (row: { dayOfWeek: number; hour: number; minute: number }) => `${row.dayOfWeek}-${row.hour}-${row.minute}`;
  const shared = new Map<string, { dayOfWeek: number; hour: number; minute: number }>();
  const own = new Map<string, { slot: { dayOfWeek: number; hour: number; minute: number }; pages: Set<string> }>();
  for (const row of rows) {
    const slot = { dayOfWeek: row.dayOfWeek, hour: row.hour, minute: row.minute };
    if (row.targetId === null) {
      shared.set(key(row), slot);
    } else if (targetIds.includes(row.targetId)) {
      const entry = own.get(key(row)) ?? { slot, pages: new Set<string>() };
      entry.pages.add(row.targetId);
      own.set(key(row), entry);
    }
  }
  const result = new Map(shared);
  for (const [k, entry] of own) {
    if (targetIds.length > 0 && targetIds.every((id) => entry.pages.has(id))) result.set(k, entry.slot);
  }
  return [...result.values()];
}

/**
 * Serialise queue allocation for one workspace until the transaction ends.
 *
 * Concurrent requests queue up behind each other rather than reading the same
 * free slot. Transaction-scoped, so it is released with the transaction
 * whatever happens — including a rollback — and one workspace never blocks
 * another. Re-entrant within a transaction, so taking it twice is harmless.
 */
async function lockWorkspaceQueue(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
}

/**
 * Claim the next free queue slot for a workspace — the composer's "add to
 * queue", for any other caller that schedules into the queue.
 *
 * Must run inside the `prisma.$transaction` that also writes the post taking
 * the slot, with the post given a status in `QUEUE_OCCUPYING_STATUSES`. The
 * lock is what stops two writers being handed the same slot, and it only
 * covers them if the read and the write share its transaction: allocate in one
 * transaction and write in another, and the double-booking is back.
 *
 * Throws `errors.queueEmpty()` when the workspace has no queue times, and
 * `errors.queueFull()` when every slot in the look-ahead window is taken.
 *
 * @example
 *   await prisma.$transaction(async (tx) => {
 *     const at = await allocateQueueSlot(tx, workspaceId, workspace.timezone);
 *     await tx.post.create({ data: { ...post, status: 'scheduled', scheduledAt: at } });
 *   });
 */
export async function allocateQueueSlot(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  timeZone: string,
  now: Date = new Date(),
  targetIds: string[] = [],
): Promise<Date> {
  await lockWorkspaceQueue(tx, workspaceId);
  return nextQueueSlot(tx, workspaceId, timeZone, now, targetIds);
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
  /** Undo send (H10): "Publish now" was held until then, and can be taken back before it. */
  undoUntil?: Date;
}

export async function createPost(
  context: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    requiresApproval: boolean;
    /** Undo send (H10): hold "Publish now" this long, for the worker to publish. */
    undoSendSeconds?: number;
  },
  input: CreatePostInput,
  now: Date = new Date(),
): Promise<CreatePostResult> {
  await assertMonthlyRoom(context.workspaceId, 'postsPerMonth', now);
  const targets = await loadTargets(context.workspaceId, input.targetIds);
  const labelIds = await ownLabels(context.workspaceId, input.labelIds ?? []);

  // Decided once, here, and stored on the row: recomputing it later from
  // settings that may since have changed would let a post slip through.
  const approvalStatus = initialApprovalStatus({
    requiresApproval: context.requiresApproval,
    role: context.role,
    saveAsDraft: input.saveAsDraft,
  });
  const needsApproval = approvalStatus === ApprovalStatus.pending;
  // "Publish now" held for a few seconds so it can be taken back: the worker
  // publishes it once the time is up, like any scheduled post.
  const undoSeconds =
    !input.saveAsDraft && !needsApproval && input.publishMode === 'immediate' ? (context.undoSendSeconds ?? 0) : 0;

  if (input.publishMode === 'native') assertNativeSupported(targets);
  if (!input.saveAsDraft) {
    assertInstagramHasMedia(targets, input.media?.length ?? 0);
    assertFormatFits(input.format ?? 'post', targets, input.media ?? [], input.publishMode);
    assertNetworksFit(targets, { message: input.message, link: input.link ?? null, media: input.media ?? [] });
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
    const schedule: ResolvedSchedule =
      undoSeconds > 0
        ? { scheduledAt: new Date(at.getTime() + undoSeconds * 1000), timezone: input.timezone, publishMode: 'worker', usedQueueSlot: false }
        : await resolveSchedule(context.workspaceId, input, at, client);

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
        firstComment: input.firstComment ?? null,
        firstCommentDelayMinutes: input.firstComment ? input.firstCommentDelayMinutes ?? 0 : 0,
        format: input.format ?? 'post',
        labels: { create: labelIds.map((labelId) => ({ labelId })) },
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
          create: targets.map((target) => ({ targetId: target.id, status: 'pending', messageOverride: input.variants?.[target.id]?.trim() || null })),
        },
      },
      include: { targets: true },
    });

    return { post: created, schedule, status };
  };

  const allocatesSlot = !input.saveAsDraft && input.publishMode !== 'immediate' && input.useQueue;

  const written = allocatesSlot
    ? await prisma.$transaction(async (tx) => {
        await lockWorkspaceQueue(tx, context.workspaceId);
        return write(tx);
      })
    : await write(prisma);

  const { post, schedule, status } = written;
  await recordVersion(post.id, context.userId);

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

  // A "publish now" waiting out its undo delay is not news yet: it reports as
  // published, or not at all if it is taken back.
  if (undoSeconds === 0 && schedule.scheduledAt) {
    await emitWebhook(context.workspaceId, 'post.scheduled', {
      postId: post.id,
      scheduledAt: schedule.scheduledAt.toISOString(),
      pages: targets.map((target) => ({ pageId: target.id, pageName: target.name, network: target.type })),
      message: input.message,
    });
  }

  if (schedule.publishMode === 'native' && schedule.scheduledAt) {
    await handOffToFacebook(post.id, schedule.scheduledAt);
    return summarise(post.id);
  }

  return {
    postId: post.id,
    status,
    scheduledAt: schedule.scheduledAt,
    results: [],
    ...(undoSeconds > 0 && schedule.scheduledAt ? { undoUntil: schedule.scheduledAt } : {}),
  };
}

/**
 * Undo send (H10): a held "Publish now" goes back to the drafts, as long as
 * its time has not come. Past it the worker may already be publishing, so it
 * is refused rather than raced. True when it was taken back.
 */
export async function undoSend(workspaceId: string, postId: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.post.updateMany({
    where: {
      id: postId,
      workspaceId,
      status: PostStatus.scheduled,
      publishMode: 'worker',
      scheduledAt: { gt: now },
      targets: { every: { status: 'pending' } },
    },
    data: { status: PostStatus.draft, scheduledAt: null },
  });
  return count === 1;
}

/**
 * Create the post on Facebook now, with Facebook holding it until the
 * scheduled time. Each destination is attempted independently so one failure
 * does not strand the rest.
 */
async function handOffToFacebook(postId: string, scheduledAt: Date): Promise<void> {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: {
      workspace: true,
      targets: { include: { target: { include: { socialAccount: true } } } },
    },
  });

  const media = await resolveMediaForPublish(parseMedia(post.media));

  for (const postTarget of post.targets) {
    const { target } = postTarget;
    try {
      const encrypted = target.accessToken ?? target.socialAccount?.accessToken ?? null;
      if (!encrypted) {
        throw new GraphError({ message: 'No token stored for this destination.', kind: 'auth' });
      }

      // The same rewriting the worker applies, per destination, so a campaign
      // is attributed to the Page it ran on. Skipping it here meant choosing
      // "let Facebook hold it" quietly dropped the UTM tags and short links the
      // workspace had asked for — the reports then showed native posts earning
      // no clicks at all.
      const prepared = await prepareLinks({
        workspaceId: post.workspaceId,
        postId: post.id,
        message: post.message,
        link: post.link,
        settings: {
          utmSource: post.workspace.utmSource,
          utmMedium: post.workspace.utmMedium,
          utmCampaignTemplate: post.workspace.utmCampaignTemplate,
          shortenerEnabled: post.workspace.shortenerEnabled,
        },
        targetName: target.name,
        targetId: target.id,
      });

      const result = await publishPost({
        targetType: target.type as TargetType,
        targetId: target.providerId,
        accessToken: decryptSecret(encrypted),
        message: prepared.message,
        link: prepared.link,
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

/** Why a native post was left with our own worker instead of Facebook. */
export type NativeFallback = 'too_soon' | 'too_far' | 'unavailable';

/**
 * Slack on Facebook's 10-minute floor. The check runs before the Graph call,
 * and a post that clears the floor by a second here can miss it by the time
 * Facebook reads the request — failing every destination over a rounding.
 */
const NATIVE_FLOOR_MARGIN_SECONDS = 60;

function nativeWindowProblem(scheduledAt: Date, now: Date): NativeFallback | null {
  const deltaSeconds = Math.floor((scheduledAt.getTime() - now.getTime()) / 1000);
  if (deltaSeconds < NATIVE_SCHEDULE_MIN_SECONDS + NATIVE_FLOOR_MARGIN_SECONDS) return 'too_soon';
  if (deltaSeconds > NATIVE_SCHEDULE_MAX_SECONDS) return 'too_far';
  return null;
}

/**
 * Hand a post to Facebook, or keep it with our worker when Facebook would
 * refuse its time.
 *
 * For posts that become publishable later than they were composed — approved
 * after a wait, or edited back into the schedule. By then the time may have
 * drifted inside Facebook's 10-minute floor (an overdue approval is the usual
 * case) and handing it over would fail every destination, leaving a post the
 * reviewer just approved reading "Failed". Our own worker can still honour the
 * time, so the post switches to it and the caller is told why — to say so on
 * screen and in its audit entry, rather than let "Held by Facebook" quietly
 * stop being true.
 */
export async function handOffOrKeep(
  postId: string,
  scheduledAt: Date,
  now: Date = new Date(),
): Promise<NativeFallback | null> {
  let problem = nativeWindowProblem(scheduledAt, now);
  if (!problem) {
    try {
      await handOffToFacebook(postId, scheduledAt);
      return null;
    } catch (error) {
      // Each destination's own failure is recorded inside; this is the post
      // as a whole failing to be prepared — a media file gone from storage,
      // say. The caller has already committed its decision (an approval, an
      // edit), so failing the request now would report an error for work
      // that stood. Our worker still has the post, and will say what is wrong
      // with it at its time.
      console.error('[posts] native hand-off failed; keeping the post with the worker', error);
      problem = 'unavailable';
    }
  }

  await prisma.post.update({ where: { id: postId }, data: { publishMode: 'worker' } });
  return problem;
}

/** The `posts.*` message explaining a {@link NativeFallback}. */
export function nativeFallbackKey(
  reason: NativeFallback,
): 'nativeTooSoon' | 'nativeTooFar' | 'nativeUnavailable' {
  if (reason === 'too_soon') return 'nativeTooSoon';
  if (reason === 'too_far') return 'nativeTooFar';
  return 'nativeUnavailable';
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
export function assertMayAct(
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
  post: {
    message: string;
    firstComment: string | null;
    link: string | null;
    mediaKeys: string[];
    scheduledAt: Date | null;
  },
  currentTargetIds: string[],
  input: UpdatePostInput,
  nextScheduledAt: Date | null | undefined,
): boolean {
  if (input.message !== undefined && input.message !== post.message) return true;
  if (input.link !== undefined && (input.link ?? null) !== post.link) return true;
  // Published under the post as the Page, so a reviewer approved it too.
  if (input.firstComment !== undefined && (input.firstComment ?? null) !== post.firstComment) return true;

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
 * Refuse the destinations Facebook cannot hold a post for.
 *
 * Shared by creating and editing, because the composer offers the same choice
 * in both and a rule enforced on only one of them is not a rule — it is a
 * detour. Native scheduling is a Pages-only Graph feature; letting Graph
 * reject the whole batch instead would fail every destination, including the
 * Pages that were fine.
 */
function assertNativeSupported(targets: Array<{ type: string; name: string }>): void {
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

/**
 * Refuse a post with nothing to show going to Instagram.
 *
 * Instagram publishes a picture or a video with a caption, never text alone,
 * so such a post would only fail at its scheduled time — long after anyone
 * could fix it. Drafts may still be saved without media: they are unfinished
 * by definition.
 */
/**
 * A Reel or a Story goes to Facebook Pages only, as one video (a Reel) or one
 * photo or video (a Story), and this app publishes it at the time: Facebook
 * holds neither for later. Said when the post is saved rather than when the
 * worker reaches it hours later.
 */
/** A post that one of its networks would refuse is refused here, saying which and why. */
function assertNetworksFit(
  targets: Array<{ type: string; name: string }>,
  post: { message: string; link: string | null; media: Array<{ kind: string }> },
): void {
  const problem = networkProblems(targets, post)[0];
  if (!problem) return;
  throw new AppError({
    key: `errors.network_${problem.key}`,
    fallback: `${problem.target} (${NETWORK_LABELS[problem.network]}) cannot take this post.`,
    params: { target: problem.target, network: NETWORK_LABELS[problem.network], ...problem.params },
    status: 422,
  });
}

function assertFormatFits(
  format: string,
  targets: Array<{ type: string; name: string }>,
  media: Array<{ kind: string }>,
  publishMode: string,
): void {
  if (format === 'post') return;
  const others = targets.filter((target) => target.type !== 'page');
  if (others.length > 0) {
    throw new AppError({
      key: 'errors.formatPagesOnly',
      fallback: `Reels and Stories go to Facebook Pages only. Untick: ${others.map((target) => target.name).join(', ')}.`,
      params: { names: others.map((target) => target.name).join(', ') },
    });
  }
  if (publishMode === 'native') {
    throw new AppError({ key: 'errors.formatNotNative', fallback: 'Facebook cannot hold a Reel or a Story for later.' });
  }
  const videos = media.filter((item) => item.kind === 'video').length;
  if (format === 'reel' && (videos !== 1 || media.length !== 1)) {
    throw new AppError({ key: 'errors.reelNeedsVideo', fallback: 'A Reel needs exactly one video.' });
  }
  if (format === 'story' && media.length !== 1) {
    throw new AppError({ key: 'errors.storyNeedsMedia', fallback: 'A Story needs exactly one photo or one video.' });
  }
}

function assertInstagramHasMedia(targets: Array<{ type: string; name: string }>, mediaCount: number): void {
  if (mediaCount > 0) return;
  const instagram = targets.filter((target) => target.type === 'instagram');
  if (instagram.length > 0) {
    throw errors.instagramNeedsMedia(instagram.map((item) => item.name).join(', '));
  }
}

/**
 * Where review leaves a post after an edit.
 *
 *   submit — it goes (back) into the review queue.
 *   hold   — it is already waiting there and stays exactly as it is.
 *   clear  — it may go out, carrying this approval state.
 *   revoke — it is not going out now, but the approval it had no longer
 *            covers what it says, so the next attempt to send it is reviewed.
 *   keep   — nothing about review changes.
 */
type ReviewOutcome =
  | { kind: 'submit' }
  | { kind: 'hold' }
  | { kind: 'clear'; approvalStatus: ApprovalStatus }
  | { kind: 'revoke' }
  | { kind: 'keep' };

/** Post states that intend to go out at their time. */
const GOING_OUT: readonly PostStatus[] = [PostStatus.scheduled, PostStatus.pending_approval];

/**
 * Decide what an edit does to a post's review.
 *
 * Written as one decision, rather than as a status the edit sets and a check
 * afterwards that sometimes overrides it, because the second shape is how the
 * holes got in. The edit set `scheduled` whatever the approval said, so:
 *
 * - a contributor's draft (saved `not_required`: nothing had been submitted)
 *   was given a time and published unreviewed;
 * - a post waiting for review, or one a reviewer had rejected, was flipped to
 *   `scheduled` while its approval stayed `pending` or `rejected` — gone from
 *   the Approvals screen, and skipped by the scheduler for ever.
 *
 * The rules, with approval on: a post already waiting keeps waiting (whoever
 * edits it — an editor may publish their own work unreviewed, but they cannot
 * approve somebody else's); a rejected post goes back to review; an editor's
 * post is cleared; a contributor's is cleared only when a reviewer approved
 * exactly this, or when it was already on its way out before review was
 * switched on and nothing about it changed. Everything else is reviewed.
 */
function reviewAfterEdit(options: {
  requiresApproval: boolean;
  role: WorkspaceRole;
  approvalStatus: ApprovalStatus;
  statusBefore: PostStatus;
  statusAfter: PostStatus;
  changed: boolean;
}): ReviewOutcome {
  const { approvalStatus } = options;

  if (!GOING_OUT.includes(options.statusAfter)) {
    const stale =
      options.requiresApproval &&
      approvalStatus === ApprovalStatus.approved &&
      !canPublishWithoutApproval(options.role) &&
      options.changed;
    return stale ? { kind: 'revoke' } : { kind: 'keep' };
  }

  // Nobody is reviewing. A held post is released, the same as switching the
  // workflow off releases it; a rejected one is the author rescheduling after
  // the reviewer's note, which is the route back `releaseHeldPosts` leaves for
  // it.
  if (!options.requiresApproval) {
    return {
      kind: 'clear',
      approvalStatus:
        approvalStatus === ApprovalStatus.approved ? ApprovalStatus.approved : ApprovalStatus.not_required,
    };
  }

  if (approvalStatus === ApprovalStatus.pending) {
    // Pending but out of the queue — cancelled or turned into a draft while it
    // waited — has to be put back in it, or nobody will ever be asked.
    return options.statusBefore === PostStatus.pending_approval ? { kind: 'hold' } : { kind: 'submit' };
  }
  if (approvalStatus === ApprovalStatus.rejected) return { kind: 'submit' };

  if (canPublishWithoutApproval(options.role)) {
    return { kind: 'clear', approvalStatus: ApprovalStatus.approved };
  }

  if (!options.changed) {
    if (approvalStatus === ApprovalStatus.approved) {
      return { kind: 'clear', approvalStatus };
    }
    if (GOING_OUT.includes(options.statusBefore)) {
      return { kind: 'clear', approvalStatus };
    }
  }

  return { kind: 'submit' };
}

/** Same minute: `datetime-local` carries no seconds, the stored instant may. */
function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

export interface UpdatePostResult {
  /**
   * Set when the post was meant for Facebook to hold but stayed with our
   * worker, because Facebook would refuse its time.
   */
  nativeFallback: NativeFallback | null;
}

/**
 * Edit a post.
 *
 * The subtle part is approval: see {@link reviewAfterEdit}. A contributor
 * whose post has been approved can still edit it right up until it publishes,
 * and without that the reviewer's decision travels with the row rather than
 * with the content — sign-off on one message, a different one goes out.
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
  now: Date = new Date(),
): Promise<UpdatePostResult> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    // The destinations' own rows too: an edit that changes only the mode has
    // to be checked against the destinations the post already has.
    include: { targets: { include: { target: { select: { type: true, name: true } } } } },
  });
  if (!post) throw errors.postNotFound();

  assertMayAct(post, context);

  const blocker = postEditBlocker(post);
  if (blocker === 'publishing') throw errors.alreadyPublishing();
  if (blocker === 'published') throw errors.alreadyPublished();
  if (blocker === 'scheduled_remote') throw errors.scheduledInFacebook();

  // The schema can only check the fields it was sent; emptiness depends on the
  // ones it was not, so it is checked here against what the post will hold.
  const nextMessage = input.message ?? post.message;
  const nextLink = input.link !== undefined ? (input.link ?? null) : post.link;
  const nextMediaCount = input.media !== undefined ? input.media.length : parseMedia(post.media).length;
  if (!hasPostContent(nextMessage, nextLink, nextMediaCount)) throw errors.emptyPost();

  const data: Record<string, unknown> = {};
  if (input.message !== undefined) data.message = input.message;
  if (input.firstComment !== undefined) data.firstComment = input.firstComment;
  if (input.firstCommentDelayMinutes !== undefined) data.firstCommentDelayMinutes = input.firstCommentDelayMinutes;
  if (input.format !== undefined) data.format = input.format;
  const labelIds = input.labelIds ? await ownLabels(context.workspaceId, input.labelIds) : null;
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
  /** The edit asks for the post to go out at a time. */
  let wantsSchedule = false;
  if (input.scheduledAtLocal !== undefined) {
    if (input.scheduledAtLocal === null) {
      data.scheduledAt = null;
      data.status = PostStatus.draft;
      nextScheduledAt = null;
    } else {
      const timezone = input.timezone ?? post.timezone;
      if (!wallClockExists(input.scheduledAtLocal, timezone)) {
        throw errors.clocksGoForward(input.scheduledAtLocal.slice(11, 16));
      }

      // Only a time that moved has to be in the future. The composer sends the
      // time back with every save, so refusing a past one outright meant an
      // overdue or failed post could not even have a typo fixed: the save was
      // refused over a field nobody had touched. The stored instant is kept
      // as it was, seconds and all, so an untouched time is not a change.
      //
      // An untouched time that has passed is not a request to publish either:
      // a failed or cancelled post whose typo is fixed stays failed or
      // cancelled, rather than going out on the next tick because the form
      // happened to carry its old time. Retrying is how that is asked for.
      const requested = localInputToUtc(input.scheduledAtLocal, timezone);
      if (post.scheduledAt && sameMinute(requested, post.scheduledAt)) {
        nextScheduledAt = post.scheduledAt;
        const passed = post.scheduledAt.getTime() <= now.getTime();
        wantsSchedule = !passed || GOING_OUT.includes(post.status);
      } else {
        if (requested.getTime() <= now.getTime()) throw errors.timePassed();
        data.scheduledAt = requested;
        nextScheduledAt = requested;
        wantsSchedule = true;
      }
    }
  }

  if (input.status === PostStatus.scheduled) {
    wantsSchedule = true;
  } else if (input.status !== undefined) {
    data.status = input.status;
    wantsSchedule = false;
  }

  const scheduledAfter = nextScheduledAt !== undefined ? nextScheduledAt : post.scheduledAt;
  if (wantsSchedule && !scheduledAfter) throw errors.pickDateTime();

  const statusAfter: PostStatus = wantsSchedule
    ? PostStatus.scheduled
    : ((data.status as PostStatus | undefined) ?? post.status);

  const review = reviewAfterEdit({
    requiresApproval: context.requiresApproval,
    role: context.role,
    approvalStatus: post.approvalStatus,
    statusBefore: post.status,
    statusAfter,
    // Checked before the write, against the stored row.
    changed: changesWhatWasReviewed(
      post,
      post.targets.map((target) => target.targetId),
      input,
      nextScheduledAt,
    ),
  });

  switch (review.kind) {
    case 'submit':
      data.approvalStatus = ApprovalStatus.pending;
      data.status = PostStatus.pending_approval;
      data.submittedById = context.userId;
      data.submittedAt = now;
      data.reviewedById = null;
      data.reviewedAt = null;
      data.reviewNote = null;
      break;
    case 'hold':
      data.status = PostStatus.pending_approval;
      break;
    case 'clear':
      data.approvalStatus = review.approvalStatus;
      // Released from the queue with no time set: nothing for the scheduler
      // to act on, so it lands as a draft — where approving it would.
      data.status = scheduledAfter ? PostStatus.scheduled : PostStatus.draft;
      break;
    case 'revoke':
      data.approvalStatus = ApprovalStatus.pending;
      data.reviewedById = null;
      data.reviewedAt = null;
      data.reviewNote = null;
      break;
    case 'keep':
      break;
  }

  // Resolved before the write, because the native check needs to know what
  // kind of destination each one is, not just that it exists.
  const valid = input.targetIds
    ? await prisma.target.findMany({
        where: { id: { in: input.targetIds }, workspaceId: context.workspaceId },
        select: { id: true, type: true, name: true },
      })
    : [];
  if (input.targetIds && valid.length !== input.targetIds.length) {
    throw errors.targetsUnavailable();
  }

  // The mode the post will have once this edit lands, against the destinations
  // it will have. Both halves can change in the same request.
  const nextMode = input.publishMode ?? post.publishMode;
  const nextTargets = input.targetIds ? valid : post.targets.map((row) => row.target);
  const nextTargetIds = input.targetIds ? valid.map((target) => target.id) : post.targets.map((row) => row.targetId);
  if (nextMode === 'native') assertNativeSupported(nextTargets);

  const nextStatus = (data.status as PostStatus | undefined) ?? post.status;
  if (nextStatus !== PostStatus.draft && nextStatus !== PostStatus.cancelled) {
    assertInstagramHasMedia(nextTargets, nextMediaCount);
    assertFormatFits(
      input.format ?? post.format,
      nextTargets,
      input.media ?? parseMedia(post.media),
      nextMode,
    );
    assertNetworksFit(nextTargets, {
      message: input.message ?? post.message,
      link: input.link === undefined ? post.link : input.link,
      media: input.media ?? parseMedia(post.media),
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.post.update({ where: { id: postId }, data });

    if (labelIds) {
      await tx.postLabel.deleteMany({ where: { postId } });
      await tx.postLabel.createMany({ data: labelIds.map((labelId) => ({ postId, labelId })) });
    }

    if (input.targetIds) {

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
        data: valid.map((target) => ({ postId, targetId: target.id, status: 'pending', messageOverride: input.variants?.[target.id]?.trim() || null })),
        skipDuplicates: true,
      });
    }

    // Per-destination text: set for the destinations still waiting to go out.
    if (input.variants) {
      for (const targetId of nextTargetIds) {
        await tx.postTarget.updateMany({
          where: { postId, targetId, status: { in: ['pending', 'failed', 'cancelled'] } },
          data: { messageOverride: input.variants[targetId]?.trim() || null },
        });
      }
    }

    // A rescheduled post starts from a clean slate on every destination —
    // including one going to review, or approving it later would change its
    // status while every destination stayed failed, and nothing would go out.
    if (data.status === PostStatus.scheduled || data.status === PostStatus.pending_approval) {
      await tx.postTarget.updateMany({
        where: { postId, status: { in: ['failed', 'cancelled'] } },
        data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorCode: null, errorMessage: null },
      });
    }
  });
  await recordVersion(postId, context.userId);

  // A post that is native, cleared, and scheduled once this edit lands is one
  // Facebook is supposed to be holding, so ask it to. Recording the choice and
  // leaving the post for our own worker is the worst reading of it: the whole
  // reason to pick native is that the post survives our worker being down, and
  // the screen would say Facebook had it while nobody had asked Facebook
  // anything. Nothing here can be handed over twice — a post Facebook already
  // holds is refused by `postEditBlocker` before any of this runs.
  //
  // Cleared means cleared: a post going to review, or still waiting there, is
  // not handed to anyone. Facebook would publish it on schedule, reviewed or
  // not, and nothing in our queue could then stop it.
  const statusFinal = (data.status as PostStatus | undefined) ?? post.status;
  const approvalFinal = (data.approvalStatus as ApprovalStatus | undefined) ?? post.approvalStatus;
  let nativeFallback: NativeFallback | null = null;
  if (
    nextMode === 'native' &&
    statusFinal === PostStatus.scheduled &&
    PUBLISHABLE_APPROVAL_STATUSES.includes(approvalFinal) &&
    scheduledAfter
  ) {
    nativeFallback = await handOffOrKeep(postId, scheduledAfter, now);
  }

  await logActivity(
    context.workspaceId,
    'post.updated',
    nativeFallback ? { postId, nativeFallback } : { postId },
    context.userId,
  );

  if (review.kind === 'submit') {
    const author = await prisma.user.findUniqueOrThrow({ where: { id: context.userId } });
    await notifyApprovalRequest({
      workspaceId: context.workspaceId,
      authorName: author.name,
      scheduledAt: scheduledAfter,
    });
    await logActivity(context.workspaceId, 'post.submitted', { postId }, context.userId);
  }

  return { nativeFallback };
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
  // Destinations whose copy is still sitting in Facebook's queue. These must
  // not be marked cancelled: a post reading "Cancelled" here while Facebook
  // publishes it on schedule is the worst outcome available, because nobody is
  // looking for it — our own records agree it is gone.
  const stillLive: string[] = [];
  let removedFromFacebook = 0;

  for (const postTarget of post.targets) {
    if (postTarget.status === 'scheduled_remote' && postTarget.remotePostId) {
      const encrypted = postTarget.target.accessToken ?? postTarget.target.socialAccount?.accessToken ?? null;
      if (!encrypted) {
        // No credential means no way to reach the post at all. Passing over it
        // silently reports a clean cancellation for something still going out.
        failures.push(
          `${postTarget.target.name}: no stored token, so this post is still scheduled on Facebook. Reconnect the account and cancel again.`,
        );
        stillLive.push(postTarget.id);
        continue;
      }

      try {
        const { deleteRemotePost } = await import('./facebook/publish');
        await deleteRemotePost(postTarget.remotePostId, decryptSecret(encrypted));
        removedFromFacebook += 1;
      } catch (error) {
        failures.push(`${postTarget.target.name}: ${asGraphError(error).displayMessage}`);
        stillLive.push(postTarget.id);
      }
    }
  }

  await prisma.postTarget.updateMany({
    where: {
      postId,
      id: { notIn: stillLive },
      status: { in: ['pending', 'scheduled_remote', 'failed'] },
    },
    data: { status: 'cancelled', nextAttemptAt: null },
  });

  // Derived rather than asserted, so a post with a destination still queued at
  // Facebook reads as scheduled — which it is — instead of cancelled.
  await refreshPostStatus(postId);

  await logActivity(
    context.workspaceId,
    'post.cancelled',
    { postId, removedFromFacebook, stillLive: stillLive.length },
    context.userId,
  );
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

    // Due immediately when the moment has passed — waiting for a slot already
    // behind us would mean the retry never runs, which is the usual case and
    // the reason this moves the time at all.
    //
    // A post still ahead of its time keeps it. A destination can fail long
    // before the post is due — native scheduling hands it to Facebook at
    // creation time, so a Page that refuses it is `failed` while the rest sits
    // queued for Friday — and dragging that one destination forward publishes
    // the post twice, at two times, neither of which anybody chose.
    const now = new Date();
    const stillAhead = post.scheduledAt !== null && post.scheduledAt.getTime() > now.getTime();

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: publishable ? PostStatus.scheduled : PostStatus.pending_approval,
        scheduledAt: stillAhead ? post.scheduledAt : now,
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
      firstComment: post.firstComment,
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
    ...(item.focus ? { focus: item.focus } : {}),
  }));
}

/**
 * Take a published post down from Facebook, on every Page it went to.
 *
 * Only Facebook Pages: Instagram's API cannot delete, and the other networks
 * are removed on their own sites. Each destination taken down is kept, marked
 * with when, so the record of what went out stays honest.
 */
export async function removePublishedPost(
  context: { workspaceId: string; userId: string; role: WorkspaceRole },
  postId: string,
  now: Date = new Date(),
): Promise<{ removed: number; failures: string[] }> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    include: { targets: { include: { target: { include: { socialAccount: true } } } } },
  });
  if (!post) throw errors.postNotFound();
  assertMayAct(post, context);

  const failures: string[] = [];
  let removed = 0;
  const { deleteRemotePost } = await import('./facebook/publish');
  for (const postTarget of post.targets) {
    if (postTarget.status !== 'published' || !postTarget.remotePostId || postTarget.removedAt) continue;
    if (postTarget.target.type !== 'page') {
      failures.push(`${postTarget.target.name}: remove it on the network itself.`);
      continue;
    }
    const encrypted = postTarget.target.accessToken ?? postTarget.target.socialAccount?.accessToken ?? null;
    if (!encrypted) {
      failures.push(`${postTarget.target.name}: no stored token. Reconnect the account and try again.`);
      continue;
    }
    try {
      await deleteRemotePost(postTarget.remotePostId, decryptSecret(encrypted));
      await prisma.postTarget.update({ where: { id: postTarget.id }, data: { removedAt: now } });
      removed += 1;
    } catch (error) {
      failures.push(`${postTarget.target.name}: ${asGraphError(error).displayMessage}`);
    }
  }
  await logActivity(context.workspaceId, 'post.cancelled', { postId, removedFromFacebook: removed, action: 'removed' }, context.userId);
  return { removed, failures };
}
