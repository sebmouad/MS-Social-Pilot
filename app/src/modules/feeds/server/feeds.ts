import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { checkUrlShape, defaultFetchDeps, type FetchDeps } from '@/modules/publishing/server/media/network/net-guard';
import {
  createFeedConfirmation, deleteFeedConfirmation, draftFeedConfirmation, feedCheckSchema, feedCreateSchema, feedDeleteSchema, feedListSchema, feedUpdateSchema,
  postFeedConfirmation, updateFeedConfirmation, type FeedCheckMode, type FeedInput,
} from '../feeds';
import { authorizeFeedWrite, authorizeFeeds, type FeedActor } from './access';
import { audit, bad, bounds, FEED_COLUMNS, idsOf, lockActor, missing, parse, protect, toRecord, transact, unavailable, within, type FeedLimits, type FeedRow } from './core';
import { defaultPorts, ingestFeed, type FeedPorts } from './ingest';
import { feedsError } from './messages';

export type { FeedLimits, FeedRow } from './core';
export type FeedDeps = { net?: FetchDeps; validateTargets?: FeedPorts['validate']; resolveFormats?: FeedPorts['formats']; now?: () => Date };
export { bounds } from './core';

/** Destination validation for saved settings: the shared Publishing rules (scope, enabled, provider capability). */
async function validateSaved(deps: FeedDeps, actor: FeedActor, ids: string[], max: number) {
  const ports = await defaultPorts(deps.net ?? defaultFetchDeps());
  await (deps.validateTargets ?? ports.validate)(actor, ids, max, null, false);
}

export async function readFeeds(actor: FeedActor, input: unknown = {}) {
  const l = await bounds();
  const query = await parse(feedListSchema(l.pageNumberMax), input);
  const auth = await authorizeFeeds(actor, 'read');
  const page = query.page ?? 1;
  return protect((async () => {
    const rows = await prisma.$queryRawUnsafe<FeedRow[]>(`SELECT ${FEED_COLUMNS} FROM feed_sources WHERE "workspaceId" = $1 ORDER BY name ASC, id ASC LIMIT $2`, actor.workspaceId, l.maxFeeds + l.listScanMargin);
    const visible = rows.map(toRecord).filter(feed => within(auth, feed.targetIds));
    const window = visible.slice((page - 1) * l.pageSize, page * l.pageSize + 1);
    return { feeds: window.slice(0, l.pageSize), page, pageSize: l.pageSize, hasMore: window.length > l.pageSize, limits: { maxNameCharacters: l.maxName, maxMessageCharacters: l.maxMessage, maxTargets: l.maxTargets, maxSpreadMinutes: l.maxSpread }, scopedView: auth.actor.allowedTargetIds !== undefined };
  })());
}

async function normalize(input: FeedInput, l: FeedLimits, scoped: boolean): Promise<FeedInput> {
  if (input.name.length > l.maxName || input.messageTemplate.length > l.maxMessage || input.targetIds.length > l.maxTargets || new Set(input.targetIds).size !== input.targetIds.length || input.spreadMinutes > l.maxSpread) throw await bad();
  // A member limited to some channels must name at least one: a feed with no channels belongs to the whole workspace.
  if (scoped && input.targetIds.length === 0) throw await bad('Choose at least one channel for this feed.');
  const url = checkUrlShape(input.url, { allowHttp: l.allowHttp, hostAllowlist: l.allowlist }).toString();
  return { ...input, url };
}
const normalizeOrBad = async (input: FeedInput, l: FeedLimits, scoped: boolean) => {
  try { return await normalize(input, l, scoped); } catch (error) { if (error instanceof OperationError) throw error; throw await bad('Enter a valid feed address.'); }
};

