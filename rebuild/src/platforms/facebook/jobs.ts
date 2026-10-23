import { configuredDiscoverFacebookAdObjects } from './ads-discovery';
import { saveAdObject } from '@/modules/ads/server/object-store';
import { storeInboxMetadata } from '@/modules/inbox/server/metadata';
import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { redact } from '@/modules/root/server/admin/authz';
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
import { jobAbortSignal, jobStopRequested } from '@/server/jobs/job-context';
import { FACEBOOK_ANALYTICS_LOOKBACK_DAYS_SCHEMA } from './module';
import { purgeExpiredWebhookDeliveries } from './webhooks';

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

/**
 * Provider reads run here: no transaction and no selected-resource lock is open, so a slow
 * Graph call never pins a database connection. Bounded by the resource timeout and job shutdown.
 */
async function withProviderWindow<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), await runtimeConfig('sync.resourceOperationTimeoutMs') as number);
  const jobSignal = jobAbortSignal();
  const onJobAbort = () => controller.abort();
  jobSignal?.addEventListener('abort', onJobAbort, { once: true });
  if (jobSignal?.aborted) controller.abort();
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    jobSignal?.removeEventListener('abort', onJobAbort);
  }
}

/** Short admission check so a suspended or purging workspace triggers no provider traffic. */
function admitWorkspace(workspaceId: string): Promise<void> { return withWorkspaceOperation(workspaceId, async () => undefined); }

