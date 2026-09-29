import { ApprovalStatus, PostStatus, Prisma, type FeedSource } from '@prisma/client';

import { prisma } from './../prisma';
import { parseTargetIds } from '../json';
import { nextAvailableSlot } from '../time';
import { QUEUE_OCCUPYING_STATUSES } from '../constants';
import { notifyApprovalRequest } from '../email/notify';
import { parseFeed, renderTemplate, type FeedEntry } from './parse';
import { fetchPublic, readCapped } from '../safe-fetch';

/**
 * RSS ingestion.
 *
 * Three rules keep this from flooding a client's Page:
 *
 * 1. **First poll takes nothing older than the subscription.** Adding a blog
 *    with ten years of archive must not queue ten years of posts.
 * 2. **Items are matched on guid**, so a publisher that rewrites its URLs, or
 *    re-publishes its feed, cannot re-post what has already gone out.
 * 3. **A per-poll cap**, so a feed that dumps 400 items in one update fills the
 *    queue gradually instead of all at once.
 *
 * Conditional requests (ETag / Last-Modified) keep polling cheap and polite.
 */

const MAX_ITEMS_PER_POLL = 10;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
/** Disable a source after this many consecutive failures. */
const MAX_POLL_ERRORS = 10;

export interface PollResult {
  sourceId: string;
  status: 'unchanged' | 'ingested' | 'error' | 'skipped';
  created: number;
  message?: string;
}

async function fetchFeed(source: FeedSource): Promise<
  { status: 'not-modified' } | { status: 'ok'; body: string; etag: string | null; lastModified: string | null }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'user-agent': 'MS-Social-Pilot/1.0 (+RSS reader)',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    };
    if (source.lastEtag) headers['if-none-match'] = source.lastEtag;
    if (source.lastModified) headers['if-modified-since'] = source.lastModified;

    // Guarded: the address is whatever somebody typed into the feeds screen,
    // and this runs inside the server's network. See `safe-fetch.ts`.
    const response = await fetchPublic(source.url, { headers, signal: controller.signal });

    // Nothing new since last time — the cheap, common case.
    if (response.status === 304) return { status: 'not-modified' };
    if (!response.ok) throw new Error(`Feed responded ${response.status}.`);

    const body = await readCapped(response, MAX_FEED_BYTES);
    return {
      status: 'ok',
      body,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Which entries are genuinely new for this source. */
export function selectNewEntries(options: {
  entries: FeedEntry[];
  seenGuids: Set<string>;
  ingestFrom: Date;
  max?: number;
}): FeedEntry[] {
  return options.entries
    .filter((entry) => !options.seenGuids.has(entry.guid))
    // An entry with no date is treated as new: better to post it once than
    // never. Ones older than the subscription are skipped.
    .filter((entry) => !entry.publishedAt || entry.publishedAt >= options.ingestFrom)
    .sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0))
    .slice(0, options.max ?? MAX_ITEMS_PER_POLL);
}

/** How far out a post goes when there is no free queue slot to put it in. */
const FALLBACK_DELAY_MS = 60 * 60 * 1000;
/** And how far apart consecutive fallbacks are kept. */
const FALLBACK_SPACING_MS = 30 * 60 * 1000;

/**
 * When a feed post goes out if the queue cannot place it.
 *
 * An hour out clears Facebook's native scheduling floor and gives a human time
 * to intervene. But a fixed "now + 1h" handed every item of a poll — and every
 * item of the next poll, if it ran within the hour — the same instant, so ten
 * posts landed on the Page at once. Stepping past anything already booked near
 * that time spreads them out instead.
 */
export function fallbackTime(now: Date, taken: Date[]): Date {
  const booked = taken.map((date) => date.getTime());
  let candidate = now.getTime() + FALLBACK_DELAY_MS;
  // Terminates: each step moves past at least one booked time, and there are
  // finitely many of them.
  while (booked.some((time) => Math.abs(time - candidate) < FALLBACK_SPACING_MS)) {
    candidate += FALLBACK_SPACING_MS;
  }
  return new Date(candidate);
}

