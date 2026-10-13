import { randomUUID } from 'node:crypto';

import { prisma } from '../prisma';
import type { ActivityAction } from '../activity';
import { env } from '../env';
import { decryptSecret } from '../crypto';
import { parseLinkPreview, parseMedia, toJsonOrNull } from '../json';
import { aspectRangeFor, parseWatermark } from '../image-format';
import { prepareImages } from '../image-variants';
import { resolveMediaForInstagram, resolveMediaForPublish } from '../media';
import { asGraphError, GraphError } from '../facebook/graph';
import { publishPost } from '../facebook/publish';
import { publishToInstagram } from '../facebook/instagram-publish';
import { decideRetry } from './backoff';
import { notifyConnectionExpired, notifyPublishFailure } from '../email/notify';
import { prepareLinks } from '../links';
import { isNetworkKey, publishToNetwork } from '../networks';
import { postFirstComment } from '../first-comment';
import type { PostFormat } from '../facebook/publish';
import {
  PUBLISHABLE_APPROVAL_STATUSES,
  TERMINAL_TARGET_STATUSES,
  PostStatus,
  PostTargetStatus,
} from '../constants';
import { errors } from '../errors';
import { emitWebhook } from '../webhooks';

/**
 * The scheduler.
 *
 * The unit of work is a PostTarget — one destination of one post — not the
 * post itself. That is what makes partial success expressible: publishing to
 * three Pages where one has a revoked token marks that one failed and leaves
 * the other two published, instead of failing all three or, worse, retrying
 * the whole post and double-posting to the two that succeeded.
 *
 * Concurrency safety: claiming is a conditional `updateMany` that only matches
 * rows still in `pending`. That update is atomic, so if two workers race,
 * exactly one sees `count === 1` and the other moves on. Postgres could use
 * `SELECT … FOR UPDATE SKIP LOCKED` instead, but this is simpler and already
 * proven by the integration tests.
 */

export interface TickResult {
  claimed: number;
  published: number;
  failed: number;
  retrying: number;
  reclaimedStale: number;
  /** Interrupted destinations that had run out of attempts and were failed. */
  abandonedStale: number;
  /** Due destinations whose Page was turned off, settled rather than left hanging. */
  skipped: number;
}

export interface TickOptions {
  now?: Date;
  /** Maximum destinations to process in this tick. */
  limit?: number;
  concurrency?: number;
  maxAttempts?: number;
  /** Overrides the configured abandoned-lock timeout, in minutes. */
  staleLockMinutes?: number;
  workerId?: string;
  logger?: (message: string, detail?: unknown) => void;
}

interface ReclaimResult {
  /** Rows handed back to the queue for another go. */
  reclaimed: number;
  /** Rows that had used up their attempts and were given up on. */
  abandoned: number;
}

/**
 * Release rows whose worker died mid-publish.
 *
 * Two risks are traded off here, and the timeout is where the trade sits. Too
 * long and a crash leaves a client's post stuck until the timeout elapses; too
 * short and a destination that is merely *slow* — a large video upload holds
 * one open for minutes — is reclaimed while its first worker is still talking
 * to Facebook, and the post goes out twice. There is no value that is right for
 * every installation, so it is configurable rather than baked in.
 *
 * Note the residual risk the reclaim itself accepts: if the worker crashed
 * *after* Facebook accepted the post but before the row was updated, the retry
 * double-posts. Facebook's own duplicate detection (error 506) catches the
 * common case of identical content, and the alternative — never retrying —
 * silently drops posts, which is worse for a scheduling product.
 *
 * A reclaim spends an attempt. It has to: a payload that kills the worker kills
 * it again next time, and without counting the crash the row is handed back
 * every timeout for ever, taking the worker down with it each round. Counting
 * it means `maxAttempts` still terminates, and the post lands in `failed` where
 * someone can see it instead of looping invisibly.
 */