export async function createFeed(actor: FeedActor, input: unknown, deps: FeedDeps = {}) {
  const l = await bounds();
  const data = await parse(feedCreateSchema({ maxName: l.maxName, maxUrl: l.maxUrl, maxMessage: l.maxMessage, maxHashtags: l.maxHashtags, maxTargets: l.maxTargets, maxIdentifier: l.maxIdentifier, maxSpread: l.maxSpread }), input);
  if (data.confirmation !== createFeedConfirmation(data.name)) throw await bad();
  const { confirmation: _c, ...rest } = data;
  const auth = await authorizeFeedWrite(actor);
  const feed = await normalizeOrBad(rest, l, auth.actor.allowedTargetIds !== undefined);
  if (feed.targetIds.length) await validateSaved(deps, auth.actor, feed.targetIds, l.maxTargets);
  return protect(transact(actor.workspaceId, l, async tx => {
    await lockActor(tx, actor, true);
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM feed_sources WHERE "workspaceId" = ${actor.workspaceId}`;
    if (Number(count[0]?.count ?? 0) >= l.maxFeeds) throw await feedsError('conflict', 'This workspace has reached its feed limit.');
    const dup = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM feed_sources WHERE "workspaceId" = ${actor.workspaceId} AND url = ${feed.url} AND kind = ${feed.kind} LIMIT 1`;
    if (dup[0]) throw await feedsError('conflict', 'A feed with this address already exists in the current workspace.');
    const id = `feed_${randomUUID()}`;
    await tx.$executeRaw`INSERT INTO feed_sources (id, "workspaceId", name, url, kind, enabled, "messageTemplate", "targetIds", hashtags, "autoApprove", "spreadMinutes", "ingestFrom", "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${feed.name}, ${feed.url}, ${feed.kind}, ${feed.enabled}, ${feed.messageTemplate}, ${JSON.stringify(feed.targetIds)}::jsonb, ${feed.hashtags}, ${feed.handling === 'schedule'}, ${feed.spreadMinutes}, NOW(), NOW(), NOW())`;
    const rows = await tx.$queryRawUnsafe<FeedRow[]>(`SELECT ${FEED_COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2`, id, actor.workspaceId);
    if (!rows[0]) throw await unavailable();
    await audit(tx, actor.workspaceId, actor, 'feeds.created', { feedId: id, name: feed.name, host: new URL(feed.url).hostname, targetCount: feed.targetIds.length, handling: feed.handling });
    await lockActor(tx, actor, true);
    return toRecord(rows[0]);
  }));
}

export async function updateFeed(actor: FeedActor, input: unknown, deps: FeedDeps = {}) {
  const l = await bounds();
  const data = await parse(feedUpdateSchema({ maxName: l.maxName, maxUrl: l.maxUrl, maxMessage: l.maxMessage, maxHashtags: l.maxHashtags, maxTargets: l.maxTargets, maxIdentifier: l.maxIdentifier, maxSpread: l.maxSpread }), input);
  if (data.confirmation !== updateFeedConfirmation(data.id)) throw await bad();
  const { id, confirmation: _c, ...rest } = data;
  const auth = await authorizeFeedWrite(actor);
  const feed = await normalizeOrBad(rest, l, auth.actor.allowedTargetIds !== undefined);
  if (feed.targetIds.length) await validateSaved(deps, auth.actor, feed.targetIds, l.maxTargets);
  return protect(transact(actor.workspaceId, l, async tx => {
    const locked = await lockActor(tx, actor, true);
    const rows = await tx.$queryRawUnsafe<FeedRow[]>(`SELECT ${FEED_COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2 FOR UPDATE`, id, actor.workspaceId);
    const current = rows[0];
    if (!current || !within(locked, idsOf(current.targetIds))) throw await missing();
    const dup = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM feed_sources WHERE "workspaceId" = ${actor.workspaceId} AND url = ${feed.url} AND kind = ${feed.kind} AND id <> ${id} LIMIT 1`;
    if (dup[0]) throw await feedsError('conflict', 'A feed with this address already exists in the current workspace.');
    // A changed address starts a fresh conditional-request and error history; turning a feed on again clears its failure count.
    const addressChanged = current.url !== feed.url || current.kind !== feed.kind;
    const reset = addressChanged || (feed.enabled && !current.enabled);
    await tx.$executeRaw`UPDATE feed_sources SET name = ${feed.name}, url = ${feed.url}, kind = ${feed.kind}, enabled = ${feed.enabled}, "messageTemplate" = ${feed.messageTemplate}, "targetIds" = ${JSON.stringify(feed.targetIds)}::jsonb, hashtags = ${feed.hashtags}, "autoApprove" = ${feed.handling === 'schedule'}, "spreadMinutes" = ${feed.spreadMinutes}, "lastEtag" = ${addressChanged ? null : current.lastEtag}, "lastModified" = ${addressChanged ? null : current.lastModified}, "lastError" = ${reset ? null : current.lastError}, "pollErrorCount" = ${reset ? 0 : current.pollErrorCount}, "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    const after = await tx.$queryRawUnsafe<FeedRow[]>(`SELECT ${FEED_COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2`, id, actor.workspaceId);
    if (!after[0]) throw await missing();
    await audit(tx, actor.workspaceId, actor, 'feeds.updated', { feedId: id, name: feed.name, addressChanged, enabled: feed.enabled, targetCount: feed.targetIds.length, handling: feed.handling });
    await lockActor(tx, actor, true);
    return toRecord(after[0]);
  }));
}

