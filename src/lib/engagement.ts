import { TargetType } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { decryptSecret } from './crypto';
import { parseInsights, toJson, toJsonOrNull } from './json';
import { asGraphError } from './facebook/graph';
import { fetchInsights } from './facebook/analytics';
import { syncExternalPostInsights } from './analytics';
import {
  deleteComment,
  fetchComments,
  fetchConversations,
  fetchPageVideos,
  fetchPublishedPosts,
  fetchReviews,
  replyToComment,
  setCommentHidden,
} from './facebook/edges';

/**
 * The Graph edges beyond `/insights`, stored and read back.
 *
 * Insights tell you a post reached 4,000 people. These tell you what those
 * people said, whether they left a one-star rating afterwards, and what they
 * asked in the inbox. That is the half of "all available data" that is not a
 * number.
 *
 * Every sync here is *partial-failure tolerant* by construction: a Page whose
 * token cannot read the inbox should still get its comments and reviews. So
 * each edge is caught separately and reported, rather than one throw killing
 * the pass.
 */

function tokenFor(target: {
  accessToken: string | null;
  socialAccount: { accessToken: string } | null;
}): string | null {
  const encrypted = target.accessToken ?? target.socialAccount?.accessToken ?? null;
  return encrypted ? decryptSecret(encrypted) : null;
}

export interface EdgeSyncResult {
  targetId: string;
  targetName: string;
  comments: number;
  reviews: number;
  conversations: number;
  externalPosts: number;
  videos: number;
  /** One entry per edge that failed, so a partial pass is still legible. */
  errors: Array<{ edge: string; message: string }>;
}


// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** Pull comments for one published destination and store them. */
export async function syncCommentsFor(postTargetId: string): Promise<number> {
  const row = await prisma.postTarget.findUniqueOrThrow({
    where: { id: postTargetId },
    include: { target: { include: { socialAccount: true } } },
  });

  if (!row.remotePostId) return 0;
  const token = tokenFor(row.target);
  if (!token) return 0;

  const comments = await fetchComments(row.remotePostId, token);

  for (const comment of comments) {
    await prisma.postComment.upsert({
      where: { postTargetId_remoteId: { postTargetId, remoteId: comment.remoteId } },
      create: {
        postTargetId,
        remoteId: comment.remoteId,
        parentRemoteId: comment.parentRemoteId,
        message: comment.message,
        fromName: comment.fromName,
        fromId: comment.fromId,
        likeCount: comment.likeCount,
        replyCount: comment.replyCount,
        isHidden: comment.isHidden,
        createdTime: comment.createdTime,
      },
      // Counts and hidden state change after the fact; the text does not, but
      // Facebook does allow editing, so it is refreshed too.
      update: {
        message: comment.message,
        likeCount: comment.likeCount,
        replyCount: comment.replyCount,
        isHidden: comment.isHidden,
        fetchedAt: new Date(),
      },
    });
  }

  return comments.length;
}

export interface CommentRow {
  id: string;
  remoteId: string;
  message: string;
  author: string;
  likeCount: number;
  replyCount: number;
  isHidden: boolean;
  isReply: boolean;
  createdTime: Date;
  postTargetId: string;
  postMessage: string;
  targetName: string;
}

/**
 * The workspace's comment stream, newest first.
 *
 * Scoped through `post.workspaceId` rather than by comment: a comment has no
 * workspace of its own, and joining through the post is what keeps one client's
 * inbox out of another's.
 */
export async function readComments(options: {
  workspaceId: string;
  targetId?: string;
  hidden?: boolean;
  search?: string;
  limit?: number;
}): Promise<CommentRow[]> {
  const rows = await prisma.postComment.findMany({
    where: {
      postTarget: {
        post: { workspaceId: options.workspaceId },
        ...(options.targetId ? { targetId: options.targetId } : {}),
      },
      ...(options.hidden === undefined ? {} : { isHidden: options.hidden }),
      ...(options.search ? { message: { contains: options.search, mode: 'insensitive' } } : {}),
    },
    include: {
      postTarget: {
        select: {
          id: true,
          target: { select: { name: true } },
          post: { select: { message: true } },
        },
      },
    },
    orderBy: { createdTime: 'desc' },
    take: options.limit ?? 100,
  });

  return rows.map((row) => ({
    id: row.id,
    remoteId: row.remoteId,
    message: row.message,
    author: row.fromName ?? 'Facebook user',
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    isHidden: row.isHidden,
    isReply: row.parentRemoteId !== null,
    createdTime: row.createdTime,
    postTargetId: row.postTarget.id,
    postMessage: row.postTarget.post.message,
    targetName: row.postTarget.target.name,
  }));
}