async function reclaimStaleLocks(
  now: Date,
  maxAttempts: number,
  staleLockMinutes: number,
  logger: TickOptions['logger'],
): Promise<ReclaimResult> {
  const cutoff = new Date(now.getTime() - staleLockMinutes * 60 * 1000);
  const stale = { status: 'processing', lockedAt: { lt: cutoff } } as const;

  // Read first, so the posts whose destinations are given up on can have their
  // headline status recomputed below.
  const exhausted = await prisma.postTarget.findMany({
    where: { ...stale, attempts: { gte: maxAttempts - 1 } },
    select: { id: true, postId: true },
  });

  if (exhausted.length > 0) {
    await prisma.postTarget.updateMany({
      where: { id: { in: exhausted.map((row) => row.id) } },
      data: {
        status: 'failed',
        attempts: { increment: 1 },
        lockedAt: null,
        lockedBy: null,
        errorCode: 'worker_lost',
        errorMessage:
          'Publishing was interrupted and did not recover within the attempt limit. Check the destination and try again.',
      },
    });

    for (const postId of new Set(exhausted.map((row) => row.postId))) {
      await refreshPostStatus(postId, now);
    }
  }

  const { count: reclaimed } = await prisma.postTarget.updateMany({
    where: stale,
    data: {
      status: 'pending',
      attempts: { increment: 1 },
      lockedAt: null,
      lockedBy: null,
    },
  });

  if (reclaimed > 0) logger?.(`Reclaimed ${reclaimed} stale destination lock(s).`);
  if (exhausted.length > 0) {
    logger?.(`Gave up on ${exhausted.length} destination(s) that never recovered.`);
  }

  return { reclaimed, abandoned: exhausted.length };
}

/**
 * Candidate destinations that are due: scheduled time reached, or retry due.
 *
 * Ordered oldest-first *within each client*, then taken round-robin across
 * clients rather than globally. Ordering globally by scheduled time is the
 * obvious thing and it starves people: one workspace that queues five hundred
 * posts for 09:00 fills every slot of every tick until its backlog drains, so a
 * different client's single 09:01 post waits minutes behind work that has
 * nothing to do with them. On a shared installation that is one customer's bulk
 * import delaying another customer's launch.
 *
 * Written as SQL because the fairness *is* the window function: `ROW_NUMBER()
 * PARTITION BY workspace` numbers each client's due work independently, and
 * taking the lowest numbers first interleaves them. Prisma has no way to
 * express that, and doing it in application code would mean fetching the whole
 * backlog to sort it — which is the cost this avoids.
 */
async function findDue(now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM (
      SELECT
        pt.id,
        p."scheduledAt",
        pt."createdAt",
        ROW_NUMBER() OVER (
          PARTITION BY p."workspaceId"
          ORDER BY p."scheduledAt" ASC, pt."createdAt" ASC
        ) AS turn
      FROM "post_targets" pt
      JOIN "posts" p ON p.id = pt."postId"
      JOIN "targets" t ON t.id = pt."targetId"
      JOIN "workspaces" w ON w.id = p."workspaceId"
      WHERE pt.status = 'pending'::"PostTargetStatus"
        AND (pt."nextAttemptAt" IS NULL OR pt."nextAttemptAt" <= ${now})
        AND p.status IN ('scheduled'::"PostStatus", 'publishing'::"PostStatus")
        AND p."scheduledAt" <= ${now}
        -- An unapproved post must never go out, whatever its scheduled time
        -- says. This is the scheduler's half of the approval workflow.
        AND p."approvalStatus" IN (
          'not_required'::"ApprovalStatus",
          'approved'::"ApprovalStatus"
        )
        AND t.enabled = true
        -- Root suspended the client: its posts wait until it is resumed.
        AND w."suspendedAt" IS NULL
    ) ranked
    -- One from each client, then a second from each, and so on. Within a
    -- client the order is still oldest-first, so a backlog drains the way its
    -- owner expects.
    ORDER BY turn ASC, "scheduledAt" ASC, "createdAt" ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => row.id);
}

/** How a destination that was off at publish time is settled, by both paths. */
const SKIPPED_DESTINATION_OFF = {
  status: 'skipped',
  nextAttemptAt: null,
  errorCode: 'destination_off',
  errorMessage: 'This destination was turned off when the post was due, so it was not published there.',
} as const;