/** A post created from a feed entry. */
interface ScheduledEntry {
  postId: string;
  scheduledAt: Date;
  needsApproval: boolean;
}

/** Another poll of the same feed recorded this entry first. */
function isAlreadyIngested(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Record one entry as seen and create its post — together, or not at all.
 *
 * Apart, a post that failed to be written (a database hiccup, a destination
 * deleted mid-poll) left its entry marked as seen, and the article was never
 * posted and never retried. In one transaction a failure rolls both back and
 * the next poll picks the entry up again.
 *
 * The transaction also takes the same per-workspace lock the composer takes
 * around queue allocation (see `createPost`), so a feed post and a composer post
 * cannot both be handed the same free slot.
 */
async function scheduleEntry(options: {
  source: FeedSource;
  entry: FeedEntry;
  targetIds: string[];
  authorId: string;
  timezone: string;
  now: Date;
}): Promise<ScheduledEntry | null> {
  const { source, entry } = options;
  const message = renderTemplate(source.messageTemplate, entry);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.workspaceId}))`;

      const item = await tx.feedItem.create({
        data: {
          feedSourceId: source.id,
          guid: entry.guid,
          url: entry.link,
          title: entry.title,
          publishedAt: entry.publishedAt,
        },
      });

      // Nothing to post. Still recorded as seen: otherwise it is reconsidered
      // on every poll and takes one of the per-poll places each time.
      if (!message && !entry.link) return null;

      const [slots, taken] = await Promise.all([
        tx.queueSlot.findMany({ where: { workspaceId: source.workspaceId } }),
        tx.post.findMany({
          where: {
            workspaceId: source.workspaceId,
            status: { in: [...QUEUE_OCCUPYING_STATUSES] },
            scheduledAt: { gte: options.now },
          },
          select: { scheduledAt: true },
        }),
      ]);
      const takenUtc = taken.map((post) => post.scheduledAt).filter((date): date is Date => Boolean(date));

      const scheduledAt =
        (slots.length > 0
          ? nextAvailableSlot({ slots, timeZone: options.timezone, takenUtc, now: options.now })
          : null) ?? fallbackTime(options.now, takenUtc);

      const needsApproval = !source.autoApprove;
      const post = await tx.post.create({
        data: {
          workspaceId: source.workspaceId,
          authorId: options.authorId,
          message,
          link: entry.link,
          status: needsApproval ? PostStatus.pending_approval : PostStatus.scheduled,
          approvalStatus: needsApproval ? ApprovalStatus.pending : ApprovalStatus.not_required,
          // Reviewers see how long something has waited by this; a feed post
          // is submitted the moment it is imported.
          submittedAt: needsApproval ? options.now : null,
          publishMode: source.publishMode,
          scheduledAt,
          timezone: options.timezone,
          sourceFeedItemId: item.id,
          targets: { create: options.targetIds.map((targetId) => ({ targetId })) },
        },
      });

      return { postId: post.id, scheduledAt, needsApproval };
    });
  } catch (error) {
    // "Poll now" racing the worker: the other poll recorded it, and posted it.
    if (isAlreadyIngested(error)) return null;
    throw error;
  }
}

/** Poll one source. Never throws — failures are recorded on the row. */
export async function pollSource(
  source: FeedSource,
  options: { now?: Date; logger?: (message: string, detail?: unknown) => void } = {},
): Promise<PollResult> {
  const now = options.now ?? new Date();

  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: source.workspaceId },
      include: {
        memberships: { orderBy: { createdAt: 'asc' }, take: 1, select: { userId: true } },
      },
    });

    const author = workspace.memberships[0]?.userId;
    const targetIds = parseTargetIds(source.targetIds);

    if (!author || targetIds.length === 0) {
      await prisma.feedSource.update({
        where: { id: source.id },
        data: { lastPolledAt: now, lastError: 'No destinations are configured for this feed.' },
      });
      return { sourceId: source.id, status: 'skipped', created: 0, message: 'no destinations' };
    }

    // Destinations may have been removed or disabled since the feed was set up.
    const validTargets = await prisma.target.findMany({
      where: { id: { in: targetIds }, workspaceId: source.workspaceId, enabled: true },
      select: { id: true },
    });
    if (validTargets.length === 0) {
      await prisma.feedSource.update({
        where: { id: source.id },
        data: { lastPolledAt: now, lastError: 'None of this feed’s destinations are available.' },
      });
      return { sourceId: source.id, status: 'skipped', created: 0, message: 'no valid destinations' };
    }

    const fetched = await fetchFeed(source);

    if (fetched.status === 'not-modified') {
      await prisma.feedSource.update({
        where: { id: source.id },
        data: { lastPolledAt: now, pollErrorCount: 0, lastError: null },
      });
      return { sourceId: source.id, status: 'unchanged', created: 0 };
    }

    const feed = parseFeed(fetched.body);

    const seen = await prisma.feedItem.findMany({
      where: { feedSourceId: source.id },
      select: { guid: true },
    });

    const candidates = selectNewEntries({
      entries: feed.entries,
      seenGuids: new Set(seen.map((item) => item.guid)),
      ingestFrom: source.ingestFrom,
      max: Number.POSITIVE_INFINITY,
    });
    const fresh = candidates.slice(0, MAX_ITEMS_PER_POLL);
    const backlog = candidates.length > fresh.length;

    let created = 0;
    let firstForReview: Date | null = null;
    for (const entry of fresh) {
      const scheduled = await scheduleEntry({
        source,
        entry,
        targetIds: validTargets.map((target) => target.id),
        authorId: author,
        timezone: workspace.timezone,
        now,
      });
      if (!scheduled) continue;
      created += 1;
      if (scheduled.needsApproval && (!firstForReview || scheduled.scheduledAt < firstForReview)) {
        firstForReview = scheduled.scheduledAt;
      }
    }

    await prisma.feedSource.update({
      where: { id: source.id },
      data: {
        lastPolledAt: now,
        // Only once everything in this copy of the feed has been taken. Stored
        // with a backlog left, the next poll is answered "304 Not Modified" and
        // the rest wait until the publisher next posts — possibly for weeks.
        ...(backlog ? {} : { lastEtag: fetched.etag, lastModified: fetched.lastModified }),
        pollErrorCount: 0,
        lastError: null,
      },
    });

    // The same email the composer sends on submission, once per poll rather
    // than per item: ten imported articles should not be ten emails.
    if (firstForReview) {
      await notifyApprovalRequest({
        workspaceId: source.workspaceId,
        authorName: source.name,
        scheduledAt: firstForReview,
      });
    }

    if (created > 0) options.logger?.(`Feed "${source.name}" queued ${created} new item(s).`);
    return { sourceId: source.id, status: 'ingested', created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorCount = source.pollErrorCount + 1;

    // A feed that has been broken for ten straight polls is not coming back
    // on its own; stop hammering it and let someone look.
    await prisma.feedSource.update({
      where: { id: source.id },
      data: {
        lastPolledAt: now,
        pollErrorCount: errorCount,
        lastError: message.slice(0, 500),
        ...(errorCount >= MAX_POLL_ERRORS ? { enabled: false } : {}),
      },
    });

    options.logger?.(`Feed "${source.name}" failed: ${message}`);
    return { sourceId: source.id, status: 'error', created: 0, message };
  }
}

export interface PollAllResult {
  polled: number;
  created: number;
  errors: number;
}

/** Poll every enabled source whose interval has elapsed. */
export async function pollDueSources(options: {
  now?: Date;
  intervalMinutes: number;
  limit?: number;
  logger?: (message: string, detail?: unknown) => void;
} ): Promise<PollAllResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.intervalMinutes * 60 * 1000);

  const sources = await prisma.feedSource.findMany({
    where: {
      enabled: true,
      OR: [{ lastPolledAt: null }, { lastPolledAt: { lte: cutoff } }],
    },
    orderBy: [{ lastPolledAt: { sort: 'asc', nulls: 'first' } }],
    take: options.limit ?? 25,
  });

  let created = 0;
  let errors = 0;

  for (const source of sources) {
    const result = await pollSource(source, { now, logger: options.logger });
    created += result.created;
    if (result.status === 'error') errors += 1;
  }

  return { polled: sources.length, created, errors };
}
