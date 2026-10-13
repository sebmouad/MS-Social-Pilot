import { Prisma, TargetType, type WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { canDeleteComments, canModerateComments } from './constants';
import { decryptSecret } from './crypto';
import { parseInsights, toJson, toJsonOrNull } from './json';
import { asGraphError, isMissingObject, pageRatingsAvailable } from './facebook/graph';
import { fetchInsights } from './facebook/analytics';
import { logActivity } from './scheduler/runner';
import { applyModerationRules } from './moderation';
import { emitWebhook } from './webhooks';
import { syncExternalPostInsights } from './analytics';
import { readNetworkReplies } from './networks';
import { NETWORK_KEYS, isNetworkKey, type NetworkKey } from './networks/types';
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

export function tokenFor(target: {
  accessToken: string | null;
  socialAccount: { accessToken: string } | null;
}): string | null {
  const encrypted = target.accessToken ?? target.socialAccount?.accessToken ?? null;
  return encrypted ? decryptSecret(encrypted) : null;
}

/**
 * How many writes go to the database in one transaction.
 *
 * One transaction per chunk rather than per row saves a commit — and its
 * fsync — for every row. Bounded rather than all-at-once so a Page with
 * thousands of changed rows does not hold one transaction open for all of
 * them.
 */
const WRITE_CHUNK = 100;

function chunks<T>(items: T[], size = WRITE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
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
/**
 * Facebook says this post is gone — deleted, or binned, on Facebook. Noted so
 * the comment and analytics syncs stop spending a call on it every pass.
 */
export async function markRemoteMissing(postTargetId: string, now: Date = new Date()): Promise<void> {
  await prisma.postTarget.updateMany({
    where: { id: postTargetId, remoteMissingAt: null },
    data: { remoteMissingAt: now },
  });
}

/**
 * Replies to posts on other networks (Bluesky, Mastodon…), for the inbox.
 *
 * The Facebook pass walks Pages; these destinations are not Pages, so they get
 * their own walk over recent published posts. One failing post does not stop
 * the rest.
 */
export async function syncNetworkReplies(): Promise<{ comments: number; failed: number }> {
  const posts = await prisma.postTarget.findMany({
    where: {
      status: 'published',
      remotePostId: { not: null },
      remoteMissingAt: null,
      target: { enabled: true, type: { in: NETWORK_KEYS as unknown as TargetType[] } },
    },
    orderBy: { publishedAt: 'desc' },
    take: env.commentPostLimit * 4,
    select: { id: true },
  });
  let comments = 0;
  let failed = 0;
  for (const post of posts) {
    try {
      comments += await syncCommentsFor(post.id);
    } catch {
      failed += 1;
    }
  }
  return { comments, failed };
}

/** How old a newly read comment can be and still be sent to webhooks. */
const COMMENT_WEBHOOK_MAX_AGE_MS = 48 * 3_600_000;

export async function syncCommentsFor(postTargetId: string): Promise<number> {
  const row = await prisma.postTarget.findUniqueOrThrow({
    where: { id: postTargetId },
    include: { target: { include: { socialAccount: true } } },
  });

  if (!row.remotePostId) return 0;
  // Another network: its replies, read whole (threads there are small).
  const network = isNetworkKey(row.target.type);
  const token = network ? null : tokenFor(row.target);
  if (!network && !token) return 0;

  const newest = await prisma.postComment.findFirst({
    where: { postTargetId },
    orderBy: { createdTime: 'desc' },
    select: { createdTime: true },
  });

  const comments = network
    ? row.target.socialAccount
      ? (await readNetworkReplies(row.target.type as NetworkKey, row.target.socialAccount, row.remotePostId)) ?? []
      : []
    : await fetchComments(row.remotePostId, token!, {
        // Nothing stored yet means a first sync, which reads the history it can.
        since: newest ? new Date(newest.createdTime.getTime() - COMMENT_SYNC_OVERLAP_MS) : undefined,
      });

  if (comments.length === 0) return 0;

  // Batched the way reviews are: one read to learn what is already held, one
  // insert for what is new, and writes only for rows that actually changed.
  // The day of overlap above means most of every sync is comments we already
  // have, and a round trip each for those was the bulk of a sync's time.
  const remoteIds = comments.map((comment) => comment.remoteId);
  const existing = await prisma.postComment.findMany({
    where: { postTargetId, remoteId: { in: remoteIds } },
    select: {
      remoteId: true,
      message: true,
      fromName: true,
      fromId: true,
      likeCount: true,
      replyCount: true,
      isHidden: true,
    },
  });
  const before = new Map(existing.map((row) => [row.remoteId, row]));

  const fresh = comments.filter((comment) => !before.has(comment.remoteId));
  if (fresh.length > 0) {
    await prisma.postComment.createMany({
      data: fresh.map((comment) => ({
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
      })),
      // Facebook can list a comment twice across two pages of one walk.
      skipDuplicates: true,
    });
    // New comments, once each, through the workspace's moderation rules (G7).
    await applyModerationRules(postTargetId, fresh);
    // People's comments only, and only recent ones: a Page's first sync reads
    // its history, which is not news to anyone's Zap.
    const now = Date.now();
    for (const comment of fresh) {
      if (comment.fromId === row.target.providerId || now - comment.createdTime.getTime() > COMMENT_WEBHOOK_MAX_AGE_MS) continue;
      await emitWebhook(row.target.workspaceId, 'comment.received', {
        commentId: comment.remoteId,
        parentCommentId: comment.parentRemoteId ?? null,
        postId: row.postId,
        pageId: row.target.id,
        pageName: row.target.name,
        from: comment.fromName ?? null,
        message: comment.message,
        createdAt: comment.createdTime.toISOString(),
      });
    }
  }

  // Counts and hidden state change after the fact; the text does not, but
  // Facebook does allow editing, so it is refreshed too. The author is
  // refreshed because a reply this app sent is stored before Facebook has
  // said who it was from, and "answered" depends on knowing that. An author
  // Facebook withholds does not erase one we already know.
  const changed = comments.flatMap((comment) => {
    const previous = before.get(comment.remoteId);
    if (!previous) return [];

    const next = {
      message: comment.message,
      fromName: comment.fromName ?? previous.fromName,
      fromId: comment.fromId ?? previous.fromId,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
      isHidden: comment.isHidden,
    };
    const same = (Object.keys(next) as Array<keyof typeof next>).every(
      (key) => next[key] === previous[key],
    );
    return same ? [] : [{ remoteId: comment.remoteId, data: next }];
  });

  for (const chunk of chunks(changed)) {
    await prisma.$transaction(
      chunk.map(({ remoteId, data }) =>
        prisma.postComment.update({
          where: { postTargetId_remoteId: { postTargetId, remoteId } },
          data,
        }),
      ),
    );
  }

  // Still moves for every comment seen, so it keeps meaning "when we last had
  // this from Facebook" rather than "when it last changed".
  await prisma.postComment.updateMany({
    where: { postTargetId, remoteId: { in: remoteIds } },
    data: { fetchedAt: new Date() },
  });

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
  /** Written by the Page itself: Facebook labels these "Author". */
  fromPage?: boolean;
  targetPictureUrl?: string | null;
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

export interface CommentFilter {
  workspaceId: string;
  targetId?: string;
  hidden?: boolean;
  search?: string;
  /**
   * Only top-level comments the Page has not replied to — the moderation
   * to-do list. A comment the Page wrote itself is not waiting on anybody.
   */
  unanswered?: boolean;
}

/** `%` and `_` in somebody's search are the characters, not wildcards. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * The FROM and WHERE every comment query shares.
 *
 * Written once so the count and the page cannot disagree: a count taken over
 * different criteria than the rows gives a pager that offers a page with
 * nothing on it.
 *
 * Scoped through the post's workspace rather than by comment: a comment has no
 * workspace of its own, and joining through the post is what keeps one client's
 * inbox out of another's.
 *
 * SQL rather than a Prisma filter because "answered" compares a reply's author
 * with its Page's id — two columns on two tables — and Prisma's filters only
 * compare a column with a value.
 */
function commentFrom(options: CommentFilter, join: { withParent?: boolean } = {}): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`p."workspaceId" = ${options.workspaceId}`];

  if (options.targetId) conditions.push(Prisma.sql`pt."targetId" = ${options.targetId}`);
  if (options.hidden !== undefined) conditions.push(Prisma.sql`c."isHidden" = ${options.hidden}`);
  if (options.search) {
    conditions.push(Prisma.sql`c."message" ILIKE ${likePattern(options.search)} ESCAPE '\\'`);
  }
  if (options.unanswered) {
    conditions.push(Prisma.sql`c."parentRemoteId" IS NULL`);
    conditions.push(Prisma.sql`c."fromId" IS DISTINCT FROM t."providerId"`);
    conditions.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "post_comments" r
      WHERE r."postTargetId" = c."postTargetId"
        AND r."parentRemoteId" = c."remoteId"
        AND r."fromId" = t."providerId"
    )`);
  }

  return Prisma.sql`
    FROM "post_comments" c
    JOIN "post_targets" pt ON pt."id" = c."postTargetId"
    JOIN "posts" p ON p."id" = pt."postId"
    JOIN "targets" t ON t."id" = pt."targetId"
    ${
      // A reply's parent and grandparent, for ordering by thread: Facebook
      // nests one level, but a reply sent to a reply from here is stored
      // under that reply. At most one row matches each — (postTargetId,
      // remoteId) is unique — so neither can change a count.
      join.withParent
        ? Prisma.sql`
            LEFT JOIN "post_comments" parent
              ON parent."postTargetId" = c."postTargetId" AND parent."remoteId" = c."parentRemoteId"
            LEFT JOIN "post_comments" grand
              ON grand."postTargetId" = c."postTargetId" AND grand."remoteId" = parent."parentRemoteId"`
        : Prisma.empty
    }
    WHERE ${Prisma.join(conditions, ' AND ')}
  `;
}

export async function countComments(options: CommentFilter): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS "count" ${commentFrom(options)}
  `;
  return Number(row?.count ?? 0);
}

/**
 * The workspace's comment stream, newest conversation first.
 *
 * Ordered by thread: each top-level comment is followed by its replies, oldest
 * reply first, so an indented reply sits under the comment it answers rather
 * than wherever its own timestamp puts it. Threads are ordered by when their
 * top-level comment was written, so a late reply does not drag a week-old
 * thread to the top of the list.
 *
 * The order is total — every key ends in a unique id — so paging it with
 * skip and take visits every comment exactly once. A thread can still break
 * across two pages; that is the price of pages of a fixed size, and the
 * reply's indentation says where it belongs.
 */
export async function readComments(
  options: CommentFilter & { limit?: number; skip?: number },
): Promise<CommentRow[]> {
  const skip = Math.max(0, Math.trunc(options.skip ?? 0)) || 0;

  const ordered = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c."id"
    ${commentFrom(options, { withParent: true })}
    ORDER BY
      COALESCE(grand."createdTime", parent."createdTime", c."createdTime") DESC,
      COALESCE(grand."id", parent."id", c."id") DESC,
      (c."parentRemoteId" IS NOT NULL) ASC,
      c."createdTime" ASC,
      c."id" ASC
    LIMIT ${rowCount(options.limit, 100)} OFFSET ${skip}
  `;

  if (ordered.length === 0) return [];

  const rows = await prisma.postComment.findMany({
    where: { id: { in: ordered.map((row) => row.id) } },
    include: {
      postTarget: {
        select: {
          id: true,
          target: { select: { name: true, providerId: true, pictureUrl: true } },
          post: { select: { message: true } },
        },
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return ordered.flatMap(({ id }) => {
    const row = byId.get(id);
    // Deleted between the two reads; the next page load will agree.
    return row ? [row] : [];
  }).map((row) => ({
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
    fromPage: row.fromId !== null && row.fromId === row.postTarget.target.providerId,
    targetPictureUrl: row.postTarget.target.pictureUrl,
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
  // Replies read from another network: no Facebook action applies, and its
  // stored credential must never be sent to Graph.
  if (isNetworkKey(comment.postTarget.target.type)) return null;
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
  // the thread reads correctly the moment the request returns. Written as the
  // Page, because it was: without an author the comment it answers would still
  // count as unanswered until the next sync said otherwise.
  await prisma.postComment.upsert({
    where: {
      postTargetId_remoteId: { postTargetId: found.comment.postTargetId, remoteId },
    },
    create: {
      postTargetId: found.comment.postTargetId,
      remoteId,
      parentRemoteId: found.comment.remoteId,
      message: options.message,
      fromName: found.comment.postTarget.target.name,
      fromId: found.comment.postTarget.target.providerId,
      createdTime: new Date(),
      sentById: options.userId,
    },
    update: { message: options.message, sentById: options.userId },
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
/** The parts of a Page a sync can read, each on its own. */
export const EDGE_NAMES = ['comments', 'reviews', 'conversations', 'externalPosts', 'videos'] as const;
export type EdgeName = (typeof EDGE_NAMES)[number];

export async function syncTargetEdges(options: {
  targetId: string;
  since?: Date;
  now?: Date;
  /**
   * Only these, when a screen asks for what it shows. A whole pass reads the
   * inbox, every post's comments, videos and the Page's own posts: a minute
   * or more, longer than the proxy waits for a button press, and calls the
   * scheduler needs. The worker leaves it out and reads everything.
   */
  edges?: readonly EdgeName[];
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
  const attempt = async (edge: EdgeName, run: () => Promise<number>): Promise<void> => {
    if (options.edges && !options.edges.includes(edge)) return;
    try {
      const count = await run();
      result[edge as 'comments'] = count;
    } catch (error) {
      result.errors.push({ edge, message: asGraphError(error).displayMessage });
    }
  };

  await attempt('comments', async () => {
    const posts = await prisma.postTarget.findMany({
      where: { targetId: target.id, status: 'published', remotePostId: { not: null }, remoteMissingAt: null },
      orderBy: { publishedAt: 'desc' },
      take: env.commentPostLimit,
      select: { id: true },
    });

    // Post by post: one post deleted on Facebook used to end the pass at
    // that post, every pass, and no other post's comments were ever read.
    let total = 0;
    let failure: unknown = null;
    for (const post of posts) {
      try {
        total += await syncCommentsFor(post.id);
      } catch (error) {
        if (isMissingObject(error)) {
          await markRemoteMissing(post.id);
          continue;
        }
        failure ??= error;
        // The app is over its allowance: every further call would be refused.
        if (asGraphError(error).code === 4) break;
      }
    }
    if (failure && total === 0) throw failure;
    if (failure) result.errors.push({ edge: 'comments', message: asGraphError(failure).displayMessage });
    return total;
  });

  await attempt('reviews', async () => {
    // Retired by Meta from v22.0: asking would only record the same error on
    // every pass. What was stored before stays readable.
    if (!pageRatingsAvailable(env.graphVersion)) return 0;

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

    // The threads themselves in chunked transactions rather than a commit
    // each. Upserts still, not an insert-and-diff like comments: a thread's
    // snippet and counts move every time anybody writes in it, so nearly every
    // row seen has changed and a diff would save nothing.
    for (const chunk of chunks(conversations)) {
      const stored = await prisma.$transaction(
        chunk.map((conversation) =>
          prisma.conversation.upsert({
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
            select: { id: true },
          }),
        ),
      );

      // An array transaction answers in the order it was asked.
      chunk.forEach((conversation, index) => {
        for (const message of conversation.messages) {
          pending.push({ conversationId: stored[index]!.id, ...message });
        }
      });
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

    // A thread marked done opens again when the other person writes after it.
    await prisma.$executeRaw`
      UPDATE "conversations" c SET "resolvedAt" = NULL
      WHERE c."targetId" = ${target.id} AND c."resolvedAt" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "conversation_messages" m
          WHERE m."conversationId" = c."id" AND m."createdTime" > c."resolvedAt"
            AND m."fromId" IS DISTINCT FROM ${target.providerId}
        )
    `;

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

    // Stored in chunked transactions first, so the rows are all there even if
    // the insights reads below are slow or fail part way.
    const stored: Array<{ id: string }> = [];
    for (const chunk of chunks(external)) {
      stored.push(
        ...(await prisma.$transaction(
          chunk.map((post) =>
            prisma.externalPost.upsert({
              where: { targetId_remoteId: { targetId: target.id, remoteId: post.remoteId } },
              create: { targetId: target.id, ...post },
              update: { message: post.message, permalink: post.permalink, pictureUrl: post.pictureUrl, fetchedAt: new Date() },
              select: { id: true },
            }),
          ),
        )),
      );
    }

    // The same catalogue we read for our own posts. Without it this list can
    // say a colleague posted from the Facebook app but not whether anyone saw
    // it, and the Page-level totals stay wrong.
    for (const row of stored) await syncExternalPostInsights(row.id);

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
  edges?: readonly EdgeName[];
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
    results.push(await syncTargetEdges({ targetId: target.id, since: options.since, edges: options.edges }));
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
  messages: Array<{ id: string; from: string; fromPage: boolean; message: string | null; createdTime: Date }>;
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

/** Shared by the count and the page, for the same reason as `commentFrom`. */
function conversationWhere(options: { workspaceId: string; targetId?: string }) {
  return {
    target: { workspaceId: options.workspaceId },
    ...(options.targetId ? { targetId: options.targetId } : {}),
  };
}

/** How many inbox threads there are, so the screen can page past the first fifty. */
export async function countConversations(options: {
  workspaceId: string;
  targetId?: string;
}): Promise<number> {
  return prisma.conversation.count({ where: conversationWhere(options) });
}

export async function readConversations(options: {
  workspaceId: string;
  targetId?: string;
  limit?: number;
  /** Threads to pass over, for the pages after the first. */
  skip?: number;
  now?: Date;
}): Promise<ConversationRow[]> {
  const rows = await prisma.conversation.findMany({
    where: conversationWhere(options),
    include: {
      target: { select: { name: true, providerId: true } },
      messages: { orderBy: { createdTime: 'desc' }, take: CONVERSATION_MESSAGES },
    },
    // `id` last, as for comments: threads sharing a timestamp would otherwise
    // repeat or vanish across pages.
    orderBy: [{ updatedTime: 'desc' }, { id: 'desc' }],
    skip: Math.max(0, Math.trunc(options.skip ?? 0)) || 0,
    take: rowCount(options.limit, 50),
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
        /** Sent by the Page itself: drawn on the right, as Messenger does. */
        fromPage: message.fromId !== null && message.fromId === row.target.providerId,
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
  targetPictureUrl: string | null;
  /** The picture Facebook shows with it. */
  pictureUrl: string | null;
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
  /** Several Pages at once (the shared selection); ignored when `targetId` is given. */
  targetIds?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<ExternalPostRow[]> {
  const rows = await prisma.externalPost.findMany({
    where: {
      target: { workspaceId: options.workspaceId },
      ...(options.targetId ? { targetId: options.targetId } : options.targetIds ? { targetId: { in: options.targetIds } } : {}),
      ...(options.from || options.to
        ? { createdTime: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
    },
    include: { target: { select: { name: true, pictureUrl: true } } },
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
      targetPictureUrl: row.target.pictureUrl,
      pictureUrl: row.pictureUrl,
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
        sentById: options.userId,
      },
      update: { sentById: options.userId },
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
