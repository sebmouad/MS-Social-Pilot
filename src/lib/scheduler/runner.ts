import { randomUUID } from 'node:crypto';

import { prisma } from '../prisma';
import { env } from '../env';
import { decryptSecret } from '../crypto';
import { parseMedia, toJsonOrNull } from '../json';
import { resolveMediaForPublish } from '../media';
import { asGraphError, GraphError } from '../facebook/graph';
import { publishPost } from '../facebook/publish';
import { decideRetry } from './backoff';
import { notifyConnectionExpired, notifyPublishFailure } from '../email/notify';
import { prepareLinks } from '../links';
import {
  PUBLISHABLE_APPROVAL_STATUSES,
  TERMINAL_TARGET_STATUSES,
  PostStatus,
  PostTargetStatus,
} from '../constants';

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

/** A row stuck in `processing` for longer than this is assumed abandoned. */
const STALE_LOCK_MINUTES = 15;

export interface TickResult {
  claimed: number;
  published: number;
  failed: number;
  retrying: number;
  reclaimedStale: number;
}

export interface TickOptions {
  now?: Date;
  /** Maximum destinations to process in this tick. */
  limit?: number;
  concurrency?: number;
  maxAttempts?: number;
  workerId?: string;
  logger?: (message: string, detail?: unknown) => void;
}

/**
 * Release rows whose worker died mid-publish.
 *
 * Note the risk this accepts: if the worker crashed *after* Facebook accepted
 * the post but before the row was updated, the retry double-posts. Facebook's
 * own duplicate detection (error 506) catches the common case of identical
 * content, and the alternative — never retrying — silently drops posts, which
 * is worse for a scheduling product.
 */
async function reclaimStaleLocks(now: Date, logger: TickOptions['logger']): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000);

  const { count } = await prisma.postTarget.updateMany({
    where: { status: 'processing', lockedAt: { lt: cutoff } },
    data: { status: 'pending', lockedAt: null, lockedBy: null },
  });

  if (count > 0) logger?.(`Reclaimed ${count} stale destination lock(s).`);
  return count;
}

