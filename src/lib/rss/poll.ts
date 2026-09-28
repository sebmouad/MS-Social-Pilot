import { ApprovalStatus, PostStatus, type FeedSource } from '@prisma/client';

import { prisma } from './../prisma';
import { parseTargetIds } from '../json';
import { nextAvailableSlot } from '../time';
import { QUEUE_OCCUPYING_STATUSES } from '../constants';
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

async function scheduleEntry(options: {
  source: FeedSource;
  entry: FeedEntry;
  targetIds: string[];
  authorId: string;
  timezone: string;
  now: Date;
}): Promise<string | null> {
  const { source, entry } = options;

  const message = renderTemplate(source.messageTemplate, entry);
  if (!message && !entry.link) return null;

  const slots = await prisma.queueSlot.findMany({ where: { workspaceId: source.workspaceId } });
  const taken = await prisma.post.findMany({
    where: {
      workspaceId: source.workspaceId,
      status: { in: [...QUEUE_OCCUPYING_STATUSES] },
      scheduledAt: { gte: options.now },
    },
    select: { scheduledAt: true },
  });

  const slot =
    slots.length > 0
      ? nextAvailableSlot({
          slots,
          timeZone: options.timezone,
          takenUtc: taken.map((post) => post.scheduledAt).filter((date): date is Date => Boolean(date)),
          now: options.now,
        })
      : null;

  // No queue configured: an hour out, which clears Facebook's native
  // scheduling floor and gives a human time to intervene.
  const scheduledAt = slot ?? new Date(options.now.getTime() + 60 * 60 * 1000);

  const item = await prisma.feedItem.create({
    data: {
      feedSourceId: source.id,
      guid: entry.guid,
      url: entry.link,
      title: entry.title,
      publishedAt: entry.publishedAt,
    },
  });

  const post = await prisma.post.create({
    data: {
      workspaceId: source.workspaceId,
      authorId: options.authorId,
      message,
      link: entry.link,
      status: source.autoApprove ? PostStatus.scheduled : PostStatus.pending_approval,
      approvalStatus: source.autoApprove ? ApprovalStatus.not_required : ApprovalStatus.pending,
      publishMode: source.publishMode,
      scheduledAt,
      timezone: options.timezone,
      sourceFeedItemId: item.id,
      targets: { create: options.targetIds.map((targetId) => ({ targetId })) },
    },
  });

  return post.id;
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

    const fresh = selectNewEntries({
      entries: feed.entries,
      seenGuids: new Set(seen.map((item) => item.guid)),
      ingestFrom: source.ingestFrom,
    });

    let created = 0;
    for (const entry of fresh) {
      const postId = await scheduleEntry({
        source,
        entry,
        targetIds: validTargets.map((target) => target.id),
        authorId: author,
        timezone: workspace.timezone,
        now,
      });
      if (postId) created += 1;
    }

    await prisma.feedSource.update({
      where: { id: source.id },
      data: {
        lastPolledAt: now,
        lastEtag: fetched.etag,
        lastModified: fetched.lastModified,
        pollErrorCount: 0,
        lastError: null,
      },
    });

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