/** Deleting a feed removes its source and remembered items; posts already created from it stay in Publishing. */
export async function deleteFeed(actor: FeedActor, input: unknown) {
  const l = await bounds();
  const data = await parse(feedDeleteSchema(l.maxIdentifier), input);
  if (data.confirmation !== deleteFeedConfirmation(data.id)) throw await bad();
  await authorizeFeedWrite(actor);
  return protect(transact(actor.workspaceId, l, async tx => {
    const auth = await lockActor(tx, actor, true);
    const rows = await tx.$queryRaw<Array<{ id: string; name: string; targetIds: unknown }>>`SELECT id, name, "targetIds" FROM feed_sources WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const row = rows[0];
    if (!row || !within(auth, idsOf(row.targetIds))) throw await missing();
    // Posts keep their text; only the pointer back to the removed item is cleared.
    await tx.$executeRaw`UPDATE posts SET "sourceFeedItemId" = NULL WHERE "workspaceId" = ${actor.workspaceId} AND "sourceFeedItemId" IN (SELECT id FROM feed_items WHERE "feedSourceId" = ${row.id})`;
    const deleted = await tx.$executeRaw`DELETE FROM feed_sources WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (deleted !== 1) throw await missing();
    await audit(tx, actor.workspaceId, actor, 'feeds.deleted', { feedId: row.id, name: row.name });
    await lockActor(tx, actor, true);
    return { id: row.id, deleted: true as const };
  }));
}

const modeOf = (data: { mode?: FeedCheckMode | undefined; createDrafts?: boolean | undefined }): FeedCheckMode => data.mode ?? (data.createDrafts ? 'drafts' : 'preview');

/**
 * Read a feed now. `preview` only reports what a check found. `drafts` creates one local draft per new
 * item and `posts` queues them as the feed is set up (held for approval where the feed or workspace asks);
 * both need their exact confirmation. Nothing is published by this operation.
 */
export async function checkFeed(actor: FeedActor, input: unknown, deps: FeedDeps = {}) {
  const l = await bounds();
  const data = await parse(feedCheckSchema(l.maxIdentifier), input);
  const mode = modeOf(data);
  if (data.mode !== undefined && data.createDrafts !== undefined && (data.createDrafts !== (data.mode === 'drafts'))) throw await bad();
  if (mode === 'drafts' && data.confirmation !== draftFeedConfirmation(data.id)) throw await bad();
  if (mode === 'posts' && data.confirmation !== postFeedConfirmation(data.id)) throw await bad();
  if (mode === 'preview' && data.confirmation !== undefined) throw await bad();
  const now = (deps.now ?? (() => new Date()))();
  const ports = await defaultPorts(deps.net ?? defaultFetchDeps());
  if (deps.validateTargets) ports.validate = deps.validateTargets;
  if (deps.resolveFormats) ports.formats = deps.resolveFormats;
  else if (deps.validateTargets) ports.formats = async targets => Object.fromEntries(targets.map(t => [t.id, 'post']));
  const auth = await authorizeFeedWrite(actor);
  const rows = await protect(prisma.$queryRawUnsafe<FeedRow[]>(`SELECT ${FEED_COLUMNS} FROM feed_sources WHERE id = $1 AND "workspaceId" = $2`, data.id, actor.workspaceId));
  const feed = rows[0];
  if (!feed || !within(auth, idsOf(feed.targetIds))) throw await missing();
  if (!feed.enabled) throw await feedsError('conflict', 'This feed is turned off. Turn it on to check it.');
  if (feed.lastPolledAt && now.getTime() - feed.lastPolledAt.getTime() < l.minInterval * 1000) throw await feedsError('conflict', 'This feed was checked moments ago. Wait a little before checking again.');
  return ingestFeed(auth.actor, feed, actor.workspaceId, l, { mode, ports, now });
}
