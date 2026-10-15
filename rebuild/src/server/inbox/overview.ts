import { prisma } from '@/server/data';
import { commentNeedsReply, conversationNeedsReply } from './threads';

export type InboxFilters = { channelIds: string[]; kind: 'all' | 'message' | 'comment'; status: 'open' | 'resolved' | 'all'; hidden: 'visible' | 'all' };

export type InboxListItem = {
  key: string;
  kind: 'message' | 'comment';
  id: string;
  author: string;
  preview: string;
  time: Date;
  target: { id: string; name: string; provider: string | null };
  unread: number;
  needsReply: boolean;
  resolved: boolean;
  hidden: boolean;
  /** For a comment, the post it is under. */
  context: string | null;
};

const LIST_LIMIT = 50;
const resolvedFilter = (status: InboxFilters['status']) => status === 'open' ? { resolvedAt: null } : status === 'resolved' ? { resolvedAt: { not: null } } : {};
const targetSelect = { id: true, name: true, providerId: true, socialAccount: { select: { provider: true } } } as const;

/** The newest conversations and top-level comments for the chosen channels, merged newest first. */
export async function listInboxItems(workspaceId: string, filters: InboxFilters): Promise<{ items: InboxListItem[]; truncated: boolean }> {
  const { channelIds } = filters;
  if (!channelIds.length) return { items: [], truncated: false };
  const [conversations, comments] = await Promise.all([
    filters.kind === 'comment' ? [] : prisma.conversation.findMany({
      where: { targetId: { in: channelIds }, target: { workspaceId }, ...resolvedFilter(filters.status) },
      orderBy: { updatedTime: 'desc' }, take: LIST_LIMIT,
      select: { id: true, snippet: true, unreadCount: true, updatedTime: true, resolvedAt: true, target: { select: targetSelect }, messages: { orderBy: { createdTime: 'desc' }, take: 1, select: { fromName: true, fromId: true, sentById: true, message: true } } },
    }),
    filters.kind === 'message' ? [] : prisma.postComment.findMany({
      where: { parentRemoteId: null, ...(filters.hidden === 'visible' ? { isHidden: false } : {}), postTarget: { targetId: { in: channelIds }, post: { workspaceId }, target: { workspaceId } }, ...resolvedFilter(filters.status) },
      orderBy: { createdTime: 'desc' }, take: LIST_LIMIT,
      select: { id: true, remoteId: true, postTargetId: true, message: true, fromName: true, createdTime: true, resolvedAt: true, isHidden: true, postTarget: { select: { target: { select: targetSelect }, post: { select: { message: true } } } } },
    }),
  ]);
  // Replies from the channel side decide whether a comment still needs an answer.
  const replies = comments.length ? await prisma.postComment.findMany({
    where: { OR: comments.map(comment => ({ postTargetId: comment.postTargetId, parentRemoteId: comment.remoteId })) },
    select: { postTargetId: true, parentRemoteId: true, fromId: true, sentById: true },
  }) : [];

  const items: InboxListItem[] = [
    ...conversations.map(item => {
      const newest = item.messages[0];
      return {
        key: `message:${item.id}`, kind: 'message' as const, id: item.id,
        author: newest?.sentById ? 'You' : newest?.fromName || 'Conversation',
        preview: newest?.message || item.snippet || 'No message text available.',
        time: item.updatedTime,
        target: { id: item.target.id, name: item.target.name, provider: item.target.socialAccount?.provider ?? null },
        unread: item.unreadCount, needsReply: conversationNeedsReply(newest, item.target.providerId, Boolean(item.resolvedAt)),
        resolved: Boolean(item.resolvedAt), hidden: false, context: null,
      };
    }),
    ...comments.map(item => {
      const mine = replies.filter(reply => reply.postTargetId === item.postTargetId && reply.parentRemoteId === item.remoteId);
      return {
        key: `comment:${item.id}`, kind: 'comment' as const, id: item.id,
        author: item.fromName || 'Visitor', preview: item.message, time: item.createdTime,
        target: { id: item.postTarget.target.id, name: item.postTarget.target.name, provider: item.postTarget.target.socialAccount?.provider ?? null },
        unread: 0, needsReply: commentNeedsReply(mine, item.postTarget.target.providerId, { resolved: Boolean(item.resolvedAt), hidden: item.isHidden }),
        resolved: Boolean(item.resolvedAt), hidden: item.isHidden, context: item.postTarget.post.message,
      };
    }),
  ].sort((a, b) => b.time.getTime() - a.time.getTime());
  return { items, truncated: conversations.length === LIST_LIMIT || comments.length === LIST_LIMIT };
}

export type ThreadEntry = { id: string; author: string; text: string; time: Date; fromChannel: boolean; sentBy: string | null };
export type OpenThread = {
  kind: 'message' | 'comment';
  id: string;
  target: { id: string; name: string; providerId: string; provider: string | null };
  resolved: boolean;
  hidden: boolean;
  /** The post a comment is under. */
  postText: string | null;
  entries: ThreadEntry[];
  /** For a message thread: the newest message from the other side (drives the reply window). */
  lastInbound: { fromId: string | null; createdTime: Date } | null;
};