/**
 * Settle destinations that are due but point at a Page nobody turned back on.
 *
 * `findDue` filters these out, which keeps the scheduler from publishing to a
 * disabled destination — but filtering alone leaves the row `pending` for ever
 * and the post reading "Scheduled" for ever. The post never goes out, never
 * fails, and never explains itself: the exact silent failure this product is
 * supposed to prevent.
 *
 * `skipped` is the state for it. It was already in the enum, already counted as
 * terminal, and already excluded from the active set when a post's headline
 * status is recomputed — nothing had ever set it. A skipped destination lets
 * the post settle honestly: published to the Pages that were on, skipped on the
 * ones that were off.
 *
 * Only *due* work is settled. A destination turned off a week before its post
 * is due may well be back on by then, and pre-emptively skipping it would
 * decide the outcome early. At the moment publication should happen, the
 * destination genuinely is unavailable, and that is what gets recorded.
 */
async function skipDisabledDestinations(now: Date, logger: TickOptions['logger']): Promise<number> {
  const stranded = await prisma.postTarget.findMany({
    where: {
      status: 'pending',
      target: { enabled: false },
      post: {
        status: { in: ['scheduled', 'publishing'] },
        scheduledAt: { lte: now },
        approvalStatus: { in: [...PUBLISHABLE_APPROVAL_STATUSES] },
      },
    },
    select: { id: true, postId: true },
  });

  if (stranded.length === 0) return 0;

  await prisma.postTarget.updateMany({
    where: { id: { in: stranded.map((row) => row.id) } },
    data: SKIPPED_DESTINATION_OFF,
  });

  for (const postId of new Set(stranded.map((row) => row.postId))) {
    await refreshPostStatus(postId, now);
  }

  logger?.(`Skipped ${stranded.length} destination(s) that were turned off.`);
  return stranded.length;
}

/**
 * The due-work query, exposed for the fairness tests.
 *
 * Claiming a destination mutates it, so a test that went through the whole tick
 * could not then ask what *would* have been picked next. This is the selection
 * on its own.
 */
export function findDueForTest(now: Date, limit: number): Promise<string[]> {
  return findDue(now, limit);
}

/**
 * Try to take ownership of a destination. Returns true only for the worker
 * that won the race.
 */
async function claim(postTargetId: string, workerId: string, now: Date): Promise<boolean> {
  const { count } = await prisma.postTarget.updateMany({
    where: { id: postTargetId, status: 'pending' },
    data: { status: 'processing', lockedAt: now, lockedBy: workerId },
  });
  return count === 1;
}

type PublishOutcome = 'published' | 'failed' | 'retrying';

/**
 * Write a result, but only while we still hold the lock.
 *
 * `staleLockMinutes` can hand a destination to a second worker while the
 * first is still talking to Facebook — that is what the timeout is for, and a
 * slow upload triggers it without anything having gone wrong. The first worker
 * then comes back with a result for a row somebody else owns.
 *
 * Writing it anyway is worse than losing it. On success it replaces the second
 * worker's claim with `published`, so the post it is still publishing has no
 * lock and no record. On failure it writes `pending` with the lock cleared,
 * which frees a destination that is *actively being published* — a third
 * worker claims it and sends the post again. One reclaimed lock becomes an
 * unbounded number of posts.
 *
 * Returns false when the lock was lost, so the caller can say so out loud.
 */
async function writeIfStillOurs(
  postTargetId: string,
  workerId: string,
  data: Parameters<typeof prisma.postTarget.updateMany>[0]['data'],
): Promise<boolean> {
  const { count } = await prisma.postTarget.updateMany({
    where: { id: postTargetId, lockedBy: workerId },
    data,
  });
  return count === 1;
}

