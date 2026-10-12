import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { postScope, type PageScope } from './page-access';
import { AppError, errors } from './errors';
import { canApprove, canManageOthersPosts, canPublishWithoutApproval } from './constants';
import { notifyApprovalDecision, notifyApprovalRequest } from './email/notify';
import { logActivity } from './scheduler/runner';
import type { NativeFallback } from './posts';

/**
 * The approval workflow.
 *
 * Enabled per workspace. When on, a contributor's post is held in
 * `pending_approval` and — critically — the scheduler's due-work query
 * excludes it, so an unapproved post cannot go out even if its scheduled time
 * arrives while it sits in the queue. That gate lives in
 * `src/lib/scheduler/runner.ts`, and there is a test for it.
 */

/**
 * Decide the approval state a new post should start in.
 *
 * Called at creation time so the decision is recorded once, on the row, rather
 * than being recomputed later from settings that may since have changed.
 */
export function initialApprovalStatus(options: {
  requiresApproval: boolean;
  role: WorkspaceRole;
  saveAsDraft: boolean;
}): ApprovalStatus {
  if (options.saveAsDraft) return ApprovalStatus.not_required;
  if (!options.requiresApproval) return ApprovalStatus.not_required;
  // Editors and above schedule directly; contributors are what the workflow
  // exists for.
  return canPublishWithoutApproval(options.role) ? ApprovalStatus.approved : ApprovalStatus.pending;
}

/** Whether a post in this state is visible to the scheduler. */
export function isPublishable(status: ApprovalStatus): boolean {
  return status === ApprovalStatus.not_required || status === ApprovalStatus.approved;
}

/**
 * The states a post can be sent for review from.
 *
 * Everything that has not been sent and still might be. A published or
 * publishing post is already gone, and putting one back in the queue leaves it
 * reading as awaiting a decision nobody can now make while its copy sits on
 * Facebook. `cancelled` stays out because reviving it through the review queue
 * is not what cancelling meant, and `failed` stays out because retrying is the
 * path that actually sends it — approving a failed post changes its status
 * while every destination stays failed, so nothing goes anywhere.
 */
const SUBMITTABLE_STATUSES = [
  PostStatus.draft,
  PostStatus.rejected,
  PostStatus.scheduled,
  PostStatus.pending_approval,
] as const;

export async function submitForApproval(options: {
  workspaceId: string;
  postId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  if (!post) throw errors.postNotFound();

  // Submitting changes a post's state on the author's behalf, the same as
  // editing or cancelling it does, and those both check whose post it is.
  if (post.authorId !== options.userId && !canManageOthersPosts(options.role)) {
    throw errors.noPermission();
  }

  if (!(SUBMITTABLE_STATUSES as readonly PostStatus[]).includes(post.status)) {
    throw new AppError({
      key: 'errors.notSubmittable',
      fallback: 'That post cannot be sent for review.',
      status: 409,
    });
  }

  const [user, workspace] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: options.userId } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: options.workspaceId } }),
  ]);

  await prisma.post.update({
    where: { id: options.postId },
    data: {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      submittedById: options.userId,
      submittedAt: new Date(),
      // Clear any previous rejection so the reviewer sees a clean submission.
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    },
  });

  await notifyApprovalRequest({
    workspaceId: options.workspaceId,
    authorName: user.name,
    scheduledAt: post.scheduledAt,
  });

  await logActivity(options.workspaceId, 'post.submitted', { postId: options.postId }, options.userId);
  void workspace;
}

/**
 * Take a post back out of review, as a draft.
 *
 * For the author who spotted something after submitting: the alternative was
 * cancelling it and writing it again. The post keeps its content and time, and
 * approval returns to "not required" — a draft carries no review state, and
 * scheduling it again goes through review exactly as a new one would.
 */
