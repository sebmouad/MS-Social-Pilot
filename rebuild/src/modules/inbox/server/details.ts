import { z } from 'zod';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { authorizeInbox } from './access';
import { storedSentiment } from './read';
import { sentimentTrend, type InboxContactDetails, type SentimentPoint } from '../details';
import type { InboxReadActor, InboxReadConstraints } from './types';

const keySchema = z.object({ key: z.string().regex(/^(message|comment|review):[A-Za-z0-9_-]{1,200}$/) }).strict();
const unavailable = () => new OperationError('not_found', 'This conversation is unavailable. Choose another Inbox item.');
const targetSelect = { id: true, name: true, providerId: true, socialAccount: { select: { provider: true } } } as const;

async function limits() {
  const values = await Promise.all([runtimeConfig('inbox.relatedPostsLimit'), runtimeConfig('inbox.sentimentTrendLimit')]);
  const checked = z.tuple([z.number().int().min(1).max(100), z.number().int().min(2).max(100)]).safeParse(values);
  if (!checked.success) throw new OperationError('unavailable', 'Conversation details are currently unavailable.');
  return { relatedPostsLimit: checked.data[0], sentimentTrendLimit: checked.data[1] };
}

/**
 * What the team knows about the person behind one stored Inbox item: who they are on this channel, when they first
 * appeared, how much they wrote, which of your posts they talked about and how their comments read over time.
 * Everything comes from stored data inside the authorized channels; it never contacts the platform. A person is
 * identified by the platform's id for them on this one channel; without an id only the open item is described.
 */