async function publishClaimed(
  postTargetId: string,
  options: { now: Date; maxAttempts: number; workerId: string; logger: TickOptions['logger'] },
): Promise<PublishOutcome> {
  const row = await prisma.postTarget.findUnique({
    where: { id: postTargetId },
    include: {
      post: { include: { workspace: true } },
      target: { include: { socialAccount: true } },
    },
  });

  if (!row) return 'failed';

  const attempts = row.attempts + 1;
  const { post, target } = row;

  try {
    // Pages publish with their own page token; Groups fall back to the
    // connected user's token, which is the only credential that works there.
    const encryptedToken = target.accessToken ?? target.socialAccount?.accessToken ?? null;
    if (!encryptedToken) {
      throw new GraphError({
        message: 'No access token is stored for this destination. Reconnect the account.',
        kind: 'auth',
      });
    }

    if (target.socialAccount?.invalidatedAt) {
      throw new GraphError({
        message:
          target.socialAccount.invalidReason ??
          'The Facebook connection for this destination needs to be renewed.',
        kind: 'auth',
      });
    }

    const isInstagram = target.type === 'instagram';
    // Cropped to the shape this destination takes and stamped with the Page's
    // watermark (G13); the originals stay as they are.
    const attachments = await prepareImages({
      workspaceId: post.workspaceId,
      media: parseMedia(post.media),
      range: aspectRangeFor(target.type, post.format),
      watermark: parseWatermark(target.watermark),
    });

    // UTM tags and shortening are applied per destination, so a campaign can
    // be attributed to the Page it actually ran on.
    const prepared = await prepareLinks({
      workspaceId: post.workspaceId,
      postId: post.id,
      message: row.messageOverride ?? post.message,
      link: post.link,
      settings: {
        // A Page's own tags win over the workspace's, one by one.
        utmSource: target.utmSource ?? post.workspace.utmSource,
        utmMedium: target.utmMedium ?? post.workspace.utmMedium,
        utmCampaignTemplate: target.utmCampaign ?? post.workspace.utmCampaignTemplate,
        shortenerEnabled: post.workspace.shortenerEnabled,
      },
      targetName: target.name,
      targetId: target.id,
    });

    const network = isNetworkKey(target.type) ? target.type : null;
    if (network && !target.socialAccount) {
      throw new GraphError({ message: 'This account is no longer connected. Reconnect it.', kind: 'auth' });
    }
    const result = network
      ? await publishToNetwork({
          key: network,
          target: { providerId: target.providerId, name: target.name },
          account: target.socialAccount!,
          text: prepared.message,
          link: prepared.link,
          media: attachments,
          linkPreview: (() => {
            const card = parseLinkPreview(post.linkPreview);
            return card ? { title: card.title, description: card.description, image: card.imageUrl } : null;
          })(),
          idempotencyKey: postTargetId,
        })
      : isInstagram
      ? await publishToInstagram({
          igUserId: target.providerId,
          accessToken: decryptSecret(encryptedToken),
          // Instagram captions carry no clickable link, so a shortened URL in
          // one is a string somebody has to type. The prepared link is appended
          // anyway when there is one — it is what the post is about — but the
          // caption is where it lands rather than a link preview.
          caption: prepared.link
            ? `${prepared.message}\n\n${prepared.link}`.trim()
            : prepared.message,
          media: await resolveMediaForInstagram(attachments),
        })
      : await publishPost({
          targetType: target.type,
          targetId: target.providerId,
          accessToken: decryptSecret(encryptedToken),
          message: prepared.message,
          link: prepared.link,
          media: await resolveMediaForPublish(attachments),
          // The worker publishes at the scheduled moment, so it never asks
          // Facebook to hold the post as well — native scheduling is handed
          // over at creation time instead (see src/lib/posts.ts).
          scheduledPublishTime: null,
          format: post.format as PostFormat,
        });

    const kept = await writeIfStillOurs(postTargetId, options.workerId, {
      status: 'published',
      remotePostId: result.remotePostId,
      remoteUrl: result.remoteUrl,
      publishedAt: options.now,
      attempts,
      errorCode: null,
      errorMessage: null,
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
    });

    if (!kept) {
      // The post is live on Facebook and nothing in our database points at it.
      // Log the permalink loudly: it is the only way anyone finds the orphan,
      // and the worker that now owns the row is probably about to publish a
      // second copy.
      options.logger?.(
        `Published post ${post.id} to ${target.name} after losing the lock — the destination was reclaimed mid-publish and this copy is not recorded.`,
        { url: result.remoteUrl, remotePostId: result.remotePostId, orphaned: true },
      );
      return 'published';
    }

    options.logger?.(`Published post ${post.id} to ${target.name}.`, { url: result.remoteUrl });
    await emitWebhook(post.workspaceId, 'post.published', {
      postId: post.id,
      pageId: target.id,
      pageName: target.name,
      network: target.type,
      url: result.remoteUrl ?? null,
      publishedAt: options.now.toISOString(),
    }, options.now);

    // Only once the publish is recorded, and never able to throw: a refused
    // comment is noted on the destination for a retry, and the post stays
    // published rather than coming back here to be sent a second time.
    // A Story takes no comments, so there is nothing to put under it.
    // Other networks have no "comment as the Page": the first comment is Facebook's.
    if (post.firstComment?.trim() && post.format !== 'story' && !network) {
      const comment = await postFirstComment(postTargetId, options.now);
      if (comment === 'failed') {
        options.logger?.(`Published post ${post.id} to ${target.name}, but its first comment was refused.`);
      }
    }
    return 'published';
  } catch (error) {
    const graphError = asGraphError(error);
    const decision = decideRetry({
      kind: graphError.kind,
      attempts,
      maxAttempts: options.maxAttempts,
      now: options.now,
    });

    const kept = await writeIfStillOurs(postTargetId, options.workerId, {
      status: decision.shouldRetry ? 'pending' : 'failed',
      attempts,
      nextAttemptAt: decision.nextAttemptAt,
      errorCode: graphError.code ? String(graphError.code) : graphError.kind,
      errorMessage: `${graphError.displayMessage} ${decision.reason}`.trim(),
      lockedAt: null,
      lockedBy: null,
    });

    if (!kept) {
      // Leave the row alone — another worker is publishing it and will write
      // its own result. Our failure says nothing about their attempt.
      options.logger?.(
        `Failed to publish post ${post.id} to ${target.name}, but the destination had already been reclaimed — leaving it to the worker that holds it.`,
        { kind: graphError.kind, attempts },
      );
      return 'failed';
    }

    // A dead token affects every destination on the account, so flag it once
    // here rather than letting each scheduled post rediscover it — and tell
    // someone, since otherwise this is only noticed when a client asks why
    // nothing has posted.
    if (graphError.invalidatesToken && target.socialAccountId && !target.socialAccount?.invalidatedAt) {
      await prisma.socialAccount.update({
        where: { id: target.socialAccountId },
        data: { invalidatedAt: options.now, invalidReason: graphError.displayMessage },
      });
      await notifyConnectionExpired({
        workspaceId: post.workspaceId,
        accountName: target.socialAccount?.name ?? target.name,
      });
      await emitWebhook(post.workspaceId, 'page.disconnected', {
        accountName: target.socialAccount?.name ?? target.name,
        pageId: target.id,
        pageName: target.name,
        reason: graphError.displayMessage,
      }, options.now);
    }

    // Only alert once the post has actually given up. Emailing on every
    // interim retry would train people to ignore these.
    if (!decision.shouldRetry) {
      await notifyPublishFailure({
        workspaceId: post.workspaceId,
        targetId: target.id,
        targetName: target.name,
        reason: graphError.displayMessage,
        scheduledAt: post.scheduledAt,
        postId: post.id,
      });
      await emitWebhook(post.workspaceId, 'post.failed', {
        postId: post.id,
        pageId: target.id,
        pageName: target.name,
        network: target.type,
        reason: graphError.displayMessage,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
      }, options.now);
    }

    options.logger?.(
      `Failed to publish post ${post.id} to ${target.name}: ${graphError.displayMessage}`,
      { kind: graphError.kind, attempts, willRetry: decision.shouldRetry },
    );
    return decision.shouldRetry ? 'retrying' : 'failed';
  }
}