/** Candidate destinations that are due: scheduled time reached, or retry due. */
async function findDue(now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.postTarget.findMany({
    where: {
      status: 'pending',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      post: {
        status: { in: [PostStatus.scheduled, PostStatus.publishing] },
        scheduledAt: { lte: now },
        // An unapproved post must never go out, whatever its scheduled time
        // says. This is the scheduler's half of the approval workflow.
        approvalStatus: { in: [...PUBLISHABLE_APPROVAL_STATUSES] },
      },
      target: { enabled: true },
    },
    // Oldest scheduled first, so a backlog drains in the order users expect.
    orderBy: [{ post: { scheduledAt: 'asc' } }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  });
  return rows.map((row) => row.id);
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

async function publishClaimed(
  postTargetId: string,
  options: { now: Date; maxAttempts: number; logger: TickOptions['logger'] },
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

    const media = await resolveMediaForPublish(parseMedia(post.media));

    // UTM tags and shortening are applied per destination, so a campaign can
    // be attributed to the Page it actually ran on.
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
    });

    const result = await publishPost({
      targetType: target.type,
      targetId: target.providerId,
      accessToken: decryptSecret(encryptedToken),
      message: prepared.message,
      link: prepared.link,
      media,
      // The worker publishes at the scheduled moment, so it never asks
      // Facebook to hold the post as well — native scheduling is handed over
      // at creation time instead (see src/lib/posts.ts).
      scheduledPublishTime: null,
    });

    await prisma.postTarget.update({
      where: { id: postTargetId },
      data: {
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
      },
    });

    options.logger?.(`Published post ${post.id} to ${target.name}.`, { url: result.remoteUrl });
    return 'published';
  } catch (error) {
    const graphError = asGraphError(error);
    const decision = decideRetry({
      kind: graphError.kind,
      attempts,
      maxAttempts: options.maxAttempts,
      now: options.now,
    });

    await prisma.postTarget.update({
      where: { id: postTargetId },
      data: {
        status: decision.shouldRetry ? 'pending' : 'failed',
        attempts,
        nextAttemptAt: decision.nextAttemptAt,
        errorCode: graphError.code ? String(graphError.code) : graphError.kind,
        errorMessage: `${graphError.displayMessage} ${decision.reason}`.trim(),
        lockedAt: null,
        lockedBy: null,
      },
    });

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
    }

    // Only alert once the post has actually given up. Emailing on every
    // interim retry would train people to ignore these.
    if (!decision.shouldRetry) {
      await notifyPublishFailure({
        workspaceId: post.workspaceId,
        targetName: target.name,
        reason: graphError.displayMessage,
        scheduledAt: post.scheduledAt,
        postId: post.id,
      });
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
 */
export async function refreshPostStatus(postId: string, now: Date = new Date()): Promise<PostStatus> {
  const targets = await prisma.postTarget.findMany({
    where: { postId },
    select: { status: true, publishedAt: true },
  });

  const active = targets.filter((target) => target.status !== 'cancelled' && target.status !== 'skipped');
  const published = active.filter((target) => target.status === 'published');
  const remoteScheduled = active.filter((target) => target.status === 'scheduled_remote');
  const failed = active.filter((target) => target.status === 'failed');
  const settled = active.filter((target) =>
    (TERMINAL_TARGET_STATUSES as readonly string[]).includes(target.status),
  );

  let status: PostStatus;
  if (active.length === 0) {
    status = 'cancelled';
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

  await prisma.post.update({
    where: { id: postId },
    data: { status, publishedAt },
  });

  return status;
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
  const logger = options.logger;

  const reclaimedStale = await reclaimStaleLocks(now, logger);

  const candidates = await findDue(now, limit);
  if (candidates.length === 0) {
    return { claimed: 0, published: 0, failed: 0, retrying: 0, reclaimedStale };
  }

  const claimed: string[] = [];
  for (const id of candidates) {
    if (await claim(id, workerId, now)) claimed.push(id);
  }
  if (claimed.length === 0) {
    return { claimed: 0, published: 0, failed: 0, retrying: 0, reclaimedStale };
  }

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
    publishClaimed(id, { now, maxAttempts, logger }),
  );

  for (const { postId } of postIds) {
    await refreshPostStatus(postId, now);
  }

  return {
    claimed: claimed.length,
    published: outcomes.filter((outcome) => outcome === 'published').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    retrying: outcomes.filter((outcome) => outcome === 'retrying').length,
    reclaimedStale,
  };
}

/**
 * Publish one post immediately, bypassing the schedule. Backs the "Post now"
 * button and the manual retry action.
 */
export async function publishNow(postId: string, logger?: TickOptions['logger']): Promise<TickResult> {
  const now = new Date();

  await prisma.post.update({
    where: { id: postId },
    data: { status: 'publishing', scheduledAt: now },
  });
  // Clear any pending backoff so every destination is due right now.
  await prisma.postTarget.updateMany({
    where: { postId, status: { in: ['pending', 'failed'] } },
    data: { status: 'pending', nextAttemptAt: null },
  });

  const rows = await prisma.postTarget.findMany({
    where: { postId, status: 'pending' },
    select: { id: true },
  });

  const workerId = `inline-${randomUUID().slice(0, 8)}`;
  const claimed: string[] = [];
  for (const row of rows) {
    if (await claim(row.id, workerId, now)) claimed.push(row.id);
  }

  const outcomes = await runWithConcurrency(claimed, env.concurrency, (id) =>
    publishClaimed(id, { now, maxAttempts: env.maxAttempts, logger }),
  );

  await refreshPostStatus(postId, now);

  return {
    claimed: claimed.length,
    published: outcomes.filter((outcome) => outcome === 'published').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    retrying: outcomes.filter((outcome) => outcome === 'retrying').length,
    reclaimedStale: 0,
  };
}

/** Record an audit entry. Never throws — logging must not break a publish. */
export async function logActivity(
  workspaceId: string,
  action: string,
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
