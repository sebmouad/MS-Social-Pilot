import { TargetType, type WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { canDeleteComments, canModerateComments } from './constants';
import { decryptSecret } from './crypto';
import { parseInsights, toJson, toJsonOrNull } from './json';
import { asGraphError } from './facebook/graph';
import { fetchInsights } from './facebook/analytics';
import { logActivity } from './scheduler/runner';
import { syncExternalPostInsights } from './analytics';
import {
  deleteComment,
  fetchComments,
  REVIEW_FETCH_CEILING,
  fetchConversations,
  fetchPageVideos,
  fetchPublishedPosts,
  fetchReviews,
  replyToComment,
  sendPageMessage,
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

/**
 * How far back a sync looks past the newest comment it already has.
 *
 * `since` is on created_time, so without an overlap a comment that is edited,
 * liked or hidden after we first read it would never be looked at again. A day
 * covers the window in which a comment is actually being argued over, and also
 * absorbs any clock difference between us and Facebook.
 */
const COMMENT_SYNC_OVERLAP_MS = 24 * 60 * 60 * 1000;

/**
 * Pull comments for one published destination and store them.
 *
 * Asks only for what is new. The fetch is capped at five pages of a hundred in
 * chronological order, so a post that passes five hundred comments would
 * otherwise return the same oldest five hundred on every sync and never show a
 * new one again — the inbox would go quiet on exactly the posts a client cares
 * most about. Anchoring to the newest comment we hold means each sync starts
 * where the last one stopped, and the ceiling applies to what arrived since
 * rather than to the post's whole history.
 */
export async function syncCommentsFor(postTargetId: string): Promise<number> {
  const row = await prisma.postTarget.findUniqueOrThrow({
    where: { id: postTargetId },
    include: { target: { include: { socialAccount: true } } },
  });

  if (!row.remotePostId) return 0;
  const token = tokenFor(row.target);
  if (!token) return 0;

  const newest = await prisma.postComment.findFirst({
    where: { postTargetId },
    orderBy: { createdTime: 'desc' },
    select: { createdTime: true },
  });

  const comments = await fetchComments(row.remotePostId, token, {
    // Nothing stored yet means a first sync, which reads the history it can.
    since: newest ? new Date(newest.createdTime.getTime() - COMMENT_SYNC_OVERLAP_MS) : undefined,
  });

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
 * A row count that makes sense, whatever was asked for.
 *
 * Not a ceiling: the CSV export legitimately asks for thousands, and quietly
 * cutting it to a screen-sized page would be the silent truncation this
 * codebase keeps having to remove. What is refused is nonsense — Prisma reads
 * `take: -5` as five rows *backwards*, so a negative number arriving from a
 * query string returned the oldest comments under a heading that said latest.
 * The ceiling on untrusted input belongs at the route, where untrusted input
 * arrives.
 */
function rowCount(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.trunc(requested);
}

/**
 * The workspace's comment stream, newest first.
 *
 * Scoped through `post.workspaceId` rather than by comment: a comment has no
 * workspace of its own, and joining through the post is what keeps one client's
 * inbox out of another's.
 */
/**
 * The filter every comment query shares.
 *
 * Written once so the count and the page cannot disagree: a count taken over
 * different criteria than the rows gives a pager that offers a page with
 * nothing on it.
 */
function commentWhere(options: {
  workspaceId: string;
  targetId?: string;
  hidden?: boolean;
  search?: string;
}) {
  return {
    postTarget: {
      post: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    ...(options.hidden === undefined ? {} : { isHidden: options.hidden }),
    ...(options.search ? { message: { contains: options.search, mode: 'insensitive' as const } } : {}),
  };
}

export async function countComments(options: {
  workspaceId: string;
  targetId?: string;
  hidden?: boolean;
  search?: string;
}): Promise<number> {
  return prisma.postComment.count({ where: commentWhere(options) });
}

export async function readComments(options: {
  workspaceId: string;
  targetId?: string;
  hidden?: boolean;
  search?: string;
  limit?: number;
  skip?: number;
}): Promise<CommentRow[]> {
  const rows = await prisma.postComment.findMany({
    where: commentWhere(options),
    include: {
      postTarget: {
        select: {
          id: true,
          target: { select: { name: true } },
          post: { select: { message: true } },
        },
      },
    },
    // `id` last: without a unique tiebreaker, comments sharing a timestamp can
    // land on two pages while another lands on none.
    orderBy: [{ createdTime: 'desc' }, { id: 'desc' }],
    skip: options.skip ?? 0,
    take: rowCount(options.limit, 100),
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

/**
 * The answer to a moderation request.
 *
 * Three outcomes rather than a boolean, for the same reason as connections:
 * "not yours", "not allowed" and "done" have to stay distinguishable, or a
 * refusal reads to the caller as a comment that was never there.
 */
export type ModerationOutcome = 'ok' | 'not_found' | 'forbidden' | 'gone';

/**
 * Run a moderation action, treating "it is not there any more" as an answer.
 *
 * Comment authors delete their own comments, and page owners moderate from
 * Facebook's own app. Our copy only refreshes when a sync runs, so somebody
 * acting on a comment from the inbox can be acting on one that no longer
 * exists. Graph says so with code 100.
 *
 * Left alone that surfaced a raw Graph error and the comment stayed in the
 * list, so the next attempt failed the same way. Dropping the row instead
 * makes the list agree with Facebook, and the caller gets an outcome that says
 * what happened rather than an error that reads like a bug.
 *
 * Only code 100. Every other failure — a dead token, a rate limit, a network
 * blip — leaves the row alone, because the comment is probably still there and
 * deleting our copy would lose it.
 */
async function actOnComment(commentId: string, action: () => Promise<void>): Promise<'ok' | 'gone'> {
  try {
    await action();
    return 'ok';
  } catch (error) {
    if (asGraphError(error).code !== 100) throw error;
    await prisma.postComment.deleteMany({ where: { id: commentId } });
    return 'gone';
  }
}

/**
 * Replying in the inbox can fail for two reasons moderation cannot, and both
 * need saying rather than collapsing into "not found".
 */
export type ReplyOutcome = ModerationOutcome | 'outside_window' | 'no_recipient';

/**
 * How long after somebody writes to a Page it may write back.
 *
 * Facebook's standard messaging window. Outside it a reply is refused unless
 * it carries a message tag, and the tags are for a short list of purposes
 * (a confirmed event, an account update) that a scheduling tool has no
 * business claiming. So the honest thing is to say the window has closed.
 */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  userId: string;
  role: WorkspaceRole;
  hidden: boolean;
}): Promise<ModerationOutcome> {
  if (!canModerateComments(options.role)) return 'forbidden';

  const found = await tokenForComment(options.commentId, options.workspaceId);
  if (!found) return 'not_found';

  const outcome = await actOnComment(options.commentId, () =>
    setCommentHidden(found.comment.remoteId, found.token, options.hidden),
  );
  if (outcome === 'gone') return 'gone';

  await prisma.postComment.update({
    where: { id: options.commentId },
    data: { isHidden: options.hidden },
  });

  await logActivity(
    options.workspaceId,
    options.hidden ? 'comment.hidden' : 'comment.unhidden',
    { commentId: options.commentId, remoteId: found.comment.remoteId },
    options.userId,
  );
  return 'ok';
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
  userId: string;
  role: WorkspaceRole;
}): Promise<ModerationOutcome> {
  // A step above hiding: hiding is undone from the same screen, this is not.
  if (!canDeleteComments(options.role)) return 'forbidden';

  const found = await tokenForComment(options.commentId, options.workspaceId);
  if (!found) return 'not_found';

  // Already gone on Facebook is the outcome this action was asking for, so the
  // local row goes either way — but the log below only records a deletion we
  // actually performed.
  const outcome = await actOnComment(options.commentId, () =>
    deleteComment(found.comment.remoteId, found.token),
  );
  if (outcome === 'gone') return 'gone';

  await prisma.postComment.delete({ where: { id: options.commentId } });

  // The one moderation action nothing can undo, on a page belonging to
  // somebody else's business. Its author, its text and who removed it are kept
  // here because Facebook keeps none of it once the delete lands.
  await logActivity(
    options.workspaceId,
    'comment.deleted',
    {
      remoteId: found.comment.remoteId,
      author: found.comment.fromName,
      message: found.comment.message,
    },
    options.userId,
  );
  return 'ok';
}

/** Reply to a comment as the Page. */
export async function replyToCommentAs(options: {
  commentId: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  message: string;
}): Promise<{ outcome: ModerationOutcome; remoteId?: string }> {
  if (!canModerateComments(options.role)) return { outcome: 'forbidden' };

  const found = await tokenForComment(options.commentId, options.workspaceId);
  if (!found) return { outcome: 'not_found' };

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

  return { outcome: 'ok', remoteId };
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

  // Total, like the analytics readers: `errors` is the channel, and every
  // caller is a loop over Pages. The name is only unknown when the row itself
  // cannot be read.
  const result: EdgeSyncResult = {
    targetId: options.targetId,
    targetName: 'Unknown destination',
    comments: 0,
    reviews: 0,
    conversations: 0,
    externalPosts: 0,
    videos: 0,
    errors: [],
  };

  let target: Awaited<ReturnType<typeof prisma.target.findUniqueOrThrow>> & {
    socialAccount: { accessToken: string } | null;
  };
  let token: string;

  try {
    target = await prisma.target.findUniqueOrThrow({
      where: { id: options.targetId },
      include: { socialAccount: true },
    });
    result.targetName = target.name;

    if (target.type === TargetType.group) {
      result.errors.push({ edge: 'all', message: 'Groups expose none of these edges.' });
      return result;
    }

    // Inside the guard because decrypting it throws when the stored value
    // predates a key rotation, which is not something the row can express.
    const decrypted = tokenFor(target);
    if (!decrypted) {
      result.errors.push({ edge: 'all', message: 'No access token stored for this destination.' });
      return result;
    }
    token = decrypted;
  } catch (error) {
    result.errors.push({ edge: 'all', message: asGraphError(error).displayMessage });
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
    /**
     * Store a batch in a handful of statements rather than one per review.
     *
     * A row at a time is a round trip at a time: a thousand reviews measured
     * at 1.6 seconds against a database on the same machine, and every sync
     * re-reads the newest five hundred, almost none of which have changed. The
     * same work batched is 19 milliseconds, because the common case turns into
     * one read that finds nothing to do.
     *
     * `fetchedAt` still moves for every review seen, so it keeps meaning "when
     * we last had this from Facebook" rather than quietly becoming "when it
     * last changed".
     */
    const store = async (batch: Awaited<ReturnType<typeof fetchReviews>>) => {
      if (batch.length === 0) return;

      const remoteIds = batch.map((review) => review.remoteId);
      const existing = await prisma.pageReview.findMany({
        where: { targetId: target.id, remoteId: { in: remoteIds } },
        select: { remoteId: true, rating: true, recommendationType: true, reviewText: true },
      });
      const before = new Map(existing.map((row) => [row.remoteId, row]));

      const fresh = batch.filter((review) => !before.has(review.remoteId));
      if (fresh.length > 0) {
        await prisma.pageReview.createMany({
          data: fresh.map((review) => ({ targetId: target.id, ...review })),
          // A review arriving twice in one walk — the newest window and the
          // backfill window can overlap on the boundary — is not an error.
          skipDuplicates: true,
        });
      }

      // Facebook lets a review be edited, so the ones that changed still need
      // writing. In a steady state this list is empty.
      for (const review of batch) {
        const previous = before.get(review.remoteId);
        if (!previous) continue;
        if (
          previous.rating === review.rating &&
          previous.recommendationType === review.recommendationType &&
          previous.reviewText === review.reviewText
        ) {
          continue;
        }

        await prisma.pageReview.update({
          where: { targetId_remoteId: { targetId: target.id, remoteId: review.remoteId } },
          data: {
            rating: review.rating,
            recommendationType: review.recommendationType,
            reviewText: review.reviewText,
          },
        });
      }

      await prisma.pageReview.updateMany({
        where: { targetId: target.id, remoteId: { in: remoteIds } },
        data: { fetchedAt: new Date() },
      });
    };

    // Newest first, which is what Facebook returns without a window, so this
    // always picks up anything new.
    const reviews = await fetchReviews(target.providerId, token);
    await store(reviews);

    // A full fetch means there may be more behind it. Walk backwards from the
    // oldest review now held — including the ones just stored, so a Page with
    // a long history starts closing the gap on its first sync rather than its
    // second.
    //
    // Until that walk reaches the beginning the average rating covers part of
    // the history, and that is the number an agency reports to the business it
    // belongs to. A partial sum can only understate and somebody may notice; a
    // partial average is wrong in either direction with nothing to signal
    // which.
    let older: Awaited<ReturnType<typeof fetchReviews>> = [];
    let complete = reviews.length < REVIEW_FETCH_CEILING;

    if (!target.reviewsBackfilled && !complete) {
      const oldest = await prisma.pageReview.findFirst({
        where: { targetId: target.id },
        orderBy: { createdTime: 'asc' },
        select: { createdTime: true },
      });

      if (oldest) {
        older = await fetchReviews(target.providerId, token, { until: oldest.createdTime });
        await store(older);
        // Short of the ceiling means there was nothing more to give.
        complete = older.length < REVIEW_FETCH_CEILING;
      }
    }

    if (complete && !target.reviewsBackfilled) {
      await prisma.target.update({
        where: { id: target.id },
        data: { reviewsBackfilled: true },
      });
    }

    return reviews.length + older.length;
  });

  await attempt('conversations', async () => {
    const conversations = await fetchConversations(target.providerId, token);
    const pending: Array<{ conversationId: string } & (typeof conversations)[number]['messages'][number]> = [];

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
        pending.push({ conversationId: stored.id, ...message });
      }
    }

    // One insert for every message in every thread, rather than one round trip
    // each. A Page can hold a hundred and fifty threads of twenty-five
    // messages, and almost all of them are already stored — the old loop spent
    // thousands of round trips per sync to write what was already there.
    //
    // Insert-only, with no update: a message on Facebook cannot be edited
    // after it is sent, so a row that exists is already right. `skipDuplicates`
    // is what makes that true in one statement rather than a check each.
    if (pending.length > 0) {
      await prisma.conversationMessage.createMany({ data: pending, skipDuplicates: true });
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

export interface WorkspaceEdgeSync {
  results: EdgeSyncResult[];
  /** True when the workspace has no enabled Page matching the request. */
  empty: boolean;
}

/**
 * Refresh every enabled Page in one workspace, or a single named one.
 *
 * A bare loop, and safely so: `syncTargetEdges` is total. It records a failure
 * per *edge* so a Page whose token cannot read the inbox still reports the
 * comments it did fetch, and it records a Page that fails before its edges are
 * reached the same way, so nothing here can throw past the result list. The
 * guarantee lives in one place rather than being re-implemented by each caller,
 * which is how the manual button came to lack what the worker's job had.
 */
export async function syncWorkspaceEdges(options: {
  workspaceId: string;
  targetId?: string;
  since?: Date;
}): Promise<WorkspaceEdgeSync> {
  const targets = await prisma.target.findMany({
    where: {
      workspaceId: options.workspaceId,
      type: TargetType.page,
      enabled: true,
      ...(options.targetId ? { id: options.targetId } : {}),
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  if (targets.length === 0) return { results: [], empty: true };

  const results: EdgeSyncResult[] = [];
  for (const target of targets) {
    results.push(await syncTargetEdges({ targetId: target.id, since: options.since }));
  }

  return { results, empty: false };
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
  const where = {
    target: { workspaceId: options.workspaceId },
    ...(options.targetId ? { targetId: options.targetId } : {}),
  };

  // Grouped in the database rather than counted in JavaScript over whatever
  // rows happened to be fetched. This used to take the five hundred most
  // recent reviews and describe them as the Page's ratings: a client with nine
  // hundred was told it had five hundred, and — worse — shown an average of
  // only the recent ones.
  //
  // A partial sum can only understate, and somebody may notice. A partial
  // average is wrong in either direction with nothing to signal which, and an
  // agency reports that number to the business it belongs to.
  const [byRatingRows, byRecommendation, recent] = await Promise.all([
    prisma.pageReview.groupBy({ by: ['rating'], where, _count: { _all: true } }),
    prisma.pageReview.groupBy({
      by: ['recommendationType'],
      where,
      _count: { _all: true },
    }),
    prisma.pageReview.findMany({
      where,
      orderBy: [{ createdTime: 'desc' }, { id: 'desc' }],
      take: rowCount(options.limit, 20),
    }),
  ]);

  const byRating: Record<string, number> = {};
  let ratedCount = 0;
  let ratingSum = 0;
  let count = 0;

  for (const group of byRatingRows) {
    const rows = group._count._all;
    count += rows;

    // A recommendation with no star rating is still a review, and counts
    // towards the total — it just cannot contribute to an average.
    if (group.rating === null) continue;

    byRating[String(group.rating)] = rows;
    ratedCount += rows;
    ratingSum += group.rating * rows;
  }

  const tally = (type: string): number =>
    byRecommendation.find((group) => group.recommendationType === type)?._count._all ?? 0;

  return {
    count,
    averageRating: ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : null,
    recommends: tally('positive'),
    doesNotRecommend: tally('negative'),
    byRating,
    recent: recent.map((row) => ({
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
  /**
   * Whether a reply would be accepted, worked out here so the screen can say
   * why the box is missing instead of letting somebody type a paragraph and
   * then refusing it.
   *
   * A prediction, not the ruling: `replyToConversationAs` checks again against
   * the whole thread when the reply is actually sent.
   */
  reply: { state: 'open'; until: Date } | { state: 'closed' | 'no_recipient' };
}

/** How many messages back to look; enough for the reply state, more than the screen shows. */
const CONVERSATION_MESSAGES = 25;

export async function readConversations(options: {
  workspaceId: string;
  targetId?: string;
  limit?: number;
  now?: Date;
}): Promise<ConversationRow[]> {
  const rows = await prisma.conversation.findMany({
    where: {
      target: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    include: {
      target: { select: { name: true, providerId: true } },
      messages: { orderBy: { createdTime: 'desc' }, take: CONVERSATION_MESSAGES },
    },
    orderBy: { updatedTime: 'desc' },
    take: options.limit ?? 50,
  });

  const now = options.now ?? new Date();

  return rows.map((row) => {
    const theirLast = row.messages.find(
      (message) => message.fromId !== null && message.fromId !== row.target.providerId,
    );

    const reply: ConversationRow['reply'] = !theirLast
      ? { state: 'no_recipient' }
      : now.getTime() - theirLast.createdTime.getTime() > MESSAGING_WINDOW_MS
        ? { state: 'closed' }
        : { state: 'open', until: new Date(theirLast.createdTime.getTime() + MESSAGING_WINDOW_MS) };

    return {
      id: row.id,
      snippet: row.snippet,
      participants: Array.isArray(row.participants) ? (row.participants as string[]) : [],
      unreadCount: row.unreadCount,
      messageCount: row.messageCount,
      updatedTime: row.updatedTime,
      targetName: row.target.name,
      // The screen shows a thread, not an archive: the newest handful, from the
      // wider slice the reply state needed.
      messages: row.messages.slice(0, 10).map((message) => ({
        id: message.id,
        from: message.fromName ?? 'Unknown',
        message: message.message,
        createdTime: message.createdTime,
      })),
      reply,
    };
  });
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

/**
 * Reply to somebody in the Page's inbox, as the Page.
 *
 * The person's own last message decides two things: who the reply goes to —
 * their page-scoped id, which is the only address Facebook accepts — and
 * whether it may be sent at all. A thread where the last word was the Page's
 * has nobody to answer, and one where the customer wrote two days ago is
 * closed. Both are checked here rather than discovered as a Graph error,
 * because both have a plain explanation and Graph's does not.
 */
export async function replyToConversationAs(options: {
  conversationId: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  message: string;
  now?: Date;
}): Promise<{ outcome: ReplyOutcome; remoteId?: string }> {
  if (!canModerateComments(options.role)) return { outcome: 'forbidden' };

  const conversation = await prisma.conversation.findFirst({
    where: { id: options.conversationId, target: { workspaceId: options.workspaceId } },
    include: { target: { include: { socialAccount: true } } },
  });
  if (!conversation) return { outcome: 'not_found' };

  const token = tokenFor(conversation.target);
  if (!token) return { outcome: 'not_found' };

  const pageId = conversation.target.providerId;

  // Straight at the newest inbound message rather than scanning a slice: a
  // thread the Page has answered several times running would otherwise look
  // like it had nobody in it.
  const theirLast = await prisma.conversationMessage.findFirst({
    where: {
      conversationId: conversation.id,
      fromId: { not: null },
      NOT: { fromId: pageId },
    },
    orderBy: { createdTime: 'desc' },
  });
  if (!theirLast?.fromId) return { outcome: 'no_recipient' };

  const now = options.now ?? new Date();
  if (now.getTime() - theirLast.createdTime.getTime() > MESSAGING_WINDOW_MS) {
    return { outcome: 'outside_window' };
  }

  const remoteId = await sendPageMessage(pageId, token, theirLast.fromId, options.message);

  // Store our own reply immediately rather than waiting for the next sync, so
  // the thread reads correctly the moment the request returns. A send with no
  // id back still gets a row, keyed on the moment, so the reply is not lost
  // from the screen — the next sync reconciles it.
  await prisma.$transaction(async (tx) => {
    await tx.conversationMessage.upsert({
      where: {
        conversationId_remoteId: {
          conversationId: conversation.id,
          remoteId: remoteId || `local-${now.getTime()}`,
        },
      },
      create: {
        conversationId: conversation.id,
        remoteId: remoteId || `local-${now.getTime()}`,
        fromName: conversation.target.name,
        fromId: pageId,
        message: options.message,
        createdTime: now,
      },
      update: {},
    });

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        snippet: options.message.slice(0, 200),
        updatedTime: now,
        messageCount: { increment: 1 },
        // Answered, so nothing in this thread is still waiting to be read.
        unreadCount: 0,
      },
    });
  });

  await logActivity(
    options.workspaceId,
    'conversation.replied',
    { conversationId: conversation.id, targetName: conversation.target.name },
    options.userId,
  );

  return { outcome: 'ok', remoteId };
}