/**
 * Recompute a post's status from its destinations, so the UI can show one
 * headline state per post.
 *
 * Serialised per post with an advisory lock, because the status is *derived*:
 * read every destination, work out one word, write it back. Two workers reach
 * here at once in the ordinary multi-worker case — they claim different
 * destinations of the same post and each refreshes it at the end of its tick —
 * and interleaved, the one that read first can write last, leaving its stale
 * snapshot on the row.
 *
 * Nothing corrects that afterwards. A refresh only happens when there is
 * publishing activity, and by then there is none left, so the post is stuck
 * reading `scheduled` or `publishing` with every destination long finished. It
 * never shows as published, and `postEditBlocker` refuses to edit a publishing
 * post, so it cannot be edited either.
 */
export async function refreshPostStatus(postId: string, now: Date = new Date()): Promise<PostStatus> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${postId}))`;

    const targets = await tx.postTarget.findMany({
      where: { postId },
      select: { status: true, publishedAt: true },
    });

    const skipped = targets.filter((target) => target.status === 'skipped');
    const active = targets.filter((target) => target.status !== 'cancelled' && target.status !== 'skipped');
    const published = active.filter((target) => target.status === 'published');
    const remoteScheduled = active.filter((target) => target.status === 'scheduled_remote');
    const failed = active.filter((target) => target.status === 'failed');
    const settled = active.filter((target) =>
      (TERMINAL_TARGET_STATUSES as readonly string[]).includes(target.status),
    );

    let status: PostStatus;
    if (active.length === 0) {
      // Nothing left to do. "Cancelled" is only honest when a person cancelled
      // it: a post every one of whose destinations was skipped was not cancelled
      // by anyone, it simply never went anywhere, and calling that cancelled
      // sends the reader looking for a colleague who did it.
      status = skipped.length > 0 ? 'failed' : 'cancelled';
    } else if (settled.length < active.length) {
      // Still working: some destinations are pending or in flight.
      status = published.length > 0 || failed.length > 0 ? 'publishing' : 'scheduled';
    } else if (failed.length === active.length) {
      status = 'failed';
    } else if (failed.length > 0) {
      status = 'partially_failed';
    } else if (published.length === 0 && remoteScheduled.length > 0) {
      // Everything is queued inside Facebook and nothing has gone live yet.
      status = 'scheduled';
    } else {
      status = 'published';
    }

    const publishedAt =
      published.length > 0
        ? published
            .map((target) => target.publishedAt)
            .filter((date): date is Date => Boolean(date))
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? now
        : null;

    await tx.post.update({
      where: { id: postId },
      data: { status, publishedAt },
    });

    return status;
  });
}

/** Run a bounded number of tasks at a time. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * One pass of the scheduler. Safe to call from a long-running worker, a cron
 * endpoint, or a test — it holds no state between calls.
 */
export async function runSchedulerTick(options: TickOptions = {}): Promise<TickResult> {
  const now = options.now ?? new Date();
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const concurrency = options.concurrency ?? env.concurrency;
  const maxAttempts = options.maxAttempts ?? env.maxAttempts;
  const limit = options.limit ?? concurrency * 10;
  const staleLockMinutes = options.staleLockMinutes ?? env.staleLockMinutes;
  const logger = options.logger;

  const stale = await reclaimStaleLocks(now, maxAttempts, staleLockMinutes, logger);
  const skipped = await skipDisabledDestinations(now, logger);
  const idle = {
    claimed: 0,
    published: 0,
    failed: 0,
    retrying: 0,
    reclaimedStale: stale.reclaimed,
    abandonedStale: stale.abandoned,
    skipped,
  };

  const candidates = await findDue(now, limit);
  if (candidates.length === 0) return idle;

  const claimed: string[] = [];
  for (const id of candidates) {
    if (await claim(id, workerId, now)) claimed.push(id);
  }
  if (claimed.length === 0) return idle;

  // Mark parent posts as in-flight so the UI stops offering "edit" on
  // something that is already going out.
  const postIds = await prisma.postTarget.findMany({
    where: { id: { in: claimed } },
    select: { postId: true },
    distinct: ['postId'],
  });
  await prisma.post.updateMany({
    where: { id: { in: postIds.map((row) => row.postId) }, status: 'scheduled' },
    data: { status: 'publishing' },
  });

  const outcomes = await runWithConcurrency(claimed, concurrency, (id) =>
    publishClaimed(id, { now, maxAttempts, workerId, logger }),
  );

  for (const { postId } of postIds) {
    await refreshPostStatus(postId, now);
  }

  return {
    claimed: claimed.length,
    published: outcomes.filter((outcome) => outcome === 'published').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    retrying: outcomes.filter((outcome) => outcome === 'retrying').length,
    reclaimedStale: stale.reclaimed,
    abandonedStale: stale.abandoned,
    skipped,
  };
}

/**
 * Publish one post immediately, bypassing the schedule. Backs the "Post now"
 * button and the manual retry action.
 */
export async function publishNow(postId: string, logger?: TickOptions['logger']): Promise<TickResult> {
  const now = new Date();

  // The same approval gate the scheduler applies, and it has to be here rather
  // than only in the route: "Post now" is the one path that publishes without
  // ever going through `findDue`, so a post held for review would otherwise go
  // out the moment its author pressed the button — which is precisely what the
  // review queue exists to prevent.
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: { approvalStatus: true },
  });
  if (!PUBLISHABLE_APPROVAL_STATUSES.includes(post.approvalStatus)) {
    throw errors.awaitingApproval();
  }

  await prisma.post.update({
    where: { id: postId },
    data: { status: 'publishing', scheduledAt: now },
  });
  // Clear any pending backoff so every destination is due right now. Attempts
  // go back to zero too: this is a person asking for a fresh try, and a row that
  // failed on its last allowed attempt would otherwise be failed again by the
  // very first transient error, with no retry at all.
  //
  // A Facebook-held post that was never confirmed is left alone: it most
  // likely did go out, and publishing it again would put it on the Page twice.
  // (The OR is spelled out because `not` alone also excludes NULL.)
  await prisma.postTarget.updateMany({
    where: {
      postId,
      status: { in: ['pending', 'failed'] },
      OR: [{ errorCode: null }, { errorCode: { not: 'unconfirmed_on_facebook' } }],
    },
    data: { status: 'pending', nextAttemptAt: null, attempts: 0 },
  });

  // A destination that is turned off is settled the way the scheduler settles
  // it (see skipDisabledDestinations) rather than published to: "Post now" must
  // not be the one path that ignores the switch.
  const { count: skipped } = await prisma.postTarget.updateMany({
    where: { postId, status: 'pending', target: { enabled: false } },
    data: SKIPPED_DESTINATION_OFF,
  });
  if (skipped > 0) logger?.(`Skipped ${skipped} destination(s) that were turned off.`);

  const rows = await prisma.postTarget.findMany({
    where: { postId, status: 'pending', target: { enabled: true } },
    select: { id: true },
  });

  const workerId = `inline-${randomUUID().slice(0, 8)}`;
  const claimed: string[] = [];
  for (const row of rows) {
    if (await claim(row.id, workerId, now)) claimed.push(row.id);
  }

  const outcomes = await runWithConcurrency(claimed, env.concurrency, (id) =>
    publishClaimed(id, { now, maxAttempts: env.maxAttempts, workerId, logger }),
  );

  await refreshPostStatus(postId, now);

  return {
    claimed: claimed.length,
    published: outcomes.filter((outcome) => outcome === 'published').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    retrying: outcomes.filter((outcome) => outcome === 'retrying').length,
    reclaimedStale: 0,
    abandonedStale: 0,
    skipped,
  };
}

/** Record an audit entry. Never throws — logging must not break a publish. */
export async function logActivity(
  workspaceId: string,
  action: ActivityAction,
  detail?: unknown,
  actorId?: string,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId,
        actorId: actorId ?? null,
        action,
        detail: toJsonOrNull(detail),
      },
    });
  } catch (error) {
    console.error('[activity] failed to write log entry', error);
  }
}
