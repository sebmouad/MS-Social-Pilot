import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import type { FetchPolicy } from '@/modules/publishing/server/media/network/net-guard';
import { FEEDS_BOUNDS } from '../config';
import type { FeedHandling, FeedRecord } from '../feeds';
import { AUTHOR_ROLES, authorizeFeeds, type FeedActor, type FeedAuthorization } from './access';

/** Shared plumbing of the feeds services: Root bounds, the guarded transaction, locking, audit and row mapping. */
export type Tx = Prisma.TransactionClient;
export type FeedRow = {
  id: string; name: string; url: string; kind: string; enabled: boolean; messageTemplate: string; hashtags: string; targetIds: unknown;
  autoApprove: boolean; spreadMinutes: number; pollErrorCount: number;
  lastPolledAt: Date | null; lastError: string | null; lastEtag: string | null; lastModified: string | null; ingestFrom: Date; createdAt: Date; updatedAt: Date;
};
export const FEED_COLUMNS = `id, name, url, kind, enabled, "messageTemplate", hashtags, "targetIds", "autoApprove", "spreadMinutes", "pollErrorCount", "lastPolledAt", "lastError", "lastEtag", "lastModified", "ingestFrom", "createdAt", "updatedAt"`;

export const bad = (text = 'Choose valid feed details and confirm the exact action.') => new OperationError('invalid_request', text);
export const unavailable = () => new OperationError('unavailable', 'Content feeds are temporarily unavailable. Refresh and try again.');
export const missing = () => new OperationError('not_found', 'This feed is unavailable in the current workspace.');
export const parse = <S extends import('zod').ZodTypeAny>(schema: S, input: unknown): import('zod').output<S> => { const r = schema.safeParse(input); if (!r.success) throw bad(); return r.data; };
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= r.min && v <= r.max;
const isUnique = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && ((error as { code?: unknown }).code === 'P2002' || (error as { code?: unknown }).code === '23505'));

export async function protect<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; } catch (error) {
    if (error instanceof OperationError) throw error;
    if (isUnique(error)) throw new OperationError('conflict', 'A feed with this address already exists in the current workspace.');
    throw new OperationError('upstream_failure', 'The feed operation could not be confirmed. Refresh the list before trying again.');
  }
}

export type FeedLimits = Awaited<ReturnType<typeof bounds>>;
export async function bounds() {
  try {
    const keys = ['feeds.pageSize', 'feeds.maxPerWorkspace', 'feeds.fetchTimeoutMs', 'feeds.fetchMaxBytes', 'feeds.fetchMaxRedirects', 'feeds.allowHttp', 'feeds.hostAllowlist', 'feeds.maxItemsPerCheck', 'feeds.maxTargets', 'feeds.messageMaxCharacters', 'feeds.nameMaxCharacters', 'feeds.minCheckIntervalSeconds', 'feeds.excerptCharacters', 'feeds.transactionTimeoutMs', 'feeds.transactionMaxWaitMs', 'data.workspaceOperationTimeoutMs', 'feeds.maxSpreadMinutes', 'feeds.queueLookaheadDays', 'feeds.fallbackDelayMinutes', 'feeds.fallbackSpacingMinutes', 'feeds.autoCheck.maxItemsPerFeed'] as const;
    const [pageSize, maxFeeds, fetchTimeout, fetchMax, redirects, allowHttp, allowlist, maxItems, maxTargets, maxMessage, maxName, minInterval, excerpt, timeout, maxWait, workspaceTimeout, maxSpread, lookaheadDays, fallbackDelay, fallbackSpacing, itemsPerRun] = await Promise.all(keys.map(key => runtimeConfig(key)));
    const B = FEEDS_BOUNDS;
    if (!inRange(pageSize, B.pageSize) || !inRange(maxFeeds, B.maxPerWorkspace) || !inRange(fetchTimeout, B.fetchTimeoutMs) || !inRange(fetchMax, B.fetchMaxBytes) || !inRange(redirects, B.fetchMaxRedirects) || !inRange(maxItems, B.maxItemsPerCheck)
      || !inRange(maxTargets, B.maxTargets) || !inRange(maxMessage, B.messageMaxCharacters) || !inRange(maxName, B.nameMaxCharacters) || !inRange(minInterval, B.minCheckIntervalSeconds) || !inRange(excerpt, B.excerptCharacters)
      || !inRange(timeout, B.transactionTimeoutMs) || !inRange(maxWait, B.transactionMaxWaitMs) || !inRange(workspaceTimeout, B.workspaceTimeoutMs) || !inRange(maxSpread, B.maxSpreadMinutes) || !inRange(lookaheadDays, B.queueLookaheadDays)
      || !inRange(fallbackDelay, B.fallbackDelayMinutes) || !inRange(fallbackSpacing, B.fallbackSpacingMinutes) || !inRange(itemsPerRun, B.autoCheckMaxItemsPerFeed)
      || typeof allowHttp !== 'boolean' || !Array.isArray(allowlist) || timeout + maxWait >= workspaceTimeout) throw unavailable();
    return { pageSize, maxFeeds, fetchTimeout, fetchMax, redirects, allowHttp, allowlist: allowlist as string[], maxItems, maxTargets, maxMessage, maxName, minInterval, excerpt, timeout, maxWait, maxSpread, lookaheadDays, fallbackDelay, fallbackSpacing, itemsPerRun };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}
export const policyOf = (l: FeedLimits): FetchPolicy => ({ timeoutMs: l.fetchTimeout, maxBytes: l.fetchMax, maxRedirects: l.redirects, allowHttp: l.allowHttp, hostAllowlist: l.allowlist });

/** One guarded workspace transaction under the workspace advisory lock (the same key Publishing's queue takes). */
export async function transact<T>(workspaceId: string, l: FeedLimits, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: l.timeout, maxWait: l.maxWait }));
}
/** Re-check the member row (locked) and the feature grant inside the transaction. */
export async function lockActor(tx: Tx, actor: FeedActor, write: boolean): Promise<FeedAuthorization> {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  if (!rows[0] || rows[0].disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  const auth = await authorizeFeeds(actor, write ? 'write' : 'read');
  if (write && !AUTHOR_ROLES.has(auth.role)) throw new OperationError('forbidden', 'You do not have permission to manage feeds.');
  return auth;
}
/** `actor` null records a system action (the automatic worker) instead of claiming a person clicked a button. */
export async function audit(tx: Tx, workspaceId: string, actor: FeedActor | null, action: string, detail: object) {
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, ${actor?.userId ?? null}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (count !== 1) throw unavailable();
}

export const idsOf = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
/**
 * A scoped member sees and manages only feeds whose channels are all inside their grant. A feed that names
 * no channel belongs to the whole workspace, so a channel-limited member (or key) never touches it.
 */
export const within = (auth: FeedAuthorization, ids: readonly string[]) => auth.actor.allowedTargetIds === undefined || (ids.length > 0 && ids.every(id => auth.actor.allowedTargetIds!.includes(id)));
export function toRecord(row: FeedRow): FeedRecord {
  const handling: FeedHandling = row.autoApprove ? 'schedule' : 'review';
  return { id: row.id, name: row.name, url: row.url, kind: row.kind === 'wordpress' ? 'wordpress' : 'rss', enabled: row.enabled, messageTemplate: row.messageTemplate, hashtags: row.hashtags, targetIds: idsOf(row.targetIds), handling, spreadMinutes: Number(row.spreadMinutes) || 0, failureCount: Number(row.pollErrorCount) || 0, lastPolledAt: row.lastPolledAt, lastError: row.lastError, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
