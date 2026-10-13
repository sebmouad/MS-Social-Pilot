import type { Prisma } from '@prisma/client';

import { prisma } from './prisma';

/**
 * One stream of what people wrote to the selected Pages — comments and
 * messages, newest first — with a done / not done state the team shares.
 *
 * Only what other people wrote: the Page's own comments and replies are not
 * waiting on anybody.
 */

export type InboxKind = 'comment' | 'message';
export type InboxState = 'open' | 'resolved' | 'all';

export interface InboxItem {
  kind: InboxKind;
  id: string;
  targetId: string;
  targetName: string;
  targetPictureUrl: string | null;
  author: string;
  text: string;
  at: Date;
  /** The post a comment was left on. */
  postMessage: string | null;
  isReply: boolean;
  resolvedAt: Date | null;
  /** The member it is assigned to, if anyone. */
  assigneeId: string | null;
}

/** Who an inbox list is narrowed to: everything, what nobody has taken, or one member's. */
export type InboxAssignee = { kind: 'unassigned' } | { kind: 'member'; userId: string };

interface Scope {
  workspaceId: string;
  /** The selected Pages, already clamped to the member's access. */
  targetIds: string[];
}

async function pagesOf(scope: Scope) {
  return prisma.target.findMany({
    where: { workspaceId: scope.workspaceId, id: { in: scope.targetIds } },
    select: { id: true, providerId: true },
  });
}

function assigneeWhere(assignee?: InboxAssignee) {
  if (!assignee) return {};
  return assignee.kind === 'unassigned' ? { assigneeId: null } : { assigneeId: assignee.userId };
}

function stateWhere(state: InboxState) {
  return state === 'open' ? { resolvedAt: null } : state === 'resolved' ? { resolvedAt: { not: null } } : {};
}

/** Comments on the selected Pages that the Page itself did not write. */
function commentWhere(pages: Array<{ id: string; providerId: string }>, state: InboxState, assignee?: InboxAssignee): Prisma.PostCommentWhereInput {
  return {
    ...stateWhere(state),
    ...assigneeWhere(assignee),
    OR: pages.map((page) => ({
      postTarget: { targetId: page.id },
      OR: [{ fromId: null }, { fromId: { not: page.providerId } }],
    })),
  };
}

function conversationWhere(scope: Scope, state: InboxState, assignee?: InboxAssignee): Prisma.ConversationWhereInput {
  return { targetId: { in: scope.targetIds }, target: { workspaceId: scope.workspaceId }, ...stateWhere(state), ...assigneeWhere(assignee) };
}

export async function readInbox(
  scope: Scope & { kind?: InboxKind; state: InboxState; limit: number; assignee?: InboxAssignee },
): Promise<InboxItem[]> {
  const pages = await pagesOf(scope);
  if (pages.length === 0) return [];

  const [comments, conversations] = await Promise.all([
    scope.kind === 'message'
      ? []
      : prisma.postComment.findMany({
          where: commentWhere(pages, scope.state, scope.assignee),
          include: {
            postTarget: {
              select: { targetId: true, target: { select: { name: true, pictureUrl: true } }, post: { select: { message: true } } },
            },
          },
          orderBy: [{ createdTime: 'desc' }, { id: 'desc' }],
          take: scope.limit,
        }),
    scope.kind === 'comment'
      ? []
      : prisma.conversation.findMany({
          where: conversationWhere(scope, scope.state, scope.assignee),
          include: { target: { select: { name: true, pictureUrl: true } } },
          orderBy: [{ updatedTime: 'desc' }, { id: 'desc' }],
          take: scope.limit,
        }),
  ]);

  const items: InboxItem[] = [
    ...comments.map((comment) => ({
      kind: 'comment' as const,
      id: comment.id,
      targetId: comment.postTarget.targetId,
      targetName: comment.postTarget.target.name,
      targetPictureUrl: comment.postTarget.target.pictureUrl,
      author: comment.fromName ?? '',
      text: comment.message,
      at: comment.createdTime,
      postMessage: comment.postTarget.post.message,
      isReply: comment.parentRemoteId !== null,
      resolvedAt: comment.resolvedAt,
      assigneeId: comment.assigneeId,
    })),
    ...conversations.map((conversation) => ({
      kind: 'message' as const,
      id: conversation.id,
      targetId: conversation.targetId,
      targetName: conversation.target.name,
      targetPictureUrl: conversation.target.pictureUrl,
      author: Array.isArray(conversation.participants) ? (conversation.participants as string[]).join(', ') : '',
      text: conversation.snippet ?? '',
      at: conversation.updatedTime,
      postMessage: null,
      isReply: false,
      resolvedAt: conversation.resolvedAt,
      assigneeId: conversation.assigneeId,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, scope.limit);
}

/** What still waits on someone, per kind. */
export async function countOpenInbox(scope: Scope): Promise<{ comments: number; messages: number }> {
  const pages = await pagesOf(scope);
  if (pages.length === 0) return { comments: 0, messages: 0 };
  const [comments, messages] = await Promise.all([
    prisma.postComment.count({ where: commentWhere(pages, 'open') }),
    prisma.conversation.count({ where: conversationWhere(scope, 'open') }),
  ]);
  return { comments, messages };
}

/**
 * Mark one item done or not done. Answers false when it is not on one of the
 * member's Pages, so the route can say 404 without revealing it exists.
 */
export async function setInboxResolved(
  scope: Scope & { kind: InboxKind; id: string; resolved: boolean; now?: Date },
): Promise<boolean> {
  const resolvedAt = scope.resolved ? (scope.now ?? new Date()) : null;
  const result =
    scope.kind === 'comment'
      ? await prisma.postComment.updateMany({
          where: {
            id: scope.id,
            postTarget: { targetId: { in: scope.targetIds }, post: { workspaceId: scope.workspaceId } },
          },
          data: { resolvedAt },
        })
      : await prisma.conversation.updateMany({
          where: { id: scope.id, ...conversationWhere(scope, 'all') },
          data: { resolvedAt },
        });
  return result.count > 0;
}

/**
 * Give an item to a member, or take it back (`null`). The member has to be on
 * the workspace's team, not a client. Answers false when the item is not on
 * one of the caller's Pages.
 */
export async function setInboxAssignee(
  scope: Scope & { kind: InboxKind; id: string; assigneeId: string | null },
): Promise<boolean> {
  if (scope.assigneeId) {
    const member = await prisma.membership.findFirst({
      where: { workspaceId: scope.workspaceId, userId: scope.assigneeId, role: { not: 'client' } },
      select: { id: true },
    });
    if (!member) return false;
  }
  const result =
    scope.kind === 'comment'
      ? await prisma.postComment.updateMany({
          where: { id: scope.id, postTarget: { targetId: { in: scope.targetIds }, post: { workspaceId: scope.workspaceId } } },
          data: { assigneeId: scope.assigneeId },
        })
      : await prisma.conversation.updateMany({
          where: { id: scope.id, ...conversationWhere(scope, 'all') },
          data: { assigneeId: scope.assigneeId },
        });
  return result.count > 0;
}