/** Look up the Page token behind a stored comment. */
async function tokenForComment(commentId: string, workspaceId: string) {
  const comment = await prisma.postComment.findFirst({
    where: { id: commentId, postTarget: { post: { workspaceId } } },
    include: {
      postTarget: { include: { target: { include: { socialAccount: true } } } },
    },
  });

  if (!comment) return null;
  const token = tokenFor(comment.postTarget.target);
  return token ? { comment, token } : null;
}

/** Hide or unhide a comment on Facebook, then mirror the change locally. */
export async function moderateComment(options: {
  commentId: string;
  workspaceId: string;
  hidden: boolean;
}): Promise<boolean> {
  const found = await tokenForComment(options.commentId, options.workspaceId);
  if (!found) return false;

  await setCommentHidden(found.comment.remoteId, found.token, options.hidden);
  await prisma.postComment.update({
    where: { id: options.commentId },
    data: { isHidden: options.hidden },
  });
  return true;
}

/**
 * Delete a comment on Facebook and drop the local row.
 *
 * The local row goes only after Graph confirms, so a failed delete leaves the
 * comment visible in both places rather than only in one.
 */
export async function removeComment(options: {
  commentId: string;
  workspaceId: string;
}): Promise<boolean> {
  const found = await tokenForComment(options.commentId, options.workspaceId);
  if (!found) return false;

  await deleteComment(found.comment.remoteId, found.token);
  await prisma.postComment.delete({ where: { id: options.commentId } });
  return true;
}

/** Reply to a comment as the Page. */
export async function replyToCommentAs(options: {
  commentId: string;
  workspaceId: string;
  message: string;
}): Promise<string | null> {
  const found = await tokenForComment(options.commentId, options.workspaceId);
  if (!found) return null;

  const remoteId = await replyToComment(found.comment.remoteId, found.token, options.message);

  // Store our own reply immediately rather than waiting for the next sync, so
  // the thread reads correctly the moment the request returns.
  await prisma.postComment.upsert({
    where: {
      postTargetId_remoteId: { postTargetId: found.comment.postTargetId, remoteId },
    },
    create: {
      postTargetId: found.comment.postTargetId,
      remoteId,
      parentRemoteId: found.comment.remoteId,
      message: options.message,
      createdTime: new Date(),
    },
    update: { message: options.message },
  });

  return remoteId;
}

// ---------------------------------------------------------------------------
// Reviews, conversations, external posts and videos
// ---------------------------------------------------------------------------

/**
 * Refresh every non-insights edge for one Page.
 *
 * Groups are skipped entirely: none of these edges exist for a Group, and
 * asking produces a permission error per edge on every pass.
 */
