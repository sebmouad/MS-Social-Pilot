import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { isValidTimeZone } from '@/lib/calendar-dates';
import { guardedFetch, type FetchDeps } from '@/modules/publishing/server/media/network/net-guard';
import { allocateQueueTime } from '@/modules/publishing/collaboration/server/executors';
import { loadVersionRetention, recordPostVersion } from '@/modules/publishing/collaboration/server/versions';
import {
  fallbackTime, parseFeedDocument, parseWordPressDocument, renderMessage, selectNewEntries, spreadGroups, wordpressApiUrl,
  type CheckedEntry, type FeedCheckMode, type FeedEntry,
} from '../feeds';
import { authorizeFeedWrite, type FeedActor } from './access';
import { audit, idsOf, lockActor, missing, policyOf, protect, transact, type FeedLimits, type FeedRow, type Tx } from './core';

/**
 * Destination ports. The defaults delegate to Publishing's own rules (scope, enabled, provider capability,
 * link and format support), so feeds never fork them; tests inject fakes.
 */
export type Destination = { id: string; socialAccount?: { provider: string } | null };
export type FeedPorts = {
  net: FetchDeps;
  validate: (actor: FeedActor, ids: string[], max: number, link: string | null, scheduled: boolean) => Promise<Destination[]>;
  formats: (targets: Destination[], link: string | null, max: number, scheduled: boolean) => Promise<Record<string, string>>;
};
export async function defaultPorts(net: FetchDeps): Promise<FeedPorts> {
  return {
    net,
    async validate(actor, ids, max, link, scheduled) {
      const { validateTargets } = await import('@/modules/publishing/server/lifecycle');
      return validateTargets({ userId: actor.userId, workspaceId: actor.workspaceId, ...(actor.allowedTargetIds === undefined ? {} : { allowedTargetIds: actor.allowedTargetIds }) }, ids, max, [], false, link, undefined, scheduled);
    },
    async formats(targets, link, max, scheduled) {
      const { resolveAuthorizedDestinationFormats } = await import('@/modules/publishing/server/formats');
      return resolveAuthorizedDestinationFormats(targets.map(t => ({ id: t.id, socialAccount: t.socialAccount ?? null })), undefined, max, { media: [], link, firstComment: null, scheduled });
    },
  };
}

const SAFE_ERRORS: Record<string, string> = {
  invalid_url: 'The feed address is not valid.', blocked_scheme: 'The feed address must use https.', blocked_host: 'This feed address cannot be read.', blocked_address: 'This feed address cannot be read.',
  not_allowlisted: 'This site is not allowed for feeds.', too_many_redirects: 'The feed redirected too many times.', too_large: 'The feed is larger than the allowed size.', timeout: 'The feed took too long to respond.',
  bad_status: 'The feed did not return a usable response.', unreachable: 'The feed could not be reached.',
};
const CREATE_FAILED = 'Posts could not be created from this feed. Check its channels and try again.';

export type IngestOptions = {
  mode: FeedCheckMode; ports: FeedPorts; now: Date;
  /** A worker run: audit rows carry no person, conditional requests are used, repeated failures can turn the feed off. */
  automatic?: boolean; disableAfterFailures?: number;
};
export type IngestResult = { feedId: string; notModified: boolean; entries: Array<Omit<CheckedEntry, 'publishedAt'> & { publishedAt: string | null }>; draftsCreated: number; postsCreated: number; held: number; backlog: boolean; destinations: number };