export async function withdrawFromReview(options: {
  workspaceId: string;
  postId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  if (!post) throw errors.postNotFound();

  if (post.authorId !== options.userId && !canManageOthersPosts(options.role)) {
    throw errors.noPermission();
  }

  // Conditional on still waiting, so a reviewer approving at the same moment
  // wins cleanly rather than having their decision silently undone.
  const { count } = await prisma.post.updateMany({
    where: {
      id: options.postId,
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
    },
    data: {
      status: PostStatus.draft,
      approvalStatus: ApprovalStatus.not_required,
      submittedById: null,
      submittedAt: null,
    },
  });
  if (count === 0) {
    throw new AppError({
      key: 'errors.notPending',
      fallback: 'That post is not awaiting approval.',
      status: 409,
    });
  }

  await logActivity(options.workspaceId, 'post.withdrawn', { postId: options.postId }, options.userId);
}

export interface ApproveResult {
  /**
   * Set when the post was meant for Facebook to hold, but its time had
   * drifted outside the window Facebook accepts, so our worker publishes it.
   */
  nativeFallback: NativeFallback | null;
}

export async function approvePost(options: {
  workspaceId: string;
  postId: string;
  reviewerId: string;
  reviewerRole: WorkspaceRole;
}): Promise<ApproveResult> {
  if (!canApprove(options.reviewerRole)) throw errors.noPermission();

  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  if (!post) throw errors.postNotFound();

  // A cancelled post keeps its `pending` approval state as a record, so the
  // status has to be checked too — approving one would otherwise flip it back
  // to `scheduled` while every destination stays cancelled, leaving a post that
  // reads as scheduled and can never publish.
  if (post.approvalStatus !== ApprovalStatus.pending || post.status !== PostStatus.pending_approval) {
    throw new AppError({
      key: 'errors.notPending',
      fallback: 'That post is not awaiting approval.',
      status: 409,
    });
  }

  const reviewer = await prisma.user.findUniqueOrThrow({ where: { id: options.reviewerId } });

  // A post with no time set has nothing for the scheduler to act on, so
  // approving it returns it to draft rather than to a scheduled state it
  // cannot honour.
  const nextStatus = post.scheduledAt ? PostStatus.scheduled : PostStatus.draft;

  await prisma.post.update({
    where: { id: options.postId },
    data: {
      approvalStatus: ApprovalStatus.approved,
      status: nextStatus,
      reviewedById: options.reviewerId,
      reviewedAt: new Date(),
      reviewNote: null,
    },
  });

  // A native post is one the author asked Facebook to hold. Only setting it
  // `scheduled` left it to our worker, which is the one thing native was
  // chosen to avoid — and the screen went on saying Facebook had it. Handed
  // over now, the moment it is cleared, and never before: Facebook publishes
  // whatever it is given, reviewed or not.
  let nativeFallback: NativeFallback | null = null;
  if (nextStatus === PostStatus.scheduled && post.publishMode === 'native' && post.scheduledAt) {
    // Imported here rather than at the top: `posts` already imports this
    // module for `initialApprovalStatus`.
    const { handOffOrKeep } = await import('./posts');
    nativeFallback = await handOffOrKeep(post.id, post.scheduledAt);
  }

  if (post.submittedById) {
    await notifyApprovalDecision({
      workspaceId: options.workspaceId,
      authorId: post.submittedById,
      reviewerName: reviewer.name,
      approved: true,
      scheduledAt: post.scheduledAt,
    });
  }

  await logActivity(
    options.workspaceId,
    'post.approved',
    nativeFallback ? { postId: options.postId, nativeFallback } : { postId: options.postId },
    options.reviewerId,
  );

  return { nativeFallback };
}

export async function rejectPost(options: {
  workspaceId: string;
  postId: string;
  reviewerId: string;
  reviewerRole: WorkspaceRole;
  note: string;
}): Promise<void> {
  if (!canApprove(options.reviewerRole)) throw errors.noPermission();

  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  if (!post) throw errors.postNotFound();

  // A cancelled post keeps its `pending` approval state as a record, so the
  // status has to be checked too — approving one would otherwise flip it back
  // to `scheduled` while every destination stays cancelled, leaving a post that
  // reads as scheduled and can never publish.
  if (post.approvalStatus !== ApprovalStatus.pending || post.status !== PostStatus.pending_approval) {
    throw new AppError({
      key: 'errors.notPending',
      fallback: 'That post is not awaiting approval.',
      status: 409,
    });
  }

  const reviewer = await prisma.user.findUniqueOrThrow({ where: { id: options.reviewerId } });

  await prisma.post.update({
    where: { id: options.postId },
    data: {
      approvalStatus: ApprovalStatus.rejected,
      status: PostStatus.rejected,
      reviewedById: options.reviewerId,
      reviewedAt: new Date(),
      reviewNote: options.note,
    },
  });

  if (post.submittedById) {
    await notifyApprovalDecision({
      workspaceId: options.workspaceId,
      authorId: post.submittedById,
      reviewerName: reviewer.name,
      approved: false,
      note: options.note,
      scheduledAt: post.scheduledAt,
    });
  }

  await logActivity(
    options.workspaceId,
    'post.rejected',
    { postId: options.postId, note: options.note },
    options.reviewerId,
  );
}

/**
 * Let go of posts still waiting for review, because nobody is reviewing them
 * any more.
 *
 * Turning the workflow off leaves posts already sitting in `pending` with
 * nowhere to go: the scheduler skips them, `publishNow` refuses them, and the
 * Approvals screen they would be cleared from is hidden the moment the setting
 * is off. Without this they are stranded permanently and invisibly — a client's
 * post that simply never goes out and never appears anywhere to explain why.
 *
 * Rejected posts are deliberately left alone. A reviewer made a decision on
 * those, and switching the workflow off is not a way to overturn it; their
 * author edits and reschedules them, which is the same route back as before.
 *
 * Called whenever the setting is written as off rather than only on the
 * transition, so a workspace already carrying stranded posts is healed the next
 * time an admin saves that page.
 */
export interface ReleaseResult {
  released: number;
  /** Their moment has gone, so the next tick publishes them. */
  publishingNow: number;
  /** Still ahead of their time, and will wait for it. */
  scheduled: number;
  /** No time set, so they went back to being drafts. */
  drafts: number;
}

export async function releaseHeldPosts(options: {
  workspaceId: string;
  userId: string;
  now?: Date;
}): Promise<ReleaseResult> {
  const now = options.now ?? new Date();
  const held = { workspaceId: options.workspaceId, ...IN_APPROVAL_QUEUE };

  // Same landing place as an approval: a post with no time set has nothing for
  // the scheduler to act on, so it returns to draft rather than to a scheduled
  // state it cannot honour. One whose time has already passed goes out on the
  // next tick, which is also what approving it would have done.
  const [overdue, scheduled, drafts] = await prisma.$transaction([
    // Counted before the updates, and first in the array so it reads the state
    // the switch is being flipped on. This is the number worth knowing: those
    // posts are on Facebook within the next tick.
    prisma.post.count({ where: { ...held, scheduledAt: { not: null, lte: now } } }),
    prisma.post.updateMany({
      where: { ...held, scheduledAt: { not: null } },
      data: { approvalStatus: ApprovalStatus.not_required, status: PostStatus.scheduled },
    }),
    prisma.post.updateMany({
      where: { ...held, scheduledAt: null },
      data: { approvalStatus: ApprovalStatus.not_required, status: PostStatus.draft },
    }),
  ]);

  const result: ReleaseResult = {
    released: scheduled.count + drafts.count,
    publishingNow: overdue,
    scheduled: scheduled.count - overdue,
    drafts: drafts.count,
  };

  if (result.released > 0) {
    // One audit entry rather than an email per author: this is a deliberate
    // administrative change, and a burst of "your post was approved" messages
    // nobody approved would be worse than none. Which makes this entry the only
    // durable record of what went out, so it carries the breakdown rather than
    // a total that cannot answer the question.
    await logActivity(options.workspaceId, 'approvals.disabled', result, options.userId);
  }

  return result;
}

/**
 * What is actually waiting on a reviewer.
 *
 * Both halves matter. `approvalStatus` alone counts posts that have since been
 * cancelled — cancelling leaves the approval state untouched, deliberately, so
 * the record of what was asked for survives — and a queue that lists work
 * nobody can act on trains reviewers to ignore the badge.
 */
export const IN_APPROVAL_QUEUE = {
  approvalStatus: ApprovalStatus.pending,
  status: PostStatus.pending_approval,
} as const;

/** Waiting posts on the Pages this member may see. */
export async function pendingApprovalCount(workspaceId: string, scope: PageScope): Promise<number> {
  return prisma.post.count({ where: { workspaceId, ...postScope(scope), ...IN_APPROVAL_QUEUE } });
}
