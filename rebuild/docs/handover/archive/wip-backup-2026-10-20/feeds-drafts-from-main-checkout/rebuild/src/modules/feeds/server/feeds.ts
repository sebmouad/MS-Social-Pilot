import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizeFeature, type ToolActor, type ToolAuthorization } from '@/modules/media/server/access';
import { checkUrlShape, defaultFetchDeps, guardedFetch, type FetchDeps, type FetchPolicy } from '@/modules/media/net-guard';
import { FEEDS_BOUNDS } from '../config';
import {
  createFeedConfirmation, deleteFeedConfirmation, draftFeedConfirmation, FEED_CHECK_SCHEMA, FEED_CREATE_SCHEMA, FEED_DELETE_SCHEMA, FEED_LIST_SCHEMA, FEED_UPDATE_SCHEMA,
  parseFeedDocument, parseWordPressDocument, renderMessage, updateFeedConfirmation, wordpressApiUrl, type CheckedEntry, type FeedEntry, type FeedInput, type FeedRecord,
} from '../feeds';

const FEATURE = 'publishing/posts' as const;
const AUTHOR_ROLES = new Set(['owner', 'admin', 'editor', 'contributor']);
type Tx = Prisma.TransactionClient;
type Limits = Awaited<ReturnType<typeof bounds>>;
export type FeedLimits = Limits;
export type FeedRow = Row;
type Row = { id: string; name: string; url: string; kind: string; enabled: boolean; messageTemplate: string; hashtags: string; targetIds: unknown; lastPolledAt: Date | null; lastError: string | null; lastEtag: string | null; lastModified: string | null; ingestFrom: Date; createdAt: Date; updatedAt: Date };
/** Destination validation port; the default delegates to the shared Publishing rules (scope, enabled, capability). */
export type FeedDeps = { net?: FetchDeps; validateTargets?: (actor: ToolActor, ids: string[], max: number) => Promise<Array<{ id: string }>>; now?: () => Date };

export const FEED_COLUMNS_SQL = () => COLUMNS;
const COLUMNS = `id, name, url, kind, enabled, "messageTemplate", hashtags, "targetIds", "lastPolledAt", "lastError", "lastEtag", "lastModified", "ingestFrom", "createdAt", "updatedAt"`;
const bad = (text = 'Choose valid feed details and confirm the exact action.') => new OperationError('invalid_request', text);
const unavailable = () => new OperationError('unavailable', 'Content feeds are temporarily unavailable. Refresh and try again.');
const missing = () => new OperationError('not_found', 'This feed is unavailable in the current workspace.');
const parse = <S extends import('zod').ZodTypeAny>(schema: S, input: unknown): import('zod').output<S> => { const r = schema.safeParse(input); if (!r.success) throw bad(); return r.data; };
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= r.min && v <= r.max;
const isUnique = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && ((error as { code?: unknown }).code === 'P2002' || (error as { code?: unknown }).code === '23505'));

async function protect<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; } catch (error) {
    if (error instanceof OperationError) throw error;
    if (isUnique(error)) throw new OperationError('conflict', 'A feed with this address already exists in the current workspace.');
    throw new OperationError('upstream_failure', 'The feed operation could not be confirmed. Refresh the list before trying again.');
  }
}

