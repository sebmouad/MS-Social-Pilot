import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { configuredFacebookEngine } from '@/platforms/facebook/runtime';
import { runtimeConfig } from '@/server/config/store';
import { Prisma } from '../../../generated/client';
import { withRetries } from '@/server/jobs/retry';
import type { RetryBackoff } from '@/server/jobs/retry';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { lockInboxChannel, inboxCommentSuppressed, orderInboxCommentBatch } from '@/modules/inbox/server/comment-guard';
import { inboxSyncBounds } from '@/modules/inbox/server/sync-bounds';
import { lockPublishingTargets } from '@/modules/publishing/server/guard';
import { assertNoPostDeletionForRemoteIdentity } from '@/modules/publishing/server/post-deletion-guard';
import type { JobSummary } from '@/server/jobs/types';
import { OperationError } from '@/lib/operation-error';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { withSelectedResourceOperation } from '@/server/platforms/resource-lock';
import type { FeatureId } from '@/lib/product';
import { FACEBOOK_ANALYTICS_LOOKBACK_DAYS_SCHEMA } from './module';

const jobFeatures = {
  publishing: ['publishing/posts'],
  analytics: ['analytics/overview'],
  ads: ['analytics/overview', 'ads/overview'],
  inbox: ['inbox/conversations'],
} satisfies Record<string, FeatureId[]>;

function isAccessDenied(error: unknown): boolean { return error instanceof OperationError && ['forbidden', 'not_found', 'conflict'].includes(error.code); }
function granted(scopes: string | null | undefined, required: string[]): boolean {
  const actual = new Set((scopes ?? '').split(',').map(scope => scope.trim()).filter(Boolean));
  return required.length > 0 && required.every(scope => actual.has(scope));
}
function usable(account: { workspaceId: string; invalidatedAt: Date | null; tokenExpiresAt: Date | null; accessToken: string | null }, workspaceId: string, now: Date): boolean {
  return account.workspaceId === workspaceId && !account.invalidatedAt && (!account.tokenExpiresAt || account.tokenExpiresAt > now) && !!account.accessToken;
}
function currentTime(jobTime: Date): Date { return new Date(Math.max(jobTime.getTime(), Date.now())); }
async function readLookbackDays(key: 'meta.pageAnalyticsLookbackDays' | 'meta.adsAnalyticsLookbackDays'): Promise<number> {
  const value = FACEBOOK_ANALYTICS_LOOKBACK_DAYS_SCHEMA.safeParse(await runtimeConfig(key));
  if (!value.success) throw new OperationError('unavailable', 'Facebook analytics sync settings are unavailable.');
  return value.data;
}
async function assertFacebookJobAccess(workspaceId: string, anyFeatureOf: FeatureId[]): Promise<void> {
  if (await runtimeConfig('platforms.facebook.enabled') !== true) throw new OperationError('forbidden', 'Facebook jobs are disabled.');
  await assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf });
}