export async function syncTargetEdges(options: {
  targetId: string;
  since?: Date;
  now?: Date;
}): Promise<EdgeSyncResult> {
  const now = options.now ?? new Date();
  const since =
    options.since ?? new Date(now.getTime() - env.edgeWindowDays * 24 * 60 * 60 * 1000);

  const target = await prisma.target.findUniqueOrThrow({
    where: { id: options.targetId },
    include: { socialAccount: true },
  });

  const result: EdgeSyncResult = {
    targetId: target.id,
    targetName: target.name,
    comments: 0,
    reviews: 0,
    conversations: 0,
    externalPosts: 0,
    videos: 0,
    errors: [],
  };

  if (target.type === TargetType.group) {
    result.errors.push({ edge: 'all', message: 'Groups expose none of these edges.' });
    return result;
  }

  const token = tokenFor(target);
  if (!token) {
    result.errors.push({ edge: 'all', message: 'No access token stored for this destination.' });
    return result;
  }

  /** Run one edge, recording its failure instead of aborting the pass. */
  const attempt = async (edge: string, run: () => Promise<number>): Promise<void> => {
    try {
      const count = await run();
      result[edge as 'comments'] = count;
    } catch (error) {
      result.errors.push({ edge, message: asGraphError(error).displayMessage });
    }
  };

  await attempt('comments', async () => {
    const posts = await prisma.postTarget.findMany({
      where: { targetId: target.id, status: 'published', remotePostId: { not: null } },
      orderBy: { publishedAt: 'desc' },
      take: env.commentPostLimit,
      select: { id: true },
    });

    let total = 0;
    for (const post of posts) total += await syncCommentsFor(post.id);
    return total;
  });

  await attempt('reviews', async () => {
    const reviews = await fetchReviews(target.providerId, token);
    for (const review of reviews) {
      await prisma.pageReview.upsert({
        where: { targetId_remoteId: { targetId: target.id, remoteId: review.remoteId } },
        create: { targetId: target.id, ...review },
        update: {
          rating: review.rating,
          recommendationType: review.recommendationType,
          reviewText: review.reviewText,
          fetchedAt: new Date(),
        },
      });
    }
    return reviews.length;
  });

  await attempt('conversations', async () => {
    const conversations = await fetchConversations(target.providerId, token);

    for (const conversation of conversations) {
      const stored = await prisma.conversation.upsert({
        where: { targetId_remoteId: { targetId: target.id, remoteId: conversation.remoteId } },
        create: {
          targetId: target.id,
          remoteId: conversation.remoteId,
          snippet: conversation.snippet,
          unreadCount: conversation.unreadCount,
          messageCount: conversation.messageCount,
          participants: toJsonOrNull(conversation.participants),
          updatedTime: conversation.updatedTime,
        },
        update: {
          snippet: conversation.snippet,
          unreadCount: conversation.unreadCount,
          messageCount: conversation.messageCount,
          participants: toJsonOrNull(conversation.participants),
          updatedTime: conversation.updatedTime,
          fetchedAt: new Date(),
        },
      });

      for (const message of conversation.messages) {
        await prisma.conversationMessage.upsert({
          where: {
            conversationId_remoteId: {
              conversationId: stored.id,
              remoteId: message.remoteId,
            },
          },
          create: { conversationId: stored.id, ...message },
          update: { message: message.message },
        });
      }
    }

    return conversations.length;
  });

  await attempt('externalPosts', async () => {
    const posts = await fetchPublishedPosts(target.providerId, token, { since, until: now });

    // Anything this app published is already tracked in full; storing it again
    // as an "external" post would double every Page-level total.
    const ours = new Set(
      (
        await prisma.postTarget.findMany({
          where: { targetId: target.id, remotePostId: { not: null } },
          select: { remotePostId: true },
        })
      )
        .map((row) => row.remotePostId)
        .filter((id): id is string => id !== null),
    );

    const external = posts.filter((post) => !ours.has(post.remoteId));

    for (const post of external) {
      const stored = await prisma.externalPost.upsert({
        where: { targetId_remoteId: { targetId: target.id, remoteId: post.remoteId } },
        create: { targetId: target.id, ...post },
        update: { message: post.message, permalink: post.permalink, fetchedAt: new Date() },
      });

      // The same catalogue we read for our own posts. Without it this list can
      // say a colleague posted from the Facebook app but not whether anyone
      // saw it, and the Page-level totals stay wrong.
      await syncExternalPostInsights(stored.id);
    }

    return external.length;
  });

  await attempt('videos', async () => {
    const videos = await fetchPageVideos(target.providerId, token);

    for (const video of videos.slice(0, env.videoLimit)) {
      // The video-level catalogue: the only place a crossposted video's
      // combined figures exist.
      const insights = await fetchInsights({
        objectId: video.remoteId,
        level: 'video',
        accessToken: token,
        period: 'lifetime',
      }).catch(() => null);

      const metrics: Record<string, number | Record<string, number>> = {};
      for (const entry of insights?.series ?? []) {
        if (entry.latest !== null) metrics[entry.name] = entry.latest;
      }

      await prisma.pageVideo.upsert({
        where: { targetId_remoteId: { targetId: target.id, remoteId: video.remoteId } },
        create: {
          targetId: target.id,
          ...video,
          insights: insights ? toJson(metrics) : undefined,
          insightsSyncedAt: insights ? new Date() : null,
        },
        update: {
          title: video.title,
          description: video.description,
          thumbnailUrl: video.thumbnailUrl,
          ...(insights ? { insights: toJson(metrics), insightsSyncedAt: new Date() } : {}),
          fetchedAt: new Date(),
        },
      });
    }

    return Math.min(videos.length, env.videoLimit);
  });

  return result;
}

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

export interface ReviewSummary {
  count: number;
  averageRating: number | null;
  recommends: number;
  doesNotRecommend: number;
  byRating: Record<string, number>;
  recent: Array<{
    id: string;
    reviewer: string;
    rating: number | null;
    recommendationType: string | null;
    text: string | null;
    createdTime: Date;
  }>;
}

export async function readReviews(options: {
  workspaceId: string;
  targetId?: string;
  limit?: number;
}): Promise<ReviewSummary> {
  const rows = await prisma.pageReview.findMany({
    where: {
      target: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    orderBy: { createdTime: 'desc' },
    take: options.limit ?? 500,
  });

  const rated = rows.map((row) => row.rating).filter((value): value is number => value !== null);
  const byRating: Record<string, number> = {};
  for (const rating of rated) byRating[String(rating)] = (byRating[String(rating)] ?? 0) + 1;

  return {
    count: rows.length,
    averageRating:
      rated.length > 0
        ? Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) / 10
        : null,
    recommends: rows.filter((row) => row.recommendationType === 'positive').length,
    doesNotRecommend: rows.filter((row) => row.recommendationType === 'negative').length,
    byRating,
    recent: rows.slice(0, 20).map((row) => ({
      id: row.id,
      reviewer: row.reviewerName ?? 'Facebook user',
      rating: row.rating,
      recommendationType: row.recommendationType,
      text: row.reviewText,
      createdTime: row.createdTime,
    })),
  };
}