export async function readInboxContactDetails(actor: InboxReadActor, input: unknown, constraints: InboxReadConstraints = {}): Promise<InboxContactDetails> {
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose a valid conversation.');
  const access = await authorizeInbox(actor, constraints);
  const [kind, id] = parsed.data.key.split(':') as ['message' | 'comment' | 'review', string];
  if (!access.channelIds.length) throw unavailable();
  const cap = await limits();
  const scope = { targetId: { in: [...access.channelIds] }, target: { workspaceId: actor.workspaceId } };

  if (kind === 'review') {
    const rows = await prisma.$queryRaw<Array<{ id: string; targetId: string; reviewerName: string | null; createdTime: Date; resolvedAt: Date | null }>>(Prisma.sql`
      SELECT r.id, r."targetId", r."reviewerName", r."createdTime", r."resolvedAt" FROM page_reviews r JOIN targets t ON t.id = r."targetId"
      WHERE r.id = ${id} AND t."workspaceId" = ${actor.workspaceId} AND t.id IN (${Prisma.join(access.channelIds)})`);
    const review = rows[0];
    if (!review) throw unavailable();
    const target = await prisma.target.findFirst({ where: { id: review.targetId, workspaceId: actor.workspaceId }, select: targetSelect });
    if (!target) throw unavailable();
    return {
      kind, id, person: { name: review.reviewerName || 'Visitor', remoteId: null }, channel: { id: target.id, name: target.name, provider: target.socialAccount?.provider ?? null },
      firstSeen: review.createdTime, messageCount: 1, identityKnown: false, relatedPosts: [], relatedPostsMore: false,
      state: { resolved: Boolean(review.resolvedAt), hidden: false, unread: 0, assignee: null }, sentiment: sentimentTrend([]),
    };
  }

  let target: { id: string; name: string; providerId: string; socialAccount: { provider: string } | null };
  let person: { name: string; remoteId: string | null };
  let state: InboxContactDetails['state'] & { assigneeId: string | null };
  let ownComment: { postTargetId: string; createdTime: Date; sentiment: string | null } | null = null;
  if (kind === 'message') {
    const conversation = await prisma.conversation.findFirst({ where: { id, ...scope }, select: { assigneeId: true, unreadCount: true, resolvedAt: true, target: { select: targetSelect } } });
    if (!conversation) throw unavailable();
    target = conversation.target;
    // The other side of the conversation is whoever wrote the newest message that is not the channel's own.
    const inbound = await prisma.conversationMessage.findFirst({ where: { conversationId: id, sentById: null, NOT: { fromId: target.providerId } }, orderBy: [{ createdTime: 'desc' }, { id: 'desc' }], select: { fromId: true, fromName: true } });
    person = { name: inbound?.fromName || 'Visitor', remoteId: inbound?.fromId ?? null };
    state = { resolved: Boolean(conversation.resolvedAt), hidden: false, unread: conversation.unreadCount, assignee: null, assigneeId: conversation.assigneeId };
  } else {
    const comment = await prisma.postComment.findFirst({ where: { id, parentRemoteId: null, postTarget: { ...scope, post: { workspaceId: actor.workspaceId } } }, select: { fromId: true, fromName: true, resolvedAt: true, isHidden: true, assigneeId: true, postTargetId: true, createdTime: true, sentiment: true, postTarget: { select: { target: { select: targetSelect } } } } });
    if (!comment) throw unavailable();
    target = comment.postTarget.target;
    person = { name: comment.fromName || 'Visitor', remoteId: comment.fromId };
    ownComment = { postTargetId: comment.postTargetId, createdTime: comment.createdTime, sentiment: comment.sentiment };
    state = { resolved: Boolean(comment.resolvedAt), hidden: comment.isHidden, unread: 0, assignee: null, assigneeId: comment.assigneeId };
  }

  const assignee = state.assigneeId ? await prisma.membership.findFirst({ where: { workspaceId: actor.workspaceId, userId: state.assigneeId }, select: { user: { select: { id: true, name: true } } } }) : null;
  const { assigneeId: _assigneeId, ...publicState } = state;
  const base = { kind, id, person, channel: { id: target.id, name: target.name, provider: target.socialAccount?.provider ?? null }, state: { ...publicState, assignee: assignee ? { id: assignee.user.id, name: assignee.user.name } : null } };

  // Without a platform id for the person nothing else can be attributed to them safely.
  if (!person.remoteId) {
    const post = ownComment ? await prisma.postTarget.findFirst({ where: { id: ownComment.postTargetId, targetId: target.id }, select: { post: { select: { id: true, message: true } } } }) : null;
    return {
      ...base, firstSeen: null, messageCount: 1, identityKnown: false,
      relatedPosts: post && ownComment ? [{ id: post.post.id, text: post.post.message, comments: 1, lastCommentAt: ownComment.createdTime }] : [], relatedPostsMore: false,
      sentiment: sentimentTrend(ownComment ? [{ time: ownComment.createdTime, sentiment: storedSentiment(ownComment.sentiment) }] : []),
    };
  }

  const from = person.remoteId;
  const [messageTotals, commentTotals, posts, recent] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint; first: Date | null }>>(Prisma.sql`
      SELECT COUNT(*) AS count, MIN(m."firstSeenAt") AS first FROM conversation_messages m JOIN conversations c ON c.id = m."conversationId" JOIN targets t ON t.id = c."targetId"
      WHERE t.id = ${target.id} AND t."workspaceId" = ${actor.workspaceId} AND m."fromId" = ${from} AND m."sentById" IS NULL`),
    prisma.$queryRaw<Array<{ count: bigint; first: Date | null }>>(Prisma.sql`
      SELECT COUNT(*) AS count, MIN(pc."firstSeenAt") AS first FROM post_comments pc JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
      WHERE t.id = ${target.id} AND t."workspaceId" = ${actor.workspaceId} AND p."workspaceId" = ${actor.workspaceId} AND pc."fromId" = ${from} AND pc."sentById" IS NULL`),
    prisma.$queryRaw<Array<{ id: string; message: string | null; comments: bigint; last: Date }>>(Prisma.sql`
      SELECT p.id, p.message, COUNT(*) AS comments, MAX(pc."createdTime") AS last FROM post_comments pc JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
      WHERE t.id = ${target.id} AND t."workspaceId" = ${actor.workspaceId} AND p."workspaceId" = ${actor.workspaceId} AND pc."fromId" = ${from} AND pc."sentById" IS NULL
      GROUP BY p.id, p.message ORDER BY MAX(pc."createdTime") DESC, p.id LIMIT ${cap.relatedPostsLimit + 1}`),
    prisma.$queryRaw<Array<{ createdTime: Date; sentiment: string | null }>>(Prisma.sql`
      SELECT pc."createdTime", pc.sentiment FROM post_comments pc JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
      WHERE t.id = ${target.id} AND t."workspaceId" = ${actor.workspaceId} AND p."workspaceId" = ${actor.workspaceId} AND pc."fromId" = ${from} AND pc."sentById" IS NULL
      ORDER BY pc."createdTime" DESC, pc.id DESC LIMIT ${cap.sentimentTrendLimit}`),
  ]);
  const firsts = [messageTotals[0]?.first, commentTotals[0]?.first].filter((value): value is Date => value instanceof Date);
  const points: SentimentPoint[] = recent.map(row => ({ time: row.createdTime, sentiment: storedSentiment(row.sentiment) }));
  return {
    ...base,
    firstSeen: firsts.length ? new Date(Math.min(...firsts.map(value => value.getTime()))) : null,
    messageCount: Number(messageTotals[0]?.count ?? 0) + Number(commentTotals[0]?.count ?? 0),
    identityKnown: true,
    relatedPosts: posts.slice(0, cap.relatedPostsLimit).map(row => ({ id: row.id, text: row.message, comments: Number(row.comments), lastCommentAt: row.last })),
    relatedPostsMore: posts.length > cap.relatedPostsLimit,
    sentiment: sentimentTrend(points),
  };
}