export async function bounds() {
  try {
    const keys = ['feeds.pageSize', 'feeds.maxPerWorkspace', 'feeds.fetchTimeoutMs', 'feeds.fetchMaxBytes', 'feeds.fetchMaxRedirects', 'feeds.allowHttp', 'feeds.hostAllowlist', 'feeds.maxItemsPerCheck', 'feeds.maxTargets', 'feeds.messageMaxCharacters', 'feeds.nameMaxCharacters', 'feeds.minCheckIntervalSeconds', 'feeds.excerptCharacters', 'feeds.transactionTimeoutMs', 'feeds.transactionMaxWaitMs', 'data.workspaceOperationTimeoutMs'] as const;
    const [pageSize, maxFeeds, fetchTimeout, fetchMax, redirects, allowHttp, allowlist, maxItems, maxTargets, maxMessage, maxName, minInterval, excerpt, timeout, maxWait, workspaceTimeout] = await Promise.all(keys.map(key => runtimeConfig(key)));
    const B = FEEDS_BOUNDS;
    if (!inRange(pageSize, B.pageSize) || !inRange(maxFeeds, B.maxPerWorkspace) || !inRange(fetchTimeout, B.fetchTimeoutMs) || !inRange(fetchMax, B.fetchMaxBytes) || !inRange(redirects, B.fetchMaxRedirects) || !inRange(maxItems, B.maxItemsPerCheck)
      || !inRange(maxTargets, B.maxTargets) || !inRange(maxMessage, B.messageMaxCharacters) || !inRange(maxName, B.nameMaxCharacters) || !inRange(minInterval, B.minCheckIntervalSeconds) || !inRange(excerpt, B.excerptCharacters)
      || !inRange(timeout, B.transactionTimeoutMs) || !inRange(maxWait, B.transactionMaxWaitMs) || !inRange(workspaceTimeout, B.workspaceTimeoutMs) || typeof allowHttp !== 'boolean' || !Array.isArray(allowlist) || timeout + maxWait >= workspaceTimeout) throw unavailable();
    return { pageSize, maxFeeds, fetchTimeout, fetchMax, redirects, allowHttp, allowlist: allowlist as string[], maxItems, maxTargets, maxMessage, maxName, minInterval, excerpt, timeout, maxWait };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}
const policyOf = (l: Limits): FetchPolicy => ({ timeoutMs: l.fetchTimeout, maxBytes: l.fetchMax, maxRedirects: l.redirects, allowHttp: l.allowHttp, hostAllowlist: l.allowlist });

async function transact<T>(workspaceId: string, l: Limits, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: l.timeout, maxWait: l.maxWait }));
}
async function lockActor(tx: Tx, actor: ToolActor, write: boolean): Promise<ToolAuthorization> {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  if (!rows[0] || rows[0].disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  const auth = await authorizeFeature(actor, FEATURE, write ? 'write' : 'read');
  if (write && !AUTHOR_ROLES.has(auth.role)) throw new OperationError('forbidden', 'You do not have permission to manage feeds.');
  return auth;
}
async function audit(tx: Tx, actor: ToolActor, action: string, detail: object) {
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (count !== 1) throw unavailable();
}
async function authorizeWrite(actor: ToolActor): Promise<ToolAuthorization> {
  const auth = await authorizeFeature(actor, FEATURE, 'write');
  if (!AUTHOR_ROLES.has(auth.role)) throw new OperationError('forbidden', 'You do not have permission to manage feeds.');
  return auth;
}

const idsOf = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
/** A scoped member sees and manages only feeds whose channels are all inside their grant. */
const within = (auth: ToolAuthorization, ids: readonly string[]) => auth.actor.allowedTargetIds === undefined || ids.every(id => auth.actor.allowedTargetIds!.includes(id));
function toRecord(row: Row): FeedRecord {
  return { id: row.id, name: row.name, url: row.url, kind: row.kind === 'wordpress' ? 'wordpress' : 'rss', enabled: row.enabled, messageTemplate: row.messageTemplate, hashtags: row.hashtags, targetIds: idsOf(row.targetIds), lastPolledAt: row.lastPolledAt, lastError: row.lastError, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
const defaultValidateTargets: NonNullable<FeedDeps['validateTargets']> = async (actor, ids, max) => {
  const { validateTargets } = await import('@/server/publishing/lifecycle');
  return validateTargets({ userId: actor.userId, workspaceId: actor.workspaceId, ...(actor.allowedTargetIds === undefined ? {} : { allowedTargetIds: actor.allowedTargetIds }) }, ids, max);
};

export async function readFeeds(actor: ToolActor, input: unknown = {}) {
  const query = parse(FEED_LIST_SCHEMA, input);
  const l = await bounds();
  const auth = await authorizeFeature(actor, FEATURE, 'read');
  const page = query.page ?? 1;
  return protect((async () => {
    const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT ${COLUMNS} FROM feed_sources WHERE "workspaceId" = $1 ORDER BY name ASC, id ASC LIMIT $2`, actor.workspaceId, l.maxFeeds + 100);
    const visible = rows.map(toRecord).filter(feed => within(auth, feed.targetIds));
    const window = visible.slice((page - 1) * l.pageSize, page * l.pageSize + 1);
    return { feeds: window.slice(0, l.pageSize), page, pageSize: l.pageSize, hasMore: window.length > l.pageSize, limits: { maxNameCharacters: l.maxName, maxMessageCharacters: l.maxMessage, maxTargets: l.maxTargets }, scopedView: auth.actor.allowedTargetIds !== undefined };
  })());
}

function normalize(input: FeedInput, l: Limits): FeedInput {
  if (input.name.length > l.maxName || input.messageTemplate.length > l.maxMessage || input.targetIds.length > l.maxTargets || new Set(input.targetIds).size !== input.targetIds.length) throw bad();
  const url = checkUrlShape(input.url, { allowHttp: l.allowHttp, hostAllowlist: l.allowlist }).toString();
  return { ...input, url };
}

export async function createFeed(actor: ToolActor, input: unknown, deps: FeedDeps = {}) {
  const data = parse(FEED_CREATE_SCHEMA, input);
  if (data.confirmation !== createFeedConfirmation(data.name)) throw bad();
  const l = await bounds(); await authorizeWrite(actor);
  const { confirmation: _c, ...rest } = data;
  let feed: FeedInput;
  try { feed = normalize(rest, l); } catch (error) { if (error instanceof OperationError) throw error; throw bad('Enter a valid feed address.'); }
  const auth = await authorizeWrite(actor);
  if (feed.targetIds.length) await (deps.validateTargets ?? defaultValidateTargets)(auth.actor, feed.targetIds, l.maxTargets);
  return protect(transact(actor.workspaceId, l, async tx => {
    await lockActor(tx, actor, true);
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM feed_sources WHERE "workspaceId" = ${actor.workspaceId}`;
    if (Number(count[0]?.count ?? 0) >= l.maxFeeds) throw new OperationError('conflict', 'This workspace has reached its feed limit.');
    const dup = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM feed_sources WHERE "workspaceId" = ${actor.workspaceId} AND url = ${feed.url} AND kind = ${feed.kind} LIMIT 1`;
    if (dup[0]) throw new OperationError('conflict', 'A feed with this address already exists in the current workspace.');
    const id = `feed_${randomUUID()}`;
    await tx.$executeRaw`INSERT INTO feed_sources (id, "workspaceId", name, url, kind, enabled, "messageTemplate", "targetIds", hashtags, "ingestFrom", "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${feed.name}, ${feed.url}, ${feed.kind}, ${feed.enabled}, ${feed.messageTemplate}, ${JSON.stringify(feed.targetIds)}::jsonb, ${feed.hashtags}, NOW(), NOW(), NOW())`;
    const rows = await tx.$queryRawUnsafe<Row[]>(`SELECT ${COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2`, id, actor.workspaceId);
    if (!rows[0]) throw unavailable();
    await audit(tx, actor, 'feeds.created', { feedId: id, name: feed.name, host: new URL(feed.url).hostname, targetCount: feed.targetIds.length });
    await lockActor(tx, actor, true);
    return toRecord(rows[0]);
  }));
}

export async function updateFeed(actor: ToolActor, input: unknown, deps: FeedDeps = {}) {
  const data = parse(FEED_UPDATE_SCHEMA, input);
  if (data.confirmation !== updateFeedConfirmation(data.id)) throw bad();
  const l = await bounds();
  const { id, confirmation: _c, ...rest } = data;
  let feed: FeedInput;
  try { feed = normalize(rest, l); } catch (error) { if (error instanceof OperationError) throw error; throw bad('Enter a valid feed address.'); }
  const auth = await authorizeWrite(actor);
  if (feed.targetIds.length) await (deps.validateTargets ?? defaultValidateTargets)(auth.actor, feed.targetIds, l.maxTargets);
  return protect(transact(actor.workspaceId, l, async tx => {
    const locked = await lockActor(tx, actor, true);
    const rows = await tx.$queryRawUnsafe<Row[]>(`SELECT ${COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2 FOR UPDATE`, id, actor.workspaceId);
    const current = rows[0];
    if (!current || !within(locked, idsOf(current.targetIds))) throw missing();
    const dup = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM feed_sources WHERE "workspaceId" = ${actor.workspaceId} AND url = ${feed.url} AND kind = ${feed.kind} AND id <> ${id} LIMIT 1`;
    if (dup[0]) throw new OperationError('conflict', 'A feed with this address already exists in the current workspace.');
    // A changed address starts a fresh conditional-request and error history.
    const addressChanged = current.url !== feed.url || current.kind !== feed.kind;
    await tx.$executeRaw`UPDATE feed_sources SET name = ${feed.name}, url = ${feed.url}, kind = ${feed.kind}, enabled = ${feed.enabled}, "messageTemplate" = ${feed.messageTemplate}, "targetIds" = ${JSON.stringify(feed.targetIds)}::jsonb, hashtags = ${feed.hashtags}, "lastEtag" = ${addressChanged ? null : current.lastEtag}, "lastModified" = ${addressChanged ? null : current.lastModified}, "lastError" = ${addressChanged ? null : current.lastError}, "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    const after = await tx.$queryRawUnsafe<Row[]>(`SELECT ${COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2`, id, actor.workspaceId);
    if (!after[0]) throw missing();
    await audit(tx, actor, 'feeds.updated', { feedId: id, name: feed.name, addressChanged, enabled: feed.enabled, targetCount: feed.targetIds.length });
    await lockActor(tx, actor, true);
    return toRecord(after[0]);
  }));
}

/** Deleting a feed removes its source and remembered items; drafts already created from it stay in Publishing. */
export async function deleteFeed(actor: ToolActor, input: unknown) {
  const data = parse(FEED_DELETE_SCHEMA, input);
  if (data.confirmation !== deleteFeedConfirmation(data.id)) throw bad();
  const l = await bounds(); await authorizeWrite(actor);
  return protect(transact(actor.workspaceId, l, async tx => {
    const auth = await lockActor(tx, actor, true);
    const rows = await tx.$queryRaw<Array<{ id: string; name: string; targetIds: unknown }>>`SELECT id, name, "targetIds" FROM feed_sources WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const row = rows[0];
    if (!row || !within(auth, idsOf(row.targetIds))) throw missing();
    // Posts keep their text; only the pointer back to the removed item is cleared.
    await tx.$executeRaw`UPDATE posts SET "sourceFeedItemId" = NULL WHERE "workspaceId" = ${actor.workspaceId} AND "sourceFeedItemId" IN (SELECT id FROM feed_items WHERE "feedSourceId" = ${row.id})`;
    const deleted = await tx.$executeRaw`DELETE FROM feed_sources WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (deleted !== 1) throw missing();
    await audit(tx, actor, 'feeds.deleted', { feedId: row.id, name: row.name });
    await lockActor(tx, actor, true);
    return { id: row.id, deleted: true as const };
  }));
}

const SAFE_ERRORS: Record<string, string> = {
  invalid_url: 'The feed address is not valid.', blocked_scheme: 'The feed address must use https.', blocked_host: 'This feed address cannot be read.', blocked_address: 'This feed address cannot be read.',
  not_allowlisted: 'This site is not allowed for feeds.', too_many_redirects: 'The feed redirected too many times.', too_large: 'The feed is larger than the allowed size.', timeout: 'The feed took too long to respond.',
  bad_status: 'The feed did not return a usable response.', unreachable: 'The feed could not be reached.',
};

/**
 * Read a feed now. Without `createDrafts` it only reports what a check found;
 * with the exact draft confirmation it creates one local draft per new, eligible
 * item. Nothing is scheduled or published by this operation.
 */
export async function checkFeed(actor: ToolActor, input: unknown, deps: FeedDeps = {}) {
  const data = parse(FEED_CHECK_SCHEMA, input);
  if (data.createDrafts && data.confirmation !== draftFeedConfirmation(data.id)) throw bad();
  if (!data.createDrafts && data.confirmation !== undefined) throw bad();
  const l = await bounds(); const net = deps.net ?? defaultFetchDeps(); const now = (deps.now ?? (() => new Date()))();
  const auth = await authorizeWrite(actor);
  const rows = await protect(prisma.$queryRawUnsafe<Row[]>(`SELECT ${COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2`, data.id, actor.workspaceId));
  const feed = rows[0];
  if (!feed || !within(auth, idsOf(feed.targetIds))) throw missing();
  if (!feed.enabled) throw new OperationError('conflict', 'This feed is turned off. Turn it on to check it.');
  if (feed.lastPolledAt && now.getTime() - feed.lastPolledAt.getTime() < l.minInterval * 1000) throw new OperationError('conflict', 'This feed was checked moments ago. Wait a little before checking again.');

  return ingestFeed(actor, feed, l, { createDrafts: Boolean(data.createDrafts), net, validate: deps.validateTargets ?? defaultValidateTargets });
}

export type IngestOptions = { createDrafts: boolean; net: FetchDeps; validate: NonNullable<FeedDeps['validateTargets']>; automatic?: boolean; onDraftStageFailure?: (error: unknown) => Promise<void> };
/**
 * Shared read-and-draft core for the manual check and the automatic poller. `actor` is the human
 * (manual) or the qualifying workspace owner (automatic); drafts are always local, never scheduled.
 */
export async function ingestFeed(actor: ToolActor, feed: FeedRow, l: FeedLimits, options: IngestOptions) {
  const { net } = options;
  const data = { createDrafts: options.createDrafts };
  let entries: FeedEntry[];
  let notModified = false;
  try {
    const target = feed.kind === 'wordpress' ? wordpressApiUrl(feed.url) : feed.url;
    const headers: Record<string, string> = { accept: feed.kind === 'wordpress' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9', 'user-agent': 'MSSocialPilot-Feeds/1.0' };
    if (feed.lastEtag) headers['if-none-match'] = feed.lastEtag;
    if (feed.lastModified) headers['if-modified-since'] = feed.lastModified;
    const fetched = await guardedFetch(target, policyOf(l), net, { headers, acceptNotModified: true });
    if (fetched.notModified) { notModified = true; entries = []; await recordPoll(actor, feed.id, null, null, null, 'ok'); }
    else {
      const text = fetched.bytes.toString('utf8');
      entries = feed.kind === 'wordpress' ? parseWordPressDocument(text, l.maxItems) : parseFeedDocument(text, l.maxItems);
      await recordPoll(actor, feed.id, fetched.etag, fetched.lastModified, null, 'ok');
    }
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    const safe = (reason && SAFE_ERRORS[reason]) || 'The feed could not be read.';
    await recordPoll(actor, feed.id, null, null, safe, 'error').catch(() => undefined);
    if (error instanceof OperationError) throw new OperationError(error.code, safe);
    throw new OperationError('upstream_failure', safe);
  }

  const guids = entries.map(e => e.guid);
  const known = guids.length ? await protect(prisma.$queryRaw<Array<{ guid: string }>>`SELECT guid FROM feed_items WHERE "feedSourceId" = ${feed.id} AND guid = ANY(${guids}::text[])`) : [];
  const seen = new Set(known.map(k => k.guid));
  const checked: CheckedEntry[] = entries.map(entry => ({
    guid: entry.guid, title: entry.title, link: entry.link, publishedAt: entry.publishedAt,
    message: renderMessage(feed.messageTemplate, entry, { hashtags: feed.hashtags, excerptChars: l.excerpt, maxChars: l.maxMessage }),
    isNew: !seen.has(entry.guid),
    // Items older than the subscription start are never ingested; undated items are treated as current.
    eligible: !seen.has(entry.guid) && (entry.publishedAt === null || entry.publishedAt.getTime() >= feed.ingestFrom.getTime()),
  }));
  const base = { feedId: feed.id, notModified, entries: checked.map(c => ({ ...c, publishedAt: c.publishedAt?.toISOString() ?? null })), draftsCreated: 0, destinations: idsOf(feed.targetIds).length };
  if (!data.createDrafts) return base;

  const targetIds = idsOf(feed.targetIds);
  const fresh = checked.filter(c => c.eligible && c.message.length > 0);
  if (!fresh.length) return base;
  let created: number;
  try {
    const authNow = await authorizeWrite(actor);
    if (targetIds.length) await options.validate(authNow.actor, targetIds, l.maxTargets);
    created = await protect(transact(actor.workspaceId, l, async tx => {
      await lockActor(tx, actor, true);
      const locked = await tx.$queryRaw<Array<{ enabled: boolean }>>`SELECT enabled FROM feed_sources WHERE id = ${feed.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!locked[0]) throw missing();
      if (!locked[0].enabled) throw new OperationError('conflict', 'This feed was turned off. Turn it on to create drafts.');
      if (options.automatic) {
        // Automatic runs act without a person watching: stop if the feed's channels changed after validation.
        const current = await tx.$queryRaw<Array<{ targetIds: unknown }>>`SELECT "targetIds" FROM feed_sources WHERE id = ${feed.id} AND "workspaceId" = ${actor.workspaceId}`;
        if (JSON.stringify(idsOf(current[0]?.targetIds)) !== JSON.stringify(targetIds)) throw new OperationError('conflict', 'This feed changed while it was being read.');
        if (targetIds.length) await options.validate((await authorizeWrite(actor)).actor, targetIds, l.maxTargets);
      }
      let count = 0;
      for (const item of fresh) {
        const itemId = `fit_${randomUUID()}`;
        // The unique (feed, guid) pair is the de-duplication guard: a concurrent check cannot double-create.
        const inserted = await tx.$executeRaw`INSERT INTO feed_items (id, "feedSourceId", guid, url, title, "publishedAt", "createdAt") VALUES (${itemId}, ${feed.id}, ${item.guid}, ${item.link}, ${item.title}, ${item.publishedAt}, NOW()) ON CONFLICT ("feedSourceId", guid) DO NOTHING`;
        if (inserted !== 1) continue;
        const postId = randomUUID();
        await tx.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, link, status, "sourceFeedItemId", "createdAt", "updatedAt") VALUES (${postId}, ${actor.workspaceId}, ${actor.userId}, ${item.message}, ${item.link}, 'draft'::"PostStatus", ${itemId}, NOW(), NOW())`;
        for (const targetId of targetIds) await tx.$executeRaw`INSERT INTO post_targets (id, "postId", "targetId", status, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${postId}, ${targetId}, 'pending'::"PostTargetStatus", NOW(), NOW())`;
        count += 1;
      }
      await audit(tx, actor, 'feeds.drafts_created', { feedId: feed.id, drafts: count, considered: fresh.length, ...(options.automatic ? { automatic: true } : {}) });
      await lockActor(tx, actor, true);
      return count;
    }));
  } catch (error) { await options.onDraftStageFailure?.(error).catch(() => undefined); throw error; }
  return { ...base, draftsCreated: created };
}

/** Poll bookkeeping: conditional-request validators and a safe, non-secret last error. */
async function recordPoll(actor: ToolActor, feedId: string, etag: string | null, modified: string | null, error: string | null, outcome: 'ok' | 'error') {
  if (outcome === 'ok') {
    await prisma.$executeRaw`UPDATE feed_sources SET "lastPolledAt" = NOW(), "lastEtag" = COALESCE(${etag}, "lastEtag"), "lastModified" = COALESCE(${modified}, "lastModified"), "lastError" = NULL, "pollErrorCount" = 0 WHERE id = ${feedId} AND "workspaceId" = ${actor.workspaceId}`;
  } else {
    await prisma.$executeRaw`UPDATE feed_sources SET "lastPolledAt" = NOW(), "lastError" = ${error}, "pollErrorCount" = "pollErrorCount" + 1 WHERE id = ${feedId} AND "workspaceId" = ${actor.workspaceId}`;
  }
}