export interface ConversationRow {
  id: string;
  snippet: string | null;
  participants: string[];
  unreadCount: number;
  messageCount: number;
  updatedTime: Date;
  targetName: string;
  messages: Array<{ id: string; from: string; message: string | null; createdTime: Date }>;
}

export async function readConversations(options: {
  workspaceId: string;
  targetId?: string;
  limit?: number;
}): Promise<ConversationRow[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      target: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    include: {
      target: { select: { name: true } },
      messages: { orderBy: { createdTime: 'desc' }, take: 10 },
    },
    orderBy: { updatedTime: 'desc' },
    take: options.limit ?? 50,
  });

  return rows.map((row) => ({
    id: row.id,
    snippet: row.snippet,
    participants: Array.isArray(row.participants) ? (row.participants as string[]) : [],
    unreadCount: row.unreadCount,
    messageCount: row.messageCount,
    updatedTime: row.updatedTime,
    targetName: row.target.name,
    messages: row.messages.map((message) => ({
      id: message.id,
      from: message.fromName ?? 'Unknown',
      message: message.message,
      createdTime: message.createdTime,
    })),
  }));
}

export interface VideoRow {
  id: string;
  title: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  lengthSeconds: number | null;
  createdTime: Date;
  targetName: string;
  views: number | null;
  uniqueViews: number | null;
  completeViews: number | null;
  avgTimeWatchedMs: number | null;
  totalWatchTimeMs: number | null;
  impressions: number | null;
  metrics: Record<string, number | Record<string, number>>;
}

export async function readVideos(options: {
  workspaceId: string;
  targetId?: string;
  limit?: number;
}): Promise<VideoRow[]> {
  const rows = await prisma.pageVideo.findMany({
    where: {
      target: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    include: { target: { select: { name: true } } },
    orderBy: { createdTime: 'desc' },
    take: options.limit ?? 50,
  });

  return rows.map((row) => {
    const metrics =
      row.insights && typeof row.insights === 'object' && !Array.isArray(row.insights)
        ? (row.insights as Record<string, number | Record<string, number>>)
        : {};

    const number = (name: string): number | null =>
      typeof metrics[name] === 'number' ? (metrics[name] as number) : null;

    return {
      id: row.id,
      title: row.title ?? row.description?.slice(0, 80) ?? 'Untitled video',
      permalink: row.permalink,
      thumbnailUrl: row.thumbnailUrl,
      lengthSeconds: row.lengthSeconds,
      createdTime: row.createdTime,
      targetName: row.target.name,
      views: number('total_video_views'),
      uniqueViews: number('total_video_views_unique'),
      completeViews: number('total_video_complete_views'),
      avgTimeWatchedMs: number('total_video_avg_time_watched'),
      totalWatchTimeMs: number('total_video_view_total_time'),
      impressions: number('total_video_impressions'),
      metrics,
    };
  });
}

export interface ExternalPostRow {
  id: string;
  message: string;
  permalink: string | null;
  statusType: string | null;
  createdTime: Date;
  targetName: string;
  impressions: number | null;
  reach: number | null;
  engagedUsers: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  /** How many catalogue metrics were captured, for the drill-down link. */
  metricCount: number;
  syncedAt: Date | null;
}

/** Posts that reached the Page without going through this app. */
export async function readExternalPosts(options: {
  workspaceId: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<ExternalPostRow[]> {
  const rows = await prisma.externalPost.findMany({
    where: {
      target: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
      ...(options.from || options.to
        ? { createdTime: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
    },
    include: { target: { select: { name: true } } },
    orderBy: { createdTime: 'desc' },
    take: options.limit ?? 100,
  });

  return rows.map((row) => {
    const insights = parseInsights(row.insights);

    return {
      id: row.id,
      message: row.message ?? '(no text)',
      permalink: row.permalink,
      statusType: row.statusType,
      createdTime: row.createdTime,
      targetName: row.target.name,
      impressions: insights?.impressions ?? null,
      reach: insights?.reach ?? null,
      engagedUsers: insights?.engagedUsers ?? null,
      reactions: insights?.reactions ?? null,
      comments: insights?.comments ?? null,
      shares: insights?.shares ?? null,
      metricCount: Object.keys(insights?.metrics ?? {}).length,
      syncedAt: row.insightsSyncedAt,
    };
  });
}