async function memberNames(workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const members = await prisma.membership.findMany({ where: { workspaceId, userId: { in: ids } }, select: { user: { select: { id: true, name: true } } } });
  return new Map(members.map(member => [member.user.id, member.user.name]));
}

/** One thread with its full stored history, limited to channels the viewer may open. */
export async function loadThread(workspaceId: string, channelIds: string[], key: string): Promise<OpenThread | null> {
  const [kind, id] = key.split(':');
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || !channelIds.length) return null;
  if (kind === 'message') {
    const conversation = await prisma.conversation.findFirst({
      where: { id, targetId: { in: channelIds }, target: { workspaceId } },
      select: { id: true, resolvedAt: true, target: { select: targetSelect }, messages: { orderBy: { createdTime: 'asc' }, take: 300, select: { id: true, fromName: true, fromId: true, sentById: true, message: true, createdTime: true } } },
    });
    if (!conversation) return null;
    const pageId = conversation.target.providerId;
    const names = await memberNames(workspaceId, [...new Set(conversation.messages.flatMap(message => message.sentById ? [message.sentById] : []))]);
    const lastInbound = await prisma.conversationMessage.findFirst({
      where: { conversationId: conversation.id, fromId: { not: null }, NOT: { fromId: pageId } },
      orderBy: { createdTime: 'desc' }, select: { fromId: true, createdTime: true },
    });
    return {
      kind: 'message', id: conversation.id, resolved: Boolean(conversation.resolvedAt), hidden: false, postText: null, lastInbound,
      target: { id: conversation.target.id, name: conversation.target.name, providerId: pageId, provider: conversation.target.socialAccount?.provider ?? null },
      entries: conversation.messages.map(message => {
        const fromChannel = message.sentById !== null || (message.fromId !== null && message.fromId === pageId);
        return { id: message.id, author: fromChannel ? conversation.target.name : message.fromName || 'Visitor', text: message.message || '', time: message.createdTime, fromChannel, sentBy: message.sentById ? names.get(message.sentById) ?? 'A teammate' : null };
      }),
    };
  }
  if (kind === 'comment') {
    const comment = await prisma.postComment.findFirst({
      where: { id, postTarget: { targetId: { in: channelIds }, post: { workspaceId }, target: { workspaceId } } },
      select: { id: true, remoteId: true, postTargetId: true, message: true, fromName: true, fromId: true, sentById: true, createdTime: true, resolvedAt: true, isHidden: true, postTarget: { select: { target: { select: targetSelect }, post: { select: { message: true } } } } },
    });
    if (!comment) return null;
    const replies = await prisma.postComment.findMany({
      where: { postTargetId: comment.postTargetId, parentRemoteId: comment.remoteId },
      orderBy: { createdTime: 'asc' }, take: 300,
      select: { id: true, message: true, fromName: true, fromId: true, sentById: true, createdTime: true },
    });
    const target = comment.postTarget.target;
    const names = await memberNames(workspaceId, [...new Set(replies.flatMap(reply => reply.sentById ? [reply.sentById] : []))]);
    const entry = (item: { id: string; message: string; fromName: string | null; fromId: string | null; sentById: string | null; createdTime: Date }): ThreadEntry => {
      const fromChannel = item.sentById !== null || (item.fromId !== null && item.fromId === target.providerId);
      return { id: item.id, author: fromChannel ? target.name : item.fromName || 'Visitor', text: item.message, time: item.createdTime, fromChannel, sentBy: item.sentById ? names.get(item.sentById) ?? 'A teammate' : null };
    };
    return {
      kind: 'comment', id: comment.id, resolved: Boolean(comment.resolvedAt), hidden: comment.isHidden, postText: comment.postTarget.post.message, lastInbound: null,
      target: { id: target.id, name: target.name, providerId: target.providerId, provider: target.socialAccount?.provider ?? null },
      entries: [entry(comment), ...replies.map(entry)],
    };
  }
  return null;
}

/** The most recent time the inbox was refreshed from the platform for these channels. */
export async function inboxLastSynced(workspaceId: string, channelIds: string[]): Promise<Date | null> {
  if (!channelIds.length) return null;
  const [conversations, comments, audited] = await Promise.all([
    prisma.conversation.aggregate({ where: { targetId: { in: channelIds } }, _max: { fetchedAt: true } }),
    prisma.postComment.aggregate({ where: { postTarget: { targetId: { in: channelIds } } }, _max: { fetchedAt: true } }),
    prisma.$queryRaw<Array<{ at: Date | null }>>`SELECT MAX("createdAt") AS at FROM root_activities WHERE action = 'inbox.synced' AND detail->>'workspaceId' = ${workspaceId} AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(detail->'targetIds', '[]'::jsonb)) AS channel(id) WHERE channel.id = ANY(${channelIds}::text[]))`,
  ]);
  const times = [conversations._max.fetchedAt, comments._max.fetchedAt, audited[0]?.at ?? null].filter((value): value is Date => value instanceof Date);
  return times.length ? new Date(Math.max(...times.map(value => value.getTime()))) : null;
}