const DAY_MS = 86_400_000;
type FairRow = { id: string };
type FacebookComments = Awaited<ReturnType<Awaited<ReturnType<typeof configuredFacebookEngine>>['listComments']>>;
async function fairBatch<Row extends FairRow>(key: string, limit: number, find: (cursor: string | null, direction: 'after' | 'before', take: number) => Promise<Row[]>): Promise<Row[]> {
  const settingKey = `sync.cursor.${key}`;
  const saved = await prisma.appSetting.findUnique({ where: { key: settingKey }, select: { value: true } });
  const cursor = typeof saved?.value === 'string' ? saved.value : null;
  let rows = await find(cursor, 'after', limit);
  if (cursor && rows.length < limit) rows = rows.concat(await find(cursor, 'before', limit - rows.length));
  if (rows.length) await prisma.appSetting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: rows[rows.length - 1].id, encrypted: false, updatedAt: new Date() }, update: { value: rows[rows.length - 1].id, encrypted: false, updatedAt: new Date() } });
  return rows;
}
const finite = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
function validDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Refresh provider-side scheduled posts that already have remote IDs. */
export async function syncScheduledPostStatus(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  if (await runtimeConfig('platforms.facebook.enabled') !== true) return { examined: 0, updated: 0, skipped: 0, failed: 0 };
  const limit = await runtimeConfig('sync.maxItemsPerJob') as number;
  const rows = await prisma.postTarget.findMany({
    where: { status: 'scheduled_remote', remotePostId: { not: null }, target: { enabled: true, type: 'page', socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } } },
    orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], take: limit,
    select: { id: true, postId: true, remotePostId: true, post: { select: { workspaceId: true, media: true } }, target: { select: { id: true, workspaceId: true, providerId: true } } },
  });
  const result: JobSummary = { examined: rows.length, updated: 0, skipped: 0, failed: 0 };
  if (!rows.length) return result;
  for (const row of rows) {
    if (!row.remotePostId || row.post.workspaceId !== row.target.workspaceId) { result.skipped++; continue; }
    try {
      await withWorkspaceOperation(row.target.workspaceId, async () => {
        const outcome = await withSelectedResourceOperation(row.target.workspaceId, { kind: 'target', id: row.target.id }, async (tx, signal) => {
          signal.throwIfAborted();
          const postKey = JSON.stringify(['publishing-post', row.target.workspaceId, row.postId]);
          const postLock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${postKey}, 0)) AS acquired`;
          if (postLock[0]?.acquired !== true) return { updated: 0, skipped: 1 };
          await lockPublishingTargets(tx, row.target.workspaceId, [row.target.id]);
          await assertNoPostDeletionForRemoteIdentity(tx, row.target.workspaceId, row.target.id, row.remotePostId!);
          const readStatus = async () => {
            await assertFacebookJobAccess(row.target.workspaceId, jobFeatures.publishing);
            const fresh = await prisma.postTarget.findFirst({ where: { id: row.id, postId: row.postId, status: 'scheduled_remote', remotePostId: row.remotePostId, post: { workspaceId: row.target.workspaceId }, target: { workspaceId: row.target.workspaceId, id: row.target.id, type: 'page', enabled: true, providerId: row.target.providerId, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } } }, select: { remotePostId: true, target: { select: { workspaceId: true, enabled: true, providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } } } });
            const freshAccount = fresh?.target.socialAccount;
            const scopes = ((await runtimeConfig('meta.postReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
            if (!fresh || fresh.remotePostId !== row.remotePostId || fresh.target.workspaceId !== row.target.workspaceId || !fresh.target.enabled || fresh.target.providerId !== row.target.providerId || !freshAccount || !usable(freshAccount, row.target.workspaceId, currentTime(now)) || !granted(freshAccount.scopes, scopes) || !fresh.target.accessToken && !freshAccount.accessToken) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
            signal.throwIfAborted();
            const engine = await configuredFacebookEngine({ signal });
            const media = row.post.media;
            const contentKind = Array.isArray(media) && media.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'video') ? 'video' : Array.isArray(media) && media.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'image') ? 'image' : 'text';
            return engine.getStatus(decryptSecret(fresh.target.accessToken ?? freshAccount.accessToken), fresh.remotePostId!, { targetId: row.target.providerId, contentKind });
          };
          const status = await withRetries(readStatus, retryLimit, retryBackoff);
          if (status.state !== 'published') return { updated: 0, skipped: 1 };
          signal.throwIfAborted();
          await assertFacebookJobAccess(row.target.workspaceId, jobFeatures.publishing);
          const stillBound = await prisma.postTarget.findFirst({ where: { id: row.id, postId: row.postId, status: 'scheduled_remote', remotePostId: row.remotePostId, post: { workspaceId: row.target.workspaceId }, target: { workspaceId: row.target.workspaceId, enabled: true, providerId: row.target.providerId, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } } }, select: { id: true, remotePostId: true, target: { select: { accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } } } });
          const currentScopes = ((await runtimeConfig('meta.postReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
          if (!stillBound || stillBound.remotePostId !== row.remotePostId || !stillBound.target.socialAccount || !usable(stillBound.target.socialAccount, row.target.workspaceId, currentTime(now)) || !granted(stillBound.target.socialAccount.scopes, currentScopes) || !stillBound.target.accessToken && !stillBound.target.socialAccount.accessToken) return { updated: 0, skipped: 1 };
          const changed = await tx.postTarget.updateMany({
            where: { id: row.id, postId: row.postId, targetId: row.target.id, status: 'scheduled_remote', remotePostId: row.remotePostId, post: { workspaceId: row.target.workspaceId } },
            data: { status: 'published', ...(status.publishedAt ? { publishedAt: status.publishedAt } : { publishedAt: now }) },
          });
          if (!changed.count) return { updated: 0, skipped: 0 };
          const counts = await tx.postTarget.groupBy({ by: ['status'], where: { postId: row.postId, post: { workspaceId: row.target.workspaceId } }, _count: true });
          const total = counts.reduce((sum, item) => sum + item._count, 0);
          const published = counts.find(item => item.status === 'published')?._count ?? 0;
          const remote = counts.find(item => item.status === 'scheduled_remote')?._count ?? 0;
          const failed = counts.find(item => item.status === 'failed')?._count ?? 0;
          const processing = counts.find(item => item.status === 'processing')?._count ?? 0;
          const nextStatus = processing ? (published + remote > 0 ? 'partially_failed' : 'publishing') : (published + remote === total ? (remote ? 'scheduled' : 'published') : published ? 'partially_failed' : failed ? 'failed' : undefined);
          if (nextStatus) await tx.post.updateMany({ where: { id: row.postId, workspaceId: row.target.workspaceId }, data: { status: nextStatus, ...(published && !remote ? { publishedAt: now } : {}), updatedAt: now } });
          signal.throwIfAborted();
          await assertFacebookJobAccess(row.target.workspaceId, jobFeatures.publishing);
          const finalBinding = await tx.postTarget.findFirst({ where: { id: row.id, postId: row.postId, status: 'published', remotePostId: row.remotePostId, post: { workspaceId: row.target.workspaceId }, target: { workspaceId: row.target.workspaceId, enabled: true, providerId: row.target.providerId, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } } }, select: { id: true, target: { select: { accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } } } });
          const finalScopes = ((await runtimeConfig('meta.postReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
          if (!finalBinding?.target.socialAccount || !usable(finalBinding.target.socialAccount, row.target.workspaceId, currentTime(now)) || !granted(finalBinding.target.socialAccount.scopes, finalScopes) || !finalBinding.target.accessToken && !finalBinding.target.socialAccount.accessToken) throw new OperationError('forbidden', 'Facebook job access changed before status persistence completed.');
          return { updated: 1, skipped: 0 };
        });
        result.updated += outcome.updated;
        result.skipped += outcome.skipped;
      });
    } catch (error) {
      if (isAccessDenied(error) || (error instanceof OperationError && error.code === 'conflict')) result.skipped++;
      else result.failed++;
    }
  }
  return result;
}

/** Refresh current daily Page snapshots for enabled connections in their own workspace. */
export async function syncPageAnalytics(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  if (await runtimeConfig('platforms.facebook.enabled') !== true) return { examined: 0, updated: 0, skipped: 0, failed: 0 };
  const limit = await runtimeConfig('sync.maxItemsPerJob') as number;
  const targetWhere = { type: 'page' as const, enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } };
  const targets = await fairBatch('page-analytics', limit, (cursor, direction, take) => prisma.target.findMany({
    where: { AND: [targetWhere, ...(cursor ? [{ id: { [direction === 'after' ? 'gt' : 'lte']: cursor } }] : [])] },
    orderBy: { id: 'asc' }, take,
    select: { id: true, workspaceId: true, providerId: true },
  }));
  const result: JobSummary = { examined: targets.length, updated: 0, skipped: 0, failed: 0 };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const target of targets) {
    try {
      await withWorkspaceOperation(target.workspaceId, async () => {
        const outcome = await withSelectedResourceOperation(target.workspaceId, { kind: 'target', id: target.id }, async (tx, signal) => {
          let persistedCount = 0;
          let failedMetrics = 0;
          const observations = await withRetries(async () => {
            await assertFacebookJobAccess(target.workspaceId, jobFeatures.analytics);
            const fresh = await prisma.target.findFirst({ where: { id: target.id, workspaceId: target.workspaceId, providerId: target.providerId, type: 'page', enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
            const scopes = ((await runtimeConfig('meta.pageInsightReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
            if (!fresh?.socialAccount || !usable(fresh.socialAccount, target.workspaceId, currentTime(now)) || !granted(fresh.socialAccount.scopes, scopes) || !fresh.accessToken && !fresh.socialAccount.accessToken) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
            signal.throwIfAborted();
            const engine = await configuredFacebookEngine({ signal });
            const lookbackDays = await readLookbackDays('meta.pageAnalyticsLookbackDays');
            const since = new Date(today.getTime() - (lookbackDays - 1) * DAY_MS);
            return engine.getPageInsightObservations(decryptSecret(fresh.accessToken ?? fresh.socialAccount.accessToken), fresh.providerId, since, now);
          }, retryLimit, retryBackoff);
          if (observations.failedMetrics?.length) failedMetrics++;
          await assertFacebookJobAccess(target.workspaceId, jobFeatures.analytics);
          const stillBound = await prisma.target.findFirst({ where: { id: target.id, workspaceId: target.workspaceId, providerId: target.providerId, type: 'page', enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { id: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
          const currentScopes = ((await runtimeConfig('meta.pageInsightReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
          if (!stillBound?.socialAccount || !usable(stillBound.socialAccount, target.workspaceId, currentTime(now)) || !granted(stillBound.socialAccount.scopes, currentScopes) || !stillBound.accessToken && !stillBound.socialAccount.accessToken) return { updated: 0, skipped: 1, failed: 0 };
          for (const { metric, period, endTime, value, numeric } of observations) {
            signal.throwIfAborted();
            await tx.pageInsight.upsert({
              where: { targetId_metric_period_endTime: { targetId: target.id, metric, period, endTime } },
              create: { id: `rebuild_${randomUUID()}`, targetId: target.id, metric, period, endTime, value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue, numeric, fetchedAt: now },
              update: { value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue, numeric, fetchedAt: now },
            });
            persistedCount++;
          }
        signal.throwIfAborted();
        await assertFacebookJobAccess(target.workspaceId, jobFeatures.analytics);
        const finalBinding = await prisma.target.findFirst({ where: { id: target.id, workspaceId: target.workspaceId, providerId: target.providerId, type: 'page', enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
        const finalScopes = ((await runtimeConfig('meta.pageInsightReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
        if (!finalBinding?.socialAccount || !usable(finalBinding.socialAccount, target.workspaceId, currentTime(now)) || !granted(finalBinding.socialAccount.scopes, finalScopes) || !finalBinding.accessToken && !finalBinding.socialAccount.accessToken) throw new OperationError('forbidden', 'Facebook job access changed before analytics persistence completed.');
          return { updated: persistedCount, skipped: 0, failed: failedMetrics };
        });
        result.updated += outcome.updated;
        result.skipped += outcome.skipped;
        result.failed += outcome.failed;
      });
    } catch (error) { if (isAccessDenied(error)) result.skipped++; else result.failed++; }
  }
  return result;
}

/** Refresh account-level Ads Insights for each enabled account in its own workspace. */
export async function syncAdsAnalytics(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  if (await runtimeConfig('platforms.facebook.enabled') !== true) return { examined: 0, updated: 0, skipped: 0, failed: 0 };
  const limit = await runtimeConfig('sync.maxItemsPerJob') as number;
  const accountWhere = { enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } };
  const accounts = await fairBatch('ads-analytics', limit, (cursor, direction, take) => prisma.adAccount.findMany({
    where: { AND: [accountWhere, ...(cursor ? [{ id: { [direction === 'after' ? 'gt' : 'lte']: cursor } }] : [])] },
    orderBy: { id: 'asc' }, take,
    select: { id: true, workspaceId: true, actId: true, name: true },
  }));
  const result: JobSummary = { examined: accounts.length, updated: 0, skipped: 0, failed: 0 };
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const account of accounts) {
    try {
      await withWorkspaceOperation(account.workspaceId, async () => {
        const outcome = await withSelectedResourceOperation(account.workspaceId, { kind: 'adAccount', id: account.id }, async (tx, signal) => {
          let persistedCount = 0;
          const rows = await withRetries(async () => {
            await assertFacebookJobAccess(account.workspaceId, jobFeatures.ads);
            const fresh = await prisma.adAccount.findFirst({ where: { id: account.id, workspaceId: account.workspaceId, actId: account.actId, enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { actId: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
            const scopes = ((await runtimeConfig('meta.adsReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
            if (!fresh?.socialAccount || !usable(fresh.socialAccount, account.workspaceId, currentTime(now)) || !granted(fresh.socialAccount.scopes, scopes)) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
            signal.throwIfAborted();
            const engine = await configuredFacebookEngine({ signal });
            const lookbackDays = await readLookbackDays('meta.adsAnalyticsLookbackDays');
            const since = new Date(until.getTime() - (lookbackDays - 1) * DAY_MS);
            return engine.getAdInsights(decryptSecret(fresh.socialAccount.accessToken), fresh.actId, since, until);
          }, retryLimit, retryBackoff);
          await assertFacebookJobAccess(account.workspaceId, jobFeatures.ads);
          const stillBound = await prisma.adAccount.findFirst({ where: { id: account.id, workspaceId: account.workspaceId, actId: account.actId, enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { id: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
          const currentScopes = ((await runtimeConfig('meta.adsReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
          if (!stillBound?.socialAccount || !usable(stillBound.socialAccount, account.workspaceId, currentTime(now)) || !granted(stillBound.socialAccount.scopes, currentScopes)) return { updated: 0, skipped: 1 };
          for (const row of rows) {
            signal.throwIfAborted();
            const date = validDate(row.date_start);
            if (!date) continue;
            const objectId = typeof row.account_id === 'string' ? row.account_id : account.actId;
            const objectName = typeof row.account_name === 'string' ? row.account_name : account.name;
            const spend = finite(row.spend) ?? 0;
            const impressions = Math.max(0, Math.trunc(finite(row.impressions) ?? 0));
            const clicks = Math.max(0, Math.trunc(finite(row.clicks) ?? 0));
            const reach = Math.max(0, Math.trunc(finite(row.reach) ?? 0));
            const cpc = finite(row.cpc); const cpm = finite(row.cpm); const cpp = finite(row.cpp); const ctr = finite(row.ctr); const frequency = finite(row.frequency);
            await tx.adInsight.upsert({
              where: { adAccountId_level_objectId_date: { adAccountId: account.id, level: 'account', objectId, date } },
              create: { id: `rebuild_${randomUUID()}`, adAccountId: account.id, level: 'account', objectId, objectName, date, spend, impressions, clicks, reach, cpc, cpm, cpp, ctr, frequency, actions: row.actions === undefined ? undefined : row.actions as Prisma.InputJsonValue, fields: row as unknown as Prisma.InputJsonValue, fetchedAt: now },
              update: { objectName, spend, impressions, clicks, reach, cpc, cpm, cpp, ctr, frequency, actions: row.actions === undefined ? undefined : row.actions as Prisma.InputJsonValue, fields: row as unknown as Prisma.InputJsonValue, fetchedAt: now },
            });
            persistedCount++;
          }
          signal.throwIfAborted();
          await tx.adAccount.updateMany({ where: { id: account.id, workspaceId: account.workspaceId, actId: account.actId, enabled: true }, data: { lastSyncedAt: now } });
        signal.throwIfAborted();
        await assertFacebookJobAccess(account.workspaceId, jobFeatures.ads);
        const finalBinding = await prisma.adAccount.findFirst({ where: { id: account.id, workspaceId: account.workspaceId, actId: account.actId, enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
        const finalScopes = ((await runtimeConfig('meta.adsReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
        if (!finalBinding?.socialAccount || !usable(finalBinding.socialAccount, account.workspaceId, currentTime(now)) || !granted(finalBinding.socialAccount.scopes, finalScopes)) throw new OperationError('forbidden', 'Facebook job access changed before Ads persistence completed.');
          return { updated: persistedCount, skipped: 0 };
        });
        result.updated += outcome.updated;
        result.skipped += outcome.skipped;
      });
    } catch (error) { if (isAccessDenied(error)) result.skipped++; else result.failed++; }
  }
  return result;
}

/** Sync conversations/messages and post comments through the Facebook platform engine. */
export async function syncInbox(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  if (await runtimeConfig('platforms.facebook.enabled') !== true) return { examined: 0, updated: 0, skipped: 0, failed: 0 };
  const limit = await runtimeConfig('sync.maxItemsPerJob') as number;
  const bounds = await inboxSyncBounds();
  const targetWhere = { type: 'page' as const, enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } };
  const targets = await fairBatch('inbox', limit, (cursor, direction, take) => prisma.target.findMany({
    where: { AND: [targetWhere, ...(cursor ? [{ id: { [direction === 'after' ? 'gt' : 'lte']: cursor } }] : [])] },
    orderBy: { id: 'asc' }, take,
    select: { id: true, workspaceId: true, providerId: true },
  }));
  const result: JobSummary = { examined: targets.length, updated: 0, skipped: 0, failed: 0 };
  for (const target of targets) {
    try {
      let targetUpdated = 0;
      await withWorkspaceOperation(target.workspaceId, async () => {
        await withSelectedResourceOperation(target.workspaceId, { kind: 'target', id: target.id }, async (tx, signal) => {
          await lockInboxChannel(tx, target.workspaceId, target.id);
          const freshTarget = async () => {
            signal.throwIfAborted();
            await assertFacebookJobAccess(target.workspaceId, jobFeatures.inbox);
            const fresh = await prisma.target.findFirst({ where: { id: target.id, workspaceId: target.workspaceId, providerId: target.providerId, type: 'page', enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
            const scopes = ((await runtimeConfig('meta.inboxReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
            if (!fresh?.socialAccount || !usable(fresh.socialAccount, target.workspaceId, currentTime(now)) || !granted(fresh.socialAccount.scopes, scopes) || !fresh.accessToken && !fresh.socialAccount.accessToken) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
            return { providerId: fresh.providerId, token: decryptSecret(fresh.accessToken ?? fresh.socialAccount.accessToken) };
          };
          const conversations = await withRetries(async () => { const binding = await freshTarget(); const engine = await configuredFacebookEngine({ signal }); return engine.listInbox(binding.token, binding.providerId, bounds); }, retryLimit, retryBackoff);
          const posts = await prisma.postTarget.findMany({ where: { targetId: target.id, status: 'published', remotePostId: { not: null }, post: { workspaceId: target.workspaceId } }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: limit, select: { id: true, remotePostId: true } });
          const commentBatches: Array<{ postTargetId: string; comments: FacebookComments }> = [];
          for (const post of posts) if (post.remotePostId) commentBatches.push({ postTargetId: post.id, comments: await withRetries(async () => { const binding = await freshTarget(); const engine = await configuredFacebookEngine({ signal }); return engine.listComments(binding.token, post.remotePostId!, bounds); }, retryLimit, retryBackoff) });
          await freshTarget();
            const latestPosts = await prisma.postTarget.findMany({ where: { id: { in: commentBatches.map(batch => batch.postTargetId) }, targetId: target.id, status: 'published', remotePostId: { not: null }, post: { workspaceId: target.workspaceId } }, select: { id: true, remotePostId: true } });
          const latestById = new Map(latestPosts.map(post => [post.id, post.remotePostId]));
          const currentCommentBatches = commentBatches.filter(batch => latestById.get(batch.postTargetId) === posts.find(post => post.id === batch.postTargetId)?.remotePostId);
          for (const conversation of conversations) {
            signal.throwIfAborted();
            const stored = await tx.conversation.upsert({
              where: { targetId_remoteId: { targetId: target.id, remoteId: conversation.id } },
              create: { id: `rebuild_${randomUUID()}`, targetId: target.id, remoteId: conversation.id, snippet: conversation.snippet, unreadCount: conversation.unreadCount, messageCount: conversation.messageCount, updatedTime: conversation.updatedAt, fetchedAt: now },
              update: { snippet: conversation.snippet, unreadCount: conversation.unreadCount, messageCount: conversation.messageCount, updatedTime: conversation.updatedAt, fetchedAt: now },
              select: { id: true },
            });
            for (const message of conversation.messages) {
              await tx.conversationMessage.upsert({
                where: { conversationId_remoteId: { conversationId: stored.id, remoteId: message.id } },
                create: { id: `rebuild_${randomUUID()}`, conversationId: stored.id, remoteId: message.id, fromName: message.fromName, fromId: message.fromId, message: message.text, createdTime: message.createdAt },
                update: { fromName: message.fromName, fromId: message.fromId, message: message.text, createdTime: message.createdAt },
              });
              targetUpdated++;
            }
            targetUpdated++;
          }
          for (const batch of currentCommentBatches) for (const comment of orderInboxCommentBatch(batch.comments)) {
            signal.throwIfAborted();
            if (await inboxCommentSuppressed(tx, target.workspaceId, target.id, comment.id, comment.parentId)) continue;
            await tx.postComment.upsert({
              where: { postTargetId_remoteId: { postTargetId: batch.postTargetId, remoteId: comment.id } },
              create: { id: `rebuild_${randomUUID()}`, postTargetId: batch.postTargetId, remoteId: comment.id, parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, createdTime: comment.createdAt, fetchedAt: now },
              update: { parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, fetchedAt: now },
            });
            targetUpdated++;
          }
          await freshTarget();
          signal.throwIfAborted();
        });
      });
      result.updated += targetUpdated;
    } catch (error) { if (isAccessDenied(error)) result.skipped++; else result.failed++; }
  }
  return result;
}