type PollMark = { kind: 'ok'; validators: { etag: string | null; modified: string | null } | 'clear' | 'keep' } | { kind: 'error'; message: string };
/** Poll bookkeeping: conditional-request validators and a safe, non-secret last error. Returns whether the feed was turned off. */
async function recordPoll(workspaceId: string, feed: FeedRow, mark: PollMark, options: Pick<IngestOptions, 'automatic' | 'disableAfterFailures'>): Promise<boolean> {
  if (mark.kind === 'ok') {
    if (mark.validators === 'keep') await prisma.$executeRaw`UPDATE feed_sources SET "lastPolledAt" = NOW(), "lastError" = NULL, "pollErrorCount" = 0 WHERE id = ${feed.id} AND "workspaceId" = ${workspaceId}`;
    else if (mark.validators === 'clear') await prisma.$executeRaw`UPDATE feed_sources SET "lastPolledAt" = NOW(), "lastEtag" = NULL, "lastModified" = NULL, "lastError" = NULL, "pollErrorCount" = 0 WHERE id = ${feed.id} AND "workspaceId" = ${workspaceId}`;
    else await prisma.$executeRaw`UPDATE feed_sources SET "lastPolledAt" = NOW(), "lastEtag" = ${mark.validators.etag}, "lastModified" = ${mark.validators.modified}, "lastError" = NULL, "pollErrorCount" = 0 WHERE id = ${feed.id} AND "workspaceId" = ${workspaceId}`;
    return false;
  }
  const limit = options.automatic ? options.disableAfterFailures ?? 0 : 0;
  const rows = await prisma.$queryRaw<Array<{ enabled: boolean }>>`UPDATE feed_sources SET "lastPolledAt" = NOW(), "lastError" = ${mark.message}, "pollErrorCount" = "pollErrorCount" + 1, enabled = CASE WHEN ${limit}::int > 0 AND "pollErrorCount" + 1 >= ${limit}::int THEN FALSE ELSE enabled END WHERE id = ${feed.id} AND "workspaceId" = ${workspaceId} RETURNING enabled`;
  return limit > 0 && rows[0]?.enabled === false;
}
const occupying = ['scheduled', 'pending_approval', 'publishing'];

/**
 * Read a feed and, depending on the mode, turn its new items into local posts.
 *
 *  - `preview`: report only; nothing is created and no conditional-request state is kept.
 *  - `drafts`: one draft per new item, never scheduled, never submitted.
 *  - `posts`: one queued post per new item at the next free queue time (or a delayed fallback), spread over
 *    channels when the feed asks. The post is held for approval when the feed is set to `review` or the
 *    workspace requires approval: this path never publishes or schedules unreviewed content past a rule.
 *
 * Exactly-once: each item is recorded in `feed_items` under a unique (feed, guid) pair in the same transaction
 * as its post(s), so a retry after a failure re-creates the whole batch and a concurrent read skips duplicates.
 * Nothing is published here; the shared delivery worker remains the only publisher.
 */