async function configuredScopes(key: 'meta.postReadScopes' | 'meta.pageInsightReadScopes' | 'meta.adsReadScopes'): Promise<string[]> {
  return ((await runtimeConfig(key)) as string[]).map(scope => scope.trim()).filter(Boolean);
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
      await admitWorkspace(row.target.workspaceId);
      // Provider read first, with no transaction or lock held.
      const status = await withProviderWindow(signal => withRetries(async () => {
        await assertFacebookJobAccess(row.target.workspaceId, jobFeatures.publishing);
        const fresh = await prisma.postTarget.findFirst({ where: { id: row.id, postId: row.postId, status: 'scheduled_remote', remotePostId: row.remotePostId, post: { workspaceId: row.target.workspaceId }, target: { workspaceId: row.target.workspaceId, id: row.target.id, type: 'page', enabled: true, providerId: row.target.providerId, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } } }, select: { remotePostId: true, target: { select: { workspaceId: true, enabled: true, providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } } } });
        const freshAccount = fresh?.target.socialAccount;
        const scopes = await configuredScopes('meta.postReadScopes');
        if (!fresh || fresh.remotePostId !== row.remotePostId || fresh.target.workspaceId !== row.target.workspaceId || !fresh.target.enabled || fresh.target.providerId !== row.target.providerId || !freshAccount || !usable(freshAccount, row.target.workspaceId, currentTime(now)) || !granted(freshAccount.scopes, scopes) || !fresh.target.accessToken && !freshAccount.accessToken) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
        signal.throwIfAborted();
        const engine = await configuredFacebookEngine({ signal });
        const media = row.post.media;
        const contentKind = Array.isArray(media) && media.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'video') ? 'video' : Array.isArray(media) && media.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'image') ? 'image' : 'text';
        return engine.getStatus(decryptSecret(fresh.target.accessToken ?? freshAccount.accessToken), fresh.remotePostId!, { targetId: row.target.providerId, contentKind });
      }, retryLimit, retryBackoff));
      if (status.state !== 'published') { result.skipped++; continue; }
      await withWorkspaceOperation(row.target.workspaceId, async () => {
        const outcome = await withSelectedResourceOperation(row.target.workspaceId, { kind: 'target', id: row.target.id }, async (tx, signal) => {
          signal.throwIfAborted();
          const postKey = JSON.stringify(['publishing-post', row.target.workspaceId, row.postId]);
          const postLock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${postKey}, 0)) AS acquired`;
          if (postLock[0]?.acquired !== true) return { updated: 0, skipped: 1 };
          await lockPublishingTargets(tx, row.target.workspaceId, [row.target.id]);
          await assertNoPostDeletionForRemoteIdentity(tx, row.target.workspaceId, row.target.id, row.remotePostId!);
          await assertFacebookJobAccess(row.target.workspaceId, jobFeatures.publishing);
          const stillBound = await prisma.postTarget.findFirst({ where: { id: row.id, postId: row.postId, status: 'scheduled_remote', remotePostId: row.remotePostId, post: { workspaceId: row.target.workspaceId }, target: { workspaceId: row.target.workspaceId, enabled: true, providerId: row.target.providerId, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } } }, select: { id: true, remotePostId: true, target: { select: { accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } } } });
          const currentScopes = await configuredScopes('meta.postReadScopes');
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
          const finalScopes = await configuredScopes('meta.postReadScopes');
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

type PageTarget = { id: string; workspaceId: string; providerId: string };
type HistoryProgress = import('./post-history').HistoryProgress;
type PostHistory = Awaited<ReturnType<Awaited<ReturnType<typeof configuredFacebookEngine>>['getPostHistory']>>;
type PageFetch = {
  observations: Awaited<ReturnType<Awaited<ReturnType<typeof configuredFacebookEngine>>['getPageInsightObservations']>>;
  history: PostHistory | null;
  /** Cursor the history read resumed from; the write phase only commits if it is unchanged. */
  startCursor: HistoryProgress | undefined;
  failedMetrics: number;
};

/** Current Page binding, or null when selection, connection, grant or token no longer allows the read. */
async function currentPageBinding(target: PageTarget, now: Date): Promise<{ token: string } | null> {
  const fresh = await prisma.target.findFirst({ where: { id: target.id, workspaceId: target.workspaceId, providerId: target.providerId, type: 'page', enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
  const scopes = await configuredScopes('meta.pageInsightReadScopes');
  if (!fresh?.socialAccount || !usable(fresh.socialAccount, target.workspaceId, currentTime(now)) || !granted(fresh.socialAccount.scopes, scopes) || !fresh.accessToken && !fresh.socialAccount.accessToken) return null;
  return { token: decryptSecret(fresh.accessToken ?? fresh.socialAccount.accessToken) };
}
async function readHistoryCursor(db: Pick<typeof prisma, '$queryRaw'>, target: PageTarget): Promise<HistoryProgress | undefined> {
  const rows = await db.$queryRaw<Array<{ cursor: HistoryProgress }>>`SELECT cursor FROM rebuild_facebook_sync_cursors WHERE "workspaceId" = ${target.workspaceId} AND "targetId" = ${target.id} AND kind = 'post_history' AND "providerId" = ${target.providerId}`;
  return rows[0]?.cursor;
}

/** Read Page insights and post history from Facebook with no transaction or lock held. */
async function fetchPageAnalytics(target: PageTarget, now: Date, today: Date, retryLimit: number, retryBackoff?: RetryBackoff): Promise<PageFetch> {
  return withProviderWindow(async signal => {
    const observations = await withRetries(async () => {
      await assertFacebookJobAccess(target.workspaceId, jobFeatures.analytics);
      const binding = await currentPageBinding(target, now);
      if (!binding) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
      signal.throwIfAborted();
      const engine = await configuredFacebookEngine({ signal });
      const lookbackDays = await readLookbackDays('meta.pageAnalyticsLookbackDays');
      const since = new Date(today.getTime() - (lookbackDays - 1) * DAY_MS);
      return engine.getPageInsightObservations(binding.token, target.providerId, since, now);
    }, retryLimit, retryBackoff);
    let failedMetrics = observations.failedMetrics?.length ? 1 : 0;
    const historyBinding = await currentPageBinding(target, now);
    if (!historyBinding) throw new OperationError('forbidden', 'History access unavailable.');
    const startCursor = await readHistoryCursor(prisma, target);
    // Post history is best-effort: a provider refusal is counted and logged, Page insights still persist.
    let history: PostHistory | null = null;
    try {
      const historyEngine = await configuredFacebookEngine({ signal });
      history = await historyEngine.getPostHistory(historyBinding.token, target.providerId, now, startCursor);
    } catch (historyError) { signal.throwIfAborted(); failedMetrics++; await logItemFailure('postHistory', target.id, historyError); }
    if (history?.failures.length) failedMetrics++;
    return { observations, history, startCursor, failedMetrics };
  });
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
    if (jobStopRequested()) break;
    try {
      await admitWorkspace(target.workspaceId);
      const fetched = await fetchPageAnalytics(target, now, today, retryLimit, retryBackoff);
      await withWorkspaceOperation(target.workspaceId, async () => {
        const outcome = await withSelectedResourceOperation(target.workspaceId, { kind: 'target', id: target.id }, async (tx, signal) => {
          let persistedCount = 0;
          await assertFacebookJobAccess(target.workspaceId, jobFeatures.analytics);
          if (!await currentPageBinding(target, now)) return { updated: 0, skipped: 1, failed: 0 };
          // History and cursor commit atomically under the selected-resource lock; a cursor that moved
          // while Facebook was being read means another run already advanced it, so keep that one.
          const history = fetched.history;
          if (history && JSON.stringify(await readHistoryCursor(tx, target) ?? null) === JSON.stringify(fetched.startCursor ?? null)) {
            for (const post of history.posts) {
              signal.throwIfAborted();
              await tx.$executeRaw`INSERT INTO external_posts (id, "targetId", "remoteId", message, permalink, "statusType", "pictureUrl", "createdTime", insights, "insightsSyncedAt", "fetchedAt")
                VALUES (${`rebuild_${randomUUID()}`}, ${target.id}, ${post.remoteId}, ${post.message}, ${post.permalink}, ${post.statusType}, ${post.pictureUrl}, ${post.createdTime}, ${JSON.stringify(post.insights)}::jsonb, ${now}, ${now})
                ON CONFLICT ("targetId", "remoteId") DO UPDATE SET message = EXCLUDED.message, permalink = EXCLUDED.permalink, "statusType" = EXCLUDED."statusType", "pictureUrl" = EXCLUDED."pictureUrl", insights = EXCLUDED.insights, "insightsSyncedAt" = EXCLUDED."insightsSyncedAt", "fetchedAt" = EXCLUDED."fetchedAt"`;
              persistedCount++;
            }
            await tx.$executeRaw`INSERT INTO rebuild_facebook_sync_cursors ("workspaceId", "targetId", "providerId", kind, cursor, "updatedAt") VALUES (${target.workspaceId}, ${target.id}, ${target.providerId}, 'post_history', ${JSON.stringify(history.progress)}::jsonb, ${now}) ON CONFLICT ("workspaceId", "targetId", kind) DO UPDATE SET "providerId" = EXCLUDED."providerId", cursor = EXCLUDED.cursor, "updatedAt" = EXCLUDED."updatedAt"`;
          }
          for (const { metric, period, endTime, value, numeric } of fetched.observations) {
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
          if (!await currentPageBinding(target, now)) throw new OperationError('forbidden', 'Facebook job access changed before analytics persistence completed.');
          return { updated: persistedCount, skipped: 0, failed: fetched.failedMetrics };
        });
        result.updated += outcome.updated;
        result.skipped += outcome.skipped;
        result.failed += outcome.failed;
      });
    } catch (error) { if (isAccessDenied(error)) result.skipped++; else { result.failed++; await logItemFailure('pageAnalytics', target.id, error); } }
  }
  return result;
}

type AdsAccount = { id: string; workspaceId: string; actId: string; name: string | null };

/** Current ad-account binding, or null when selection, connection or grant no longer allows the read. */
async function currentAdsBinding(account: AdsAccount, now: Date): Promise<{ token: string } | null> {
  const fresh = await prisma.adAccount.findFirst({ where: { id: account.id, workspaceId: account.workspaceId, actId: account.actId, enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { actId: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
  const scopes = await configuredScopes('meta.adsReadScopes');
  if (!fresh?.socialAccount || !usable(fresh.socialAccount, account.workspaceId, currentTime(now)) || !granted(fresh.socialAccount.scopes, scopes)) return null;
  return { token: decryptSecret(fresh.socialAccount.accessToken) };
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
    if (jobStopRequested()) break;
    try {
      await admitWorkspace(account.workspaceId);
      // Provider read first, with no transaction or lock held.
      const rows = await withProviderWindow(signal => withRetries(async () => {
        await assertFacebookJobAccess(account.workspaceId, jobFeatures.ads);
        const binding = await currentAdsBinding(account, now);
        if (!binding) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
        signal.throwIfAborted();
        const engine = await configuredFacebookEngine({ signal });
        const lookbackDays = await readLookbackDays('meta.adsAnalyticsLookbackDays');
        const since = new Date(until.getTime() - (lookbackDays - 1) * DAY_MS);
        const [insights, objects] = await Promise.all([
          engine.getAdInsights(binding.token, account.actId, since, until),
          configuredDiscoverFacebookAdObjects(binding.token, account.actId, account.id, now, signal),
        ]);
        return { insights, objects };
      }, retryLimit, retryBackoff));
      await withWorkspaceOperation(account.workspaceId, async () => {
        const outcome = await withSelectedResourceOperation(account.workspaceId, { kind: 'adAccount', id: account.id }, async (tx, signal) => {
          let persistedCount = 0;
          await assertFacebookJobAccess(account.workspaceId, jobFeatures.ads);
          if (!await currentAdsBinding(account, now)) return { updated: 0, skipped: 1 };
          for (const item of rows.objects) {
            signal.throwIfAborted();
            await saveAdObject(tx, item);
            persistedCount++;
          }
          for (const row of rows.insights) {
            signal.throwIfAborted();
            const date = validDate(row.date_start);
            if (!date) continue;
            const level = row.report_level === 'campaign' || row.report_level === 'adset' || row.report_level === 'ad' ? row.report_level : 'account';
            const objectId = typeof row[`${level}_id`] === 'string' ? row[`${level}_id`] as string : account.actId;
            if (level !== 'account' && objectId === account.actId) throw new Error('Ads hierarchy identity missing.');
            const objectName = typeof row[`${level}_name`] === 'string' ? row[`${level}_name`] as string : account.name;
            const spend = finite(row.spend) ?? 0;
            const impressions = Math.max(0, Math.trunc(finite(row.impressions) ?? 0));
            const clicks = Math.max(0, Math.trunc(finite(row.clicks) ?? 0));
            const reach = Math.max(0, Math.trunc(finite(row.reach) ?? 0));
            const cpc = finite(row.cpc); const cpm = finite(row.cpm); const cpp = finite(row.cpp); const ctr = finite(row.ctr); const frequency = finite(row.frequency);
            await tx.adInsight.upsert({
              where: { adAccountId_level_objectId_date: { adAccountId: account.id, level, objectId, date } },
              create: { id: `rebuild_${randomUUID()}`, adAccountId: account.id, level, objectId, objectName, date, spend, impressions, clicks, reach, cpc, cpm, cpp, ctr, frequency, actions: row.actions === undefined ? undefined : row.actions as Prisma.InputJsonValue, fields: row as unknown as Prisma.InputJsonValue, fetchedAt: now },
              update: { objectName, spend, impressions, clicks, reach, cpc, cpm, cpp, ctr, frequency, actions: row.actions === undefined ? undefined : row.actions as Prisma.InputJsonValue, fields: row as unknown as Prisma.InputJsonValue, fetchedAt: now },
            });
            persistedCount++;
          }
          signal.throwIfAborted();
          await tx.adAccount.updateMany({ where: { id: account.id, workspaceId: account.workspaceId, actId: account.actId, enabled: true }, data: { lastSyncedAt: now } });
          signal.throwIfAborted();
          await assertFacebookJobAccess(account.workspaceId, jobFeatures.ads);
          if (!await currentAdsBinding(account, now)) throw new OperationError('forbidden', 'Facebook job access changed before Ads persistence completed.');
          return { updated: persistedCount, skipped: 0 };
        });
        result.updated += outcome.updated;
        result.skipped += outcome.skipped;
      });
    } catch (error) { if (isAccessDenied(error)) result.skipped++; else { result.failed++; await logItemFailure('adsAnalytics', account.id, error); } }
  }
  return result;
}

/** Operator log line for a failed sync item: target id and redacted reason, never credentials. */
async function logItemFailure(job: string, targetId: string, error: unknown) {
  const max = await runtimeConfig('logging.errorDetailMaxCharacters').catch(() => null) as number | null;
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.warn(`[${job}] target=${targetId} failed: ${redact(reason, max ?? Number(CONFIG_BY_KEY.get('logging.errorDetailMaxCharacters')?.defaultValue))}`);
}

type InboxFetch = {
  conversations: Awaited<ReturnType<Awaited<ReturnType<typeof configuredFacebookEngine>>['listInbox']>>;
  commentBatches: Array<{ postTargetId: string; comments: FacebookComments }>;
  postRemoteIds: Map<string, string | null>;
  /** Re-reads binding, scopes and access; call inside the write transaction. */
  recheck: (signal: AbortSignal) => Promise<unknown>;
};

/** Read one Page's inbox from Facebook with no transaction or lock held. */
async function fetchInboxTarget(target: { id: string; workspaceId: string; providerId: string }, now: Date, limit: number, bounds: Awaited<ReturnType<typeof inboxSyncBounds>>, retryLimit: number, retryBackoff?: RetryBackoff): Promise<InboxFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), await runtimeConfig('sync.resourceOperationTimeoutMs') as number);
  const jobSignal = jobAbortSignal();
  const onJobAbort = () => controller.abort();
  jobSignal?.addEventListener('abort', onJobAbort, { once: true });
  if (jobSignal?.aborted) controller.abort();
  const signal = controller.signal;
  const freshTarget = async (guard: AbortSignal = signal) => {
    guard.throwIfAborted();
    await assertFacebookJobAccess(target.workspaceId, jobFeatures.inbox);
    const fresh = await prisma.target.findFirst({ where: { id: target.id, workspaceId: target.workspaceId, providerId: target.providerId, type: 'page', enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } }, select: { providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } });
    const scopes = ((await runtimeConfig('meta.inboxReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean);
    if (!fresh?.socialAccount || !usable(fresh.socialAccount, target.workspaceId, currentTime(now)) || !granted(fresh.socialAccount.scopes, scopes) || !fresh.accessToken && !fresh.socialAccount.accessToken) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
    return { providerId: fresh.providerId, token: decryptSecret(fresh.accessToken ?? fresh.socialAccount.accessToken) };
  };
  try {
    const conversations = await withRetries(async () => { const binding = await freshTarget(); const engine = await configuredFacebookEngine({ signal }); return engine.listInbox(binding.token, binding.providerId, bounds); }, retryLimit, retryBackoff);
    const posts = await prisma.postTarget.findMany({ where: { targetId: target.id, status: 'published', remotePostId: { not: null }, post: { workspaceId: target.workspaceId } }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: limit, select: { id: true, remotePostId: true } });
    const commentBatches: InboxFetch['commentBatches'] = [];
    for (const post of posts) {
      if (jobStopRequested()) break;
      if (post.remotePostId) commentBatches.push({ postTargetId: post.id, comments: await withRetries(async () => { const binding = await freshTarget(); const engine = await configuredFacebookEngine({ signal }); return engine.listComments(binding.token, post.remotePostId!, bounds); }, retryLimit, retryBackoff) });
    }
    return { conversations, commentBatches, postRemoteIds: new Map(posts.map(post => [post.id, post.remotePostId])), recheck: freshTarget };
  } finally {
    clearTimeout(timer);
    jobSignal?.removeEventListener('abort', onJobAbort);
  }
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
    if (jobStopRequested()) break;
    try {
      let targetUpdated = 0;
      // Provider reads run with no transaction or lock open; only the short
      // write phase below holds the workspace guard and selected-resource lock.
      // Short admission check so a suspended or purging workspace triggers no provider traffic.
      await withWorkspaceOperation(target.workspaceId, async () => undefined);
      const fetched = await fetchInboxTarget(target, now, limit, bounds, retryLimit, retryBackoff);
      await withWorkspaceOperation(target.workspaceId, async () => {
        await withSelectedResourceOperation(target.workspaceId, { kind: 'target', id: target.id }, async (tx, signal) => {
          await lockInboxChannel(tx, target.workspaceId, target.id);
          await fetched.recheck(signal);
          const latestPosts = await prisma.postTarget.findMany({ where: { id: { in: fetched.commentBatches.map(batch => batch.postTargetId) }, targetId: target.id, status: 'published', remotePostId: { not: null }, post: { workspaceId: target.workspaceId } }, select: { id: true, remotePostId: true } });
          const latestById = new Map(latestPosts.map(post => [post.id, post.remotePostId]));
          const currentCommentBatches = fetched.commentBatches.filter(batch => latestById.get(batch.postTargetId) === fetched.postRemoteIds.get(batch.postTargetId));
          for (const conversation of fetched.conversations) {
            signal.throwIfAborted();
            const stored = await tx.conversation.upsert({
              where: { targetId_remoteId: { targetId: target.id, remoteId: conversation.id } },
              create: { id: `rebuild_${randomUUID()}`, targetId: target.id, remoteId: conversation.id, snippet: conversation.snippet, unreadCount: conversation.unreadCount, messageCount: conversation.messageCount, updatedTime: conversation.updatedAt, fetchedAt: now },
              update: { snippet: conversation.snippet, unreadCount: conversation.unreadCount, messageCount: conversation.messageCount, updatedTime: conversation.updatedAt, fetchedAt: now },
              select: { id: true },
            });
            if ('metadata' in conversation) await storeInboxMetadata(tx, { workspaceId: target.workspaceId, targetId: target.id }, 'conversation', stored.id, (conversation as { metadata?: unknown }).metadata);
            for (const message of conversation.messages) {
              const storedMessage = await tx.conversationMessage.upsert({
                where: { conversationId_remoteId: { conversationId: stored.id, remoteId: message.id } },
                create: { id: `rebuild_${randomUUID()}`, conversationId: stored.id, remoteId: message.id, fromName: message.fromName, fromId: message.fromId, message: message.text, createdTime: message.createdAt },
                update: { fromName: message.fromName, fromId: message.fromId, message: message.text, createdTime: message.createdAt },
              });
              if ('metadata' in message) await storeInboxMetadata(tx, { workspaceId: target.workspaceId, targetId: target.id }, 'message', storedMessage.id, (message as { metadata?: unknown }).metadata);
              targetUpdated++;
            }
            targetUpdated++;
          }
          for (const batch of currentCommentBatches) for (const comment of orderInboxCommentBatch(batch.comments)) {
            signal.throwIfAborted();
            if (await inboxCommentSuppressed(tx, target.workspaceId, target.id, comment.id, comment.parentId)) continue;
            const storedComment = await tx.postComment.upsert({
              where: { postTargetId_remoteId: { postTargetId: batch.postTargetId, remoteId: comment.id } },
              create: { id: `rebuild_${randomUUID()}`, postTargetId: batch.postTargetId, remoteId: comment.id, parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, createdTime: comment.createdAt, fetchedAt: now },
              update: { parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, fetchedAt: now },
            });
            if ('metadata' in comment) await storeInboxMetadata(tx, { workspaceId: target.workspaceId, targetId: target.id }, 'comment', storedComment.id, (comment as { metadata?: unknown }).metadata);
            targetUpdated++;
          }
          await fetched.recheck(signal);
          signal.throwIfAborted();
        });
      });
      result.updated += targetUpdated;
    } catch (error) {
      if (isAccessDenied(error)) result.skipped++;
      else { result.failed++; await logItemFailure('inbox', target.id, error); }
    }
  }
  // Bounded retention sweep for the webhook delivery log; never fails the sync.
  try { await purgeExpiredWebhookDeliveries(now); } catch (error) { await logItemFailure('webhookDeliveries', 'retention', error); }
  return result;
}
