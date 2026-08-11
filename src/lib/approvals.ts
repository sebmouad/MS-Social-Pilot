import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { AppError, errors } from './errors';
import { canApprove, canPublishWithoutApproval } from './constants';
import { notifyApprovalDecision, notifyApprovalRequest } from './email/notify';
import { logActivity } from './scheduler/runner';

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

export async function submitForApproval(options: {
  workspaceId: string;
  postId: string;
  userId: string;
}): Promise<void> {
  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  if (!post) throw errors.postNotFound();

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

export async function approvePost(options: {
  workspaceId: string;
  postId: string;
  reviewerId: string;
  reviewerRole: WorkspaceRole;
}): Promise<void> {
  if (!canApprove(options.reviewerRole)) throw errors.noPermission();

  const post = await prisma.post.findFirst({
    where: { id: options.postId, workspaceId: options.workspaceId },
  });
  if (!post) throw errors.postNotFound();

  if (post.approvalStatus !== ApprovalStatus.pending) {
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
    { postId: options.postId },
    options.reviewerId,
  );
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

  if (post.approvalStatus !== ApprovalStatus.pending) {
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
export async function releaseHeldPosts(options: {
  workspaceId: string;
  userId: string;
}): Promise<number> {
  const held = { workspaceId: options.workspaceId, approvalStatus: ApprovalStatus.pending };

  // Same landing place as an approval: a post with no time set has nothing for
  // the scheduler to act on, so it returns to draft rather than to a scheduled
  // state it cannot honour. One whose time has already passed goes out on the
  // next tick, which is also what approving it would have done.
  const [scheduled, drafts] = await prisma.$transaction([
    prisma.post.updateMany({
      where: { ...held, scheduledAt: { not: null } },
      data: { approvalStatus: ApprovalStatus.not_required, status: PostStatus.scheduled },
    }),
    prisma.post.updateMany({
      where: { ...held, scheduledAt: null },
      data: { approvalStatus: ApprovalStatus.not_required, status: PostStatus.draft },
    }),
  ]);

  const released = scheduled.count + drafts.count;
  if (released > 0) {
    // One audit entry rather than an email per author: this is a deliberate
    // administrative change, and a burst of "your post was approved" messages
    // nobody approved would be worse than none.
    await logActivity(
      options.workspaceId,
      'approvals.disabled',
      { released },
      options.userId,
    );
  }

  return released;
}

export async function pendingApprovalCount(workspaceId: string): Promise<number> {
  return prisma.post.count({ where: { workspaceId, approvalStatus: ApprovalStatus.pending } });
}