export async function ingestFeed(actor: FeedActor, feed: FeedRow, workspaceId: string, l: FeedLimits, options: IngestOptions): Promise<IngestResult> {
  const targetIds = idsOf(feed.targetIds);
  let entries: FeedEntry[];
  let notModified = false;
  let validators: { etag: string | null; modified: string | null } = { etag: null, modified: null };
  try {
    const target = feed.kind === 'wordpress' ? wordpressApiUrl(feed.url) : feed.url;
    const headers: Record<string, string> = { accept: feed.kind === 'wordpress' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9', 'user-agent': 'MSSocialPilot-Feeds/1.0' };
    // Only a run that will take what it finds may use validators: a preview must see the real entries.
    if (options.automatic && feed.lastEtag) headers['if-none-match'] = feed.lastEtag;
    if (options.automatic && feed.lastModified) headers['if-modified-since'] = feed.lastModified;
    const fetched = await guardedFetch(target, policyOf(l), options.ports.net, { headers, acceptNotModified: true });
    if (fetched.notModified) { notModified = true; entries = []; }
    else {
      const text = fetched.bytes.toString('utf8');
      entries = feed.kind === 'wordpress' ? parseWordPressDocument(text, l.maxItems) : parseFeedDocument(text, l.maxItems);
      validators = { etag: fetched.etag, modified: fetched.lastModified };
    }
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    const safe = (reason && SAFE_ERRORS[reason]) || 'The feed could not be read.';
    const turnedOff = await recordPoll(workspaceId, feed, { kind: 'error', message: safe }, options).catch(() => false);
    if (turnedOff) await audit(prisma as unknown as Tx, workspaceId, null, 'feeds.disabled_after_failures', { feedId: feed.id }).catch(() => undefined);
    if (error instanceof OperationError) throw new OperationError(error.code, safe);
    throw new OperationError('upstream_failure', safe);
  }

  const guids = entries.map(e => e.guid);
  const known = guids.length ? await protect(prisma.$queryRaw<Array<{ guid: string }>>`SELECT guid FROM feed_items WHERE "feedSourceId" = ${feed.id} AND guid = ANY(${guids}::text[])`) : [];
  const seen = new Set(known.map(k => k.guid));
  const cap = options.mode === 'posts' ? l.itemsPerRun : l.maxItems;
  const { selected, backlog } = selectNewEntries({ entries, seen, ingestFrom: feed.ingestFrom, max: cap });
  const chosen = new Set(selected.map(e => e.guid));
  const checked: CheckedEntry[] = entries.map(entry => ({
    guid: entry.guid, title: entry.title, link: entry.link, publishedAt: entry.publishedAt,
    message: renderMessage(feed.messageTemplate, entry, { hashtags: feed.hashtags, excerptChars: l.excerpt, maxChars: l.maxMessage }),
    isNew: !seen.has(entry.guid),
    // Items older than the subscription start are never ingested; undated items are treated as current.
    eligible: !seen.has(entry.guid) && (entry.publishedAt === null || entry.publishedAt.getTime() >= feed.ingestFrom.getTime()),
  }));
  const base: IngestResult = { feedId: feed.id, notModified, entries: checked.map(c => ({ ...c, publishedAt: c.publishedAt?.toISOString() ?? null })), draftsCreated: 0, postsCreated: 0, held: 0, backlog, destinations: targetIds.length };

  if (options.mode === 'preview') { await recordPoll(workspaceId, feed, { kind: 'ok', validators: 'keep' }, options); return base; }

  // Stored only once everything in this copy of the feed has been taken: with a backlog left the next
  // conditional read would be answered "not modified" and the rest would wait for the publisher's next post.
  const settle = (): PollMark => ({ kind: 'ok', validators: notModified ? 'keep' : options.mode === 'posts' && !backlog ? validators : 'clear' });
  const items = checked.filter(c => chosen.has(c.guid) && c.message.length > 0);
  // An item with nothing to say is still recorded as seen elsewhere in legacy; here it is simply skipped without a post.
  if (!items.length) { await recordPoll(workspaceId, feed, settle(), options); return base; }
  if (options.mode === 'posts' && !targetIds.length) {
    await recordPoll(workspaceId, feed, { kind: 'error', message: 'No channels are chosen for this feed.' }, options).catch(() => undefined);
    throw new OperationError('conflict', 'Choose at least one channel for this feed before it creates posts.');
  }

  try {
    const created = await createPosts(actor, feed, workspaceId, items, targetIds, l, options);
    await recordPoll(workspaceId, feed, settle(), options);
    return { ...base, ...created };
  } catch (error) {
    const turnedOff = await recordPoll(workspaceId, feed, { kind: 'error', message: error instanceof OperationError && error.code === 'conflict' && /turned off|changed while/.test(error.message) ? error.message : CREATE_FAILED }, options).catch(() => false);
    if (turnedOff) await audit(prisma as unknown as Tx, workspaceId, null, 'feeds.disabled_after_failures', { feedId: feed.id }).catch(() => undefined);
    throw error;
  }
}

async function createPosts(actor: FeedActor, feed: FeedRow, workspaceId: string, items: CheckedEntry[], targetIds: string[], l: FeedLimits, options: IngestOptions) {
  const scheduled = options.mode === 'posts';
  // Destination rules run per distinct link (link support differs by destination); no tenant data is written yet.
  const formatsByLink = new Map<string, Record<string, string>>();
  const auth = await authorizeFeedWrite(actor);
  if (targetIds.length) {
    for (const item of items) {
      const key = item.link ?? '';
      if (formatsByLink.has(key)) continue;
      const destinations = await options.ports.validate(auth.actor, targetIds, l.maxTargets, item.link, scheduled);
      formatsByLink.set(key, await options.ports.formats(destinations, item.link, l.maxTargets, scheduled));
    }
  }
  const retention = await loadVersionRetention();
  return protect(transact(workspaceId, l, async tx => {
    await lockActor(tx, actor, true);
    const locked = await tx.$queryRaw<Array<{ enabled: boolean; targetIds: unknown; autoApprove: boolean; spreadMinutes: number }>>`SELECT enabled, "targetIds", "autoApprove", "spreadMinutes" FROM feed_sources WHERE id = ${feed.id} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
    const current = locked[0];
    if (!current) throw missing();
    if (!current.enabled) throw new OperationError('conflict', 'This feed was turned off. Turn it on to create posts.');
    // The channels and handling were validated for the settings that were read; stop if they changed since.
    if (JSON.stringify(idsOf(current.targetIds)) !== JSON.stringify(targetIds)) throw new OperationError('conflict', 'This feed changed while it was being read.');
    const autoApprove = current.autoApprove;
    const spreadMinutes = Math.min(Number(current.spreadMinutes) || 0, l.maxSpread);

    let timezone = 'UTC'; let requiresApproval = false;
    if (scheduled) {
      const policy = await tx.$queryRaw<Array<{ timezone: string; requiresApproval: boolean }>>`SELECT timezone, "requiresApproval" FROM workspaces WHERE id = ${workspaceId} FOR SHARE`;
      if (!policy[0] || !isValidTimeZone(policy[0].timezone) || typeof policy[0].requiresApproval !== 'boolean') throw new OperationError('unavailable', 'Workspace scheduling settings are unavailable.');
      timezone = policy[0].timezone; requiresApproval = policy[0].requiresApproval;
    }
    // Automation never bypasses a review rule: unreviewed article text is held when the feed asks for review
    // or the workspace requires approval, whatever role the acting person or owner has.
    const hold = scheduled && (!autoApprove || requiresApproval);

    let drafts = 0; let posts = 0; let held = 0;
    for (const item of items) {
      const itemId = `fit_${randomUUID()}`;
      // The unique (feed, guid) pair is the de-duplication guard: a concurrent or repeated read cannot double-create.
      const inserted = await tx.$executeRaw`INSERT INTO feed_items (id, "feedSourceId", guid, url, title, "publishedAt", "createdAt") VALUES (${itemId}, ${feed.id}, ${item.guid}, ${item.link}, ${item.title}, ${item.publishedAt}, NOW()) ON CONFLICT ("feedSourceId", guid) DO NOTHING`;
      if (inserted !== 1) continue;
      const formats = formatsByLink.get(item.link ?? '') ?? {};
      if (!scheduled) {
        const postId = randomUUID();
        await tx.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, link, status, "sourceFeedItemId", "createdAt", "updatedAt") VALUES (${postId}, ${workspaceId}, ${actor.userId}, ${item.message}, ${item.link}, 'draft'::"PostStatus", ${itemId}, NOW(), NOW())`;
        for (const targetId of targetIds) await tx.$executeRaw`INSERT INTO post_targets (id, "postId", "targetId", "formatId", status, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${postId}, ${targetId}, ${formats[targetId] ?? null}, 'pending'::"PostTargetStatus", NOW(), NOW())`;
        await recordPostVersion(tx, postId, options.automatic ? null : actor.userId, retention);
        drafts += 1;
        continue;
      }
      const first = await allocateQueueTime(tx, workspaceId, timezone, targetIds, options.now, l.lookaheadDays)
        ?? fallbackTime(options.now, (await tx.$queryRaw<Array<{ scheduledAt: Date }>>`SELECT DISTINCT p."scheduledAt" FROM posts p WHERE p."workspaceId" = ${workspaceId} AND p.status::text = ANY(${occupying}::text[]) AND p."scheduledAt" >= ${options.now}`).map(r => r.scheduledAt), l.fallbackDelay, l.fallbackSpacing);
      for (const [index, group] of spreadGroups(targetIds, spreadMinutes).entries()) {
        const postId = randomUUID();
        const at = new Date(first.getTime() + index * spreadMinutes * 60_000);
        await tx.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, link, status, "scheduledAt", timezone, "publishMode", "approvalStatus", "submittedById", "submittedAt", "sourceFeedItemId", "createdAt", "updatedAt")
          VALUES (${postId}, ${workspaceId}, ${actor.userId}, ${item.message}, ${item.link}, ${hold ? 'pending_approval' : 'scheduled'}::"PostStatus", ${at}, ${timezone}, 'worker'::"PublishMode", ${hold ? 'pending' : 'not_required'}::"ApprovalStatus", ${hold ? actor.userId : null}, ${hold ? options.now : null}, ${itemId}, NOW(), NOW())`;
        for (const targetId of group) await tx.$executeRaw`INSERT INTO post_targets (id, "postId", "targetId", "formatId", status, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${postId}, ${targetId}, ${formats[targetId] ?? null}, 'pending'::"PostTargetStatus", NOW(), NOW())`;
        await recordPostVersion(tx, postId, options.automatic ? null : actor.userId, retention);
        posts += 1; if (hold) held += 1;
      }
    }
    await audit(tx, workspaceId, options.automatic ? null : actor, scheduled ? 'feeds.posts_created' : 'feeds.drafts_created', {
      feedId: feed.id, ...(scheduled ? { posts, held, authorId: actor.userId, handling: autoApprove ? 'schedule' : 'review', approvalRequired: requiresApproval } : { drafts }), considered: items.length, ...(options.automatic ? { automatic: true } : {}),
    });
    await lockActor(tx, actor, true);
    return { draftsCreated: drafts, postsCreated: posts, held };
  }));
}
