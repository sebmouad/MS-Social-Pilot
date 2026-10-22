import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { decryptSecret } from '@/server/secret-crypto';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { withSelectedResourceOperation } from '@/server/platforms/resource-lock';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { jobStopRequested, jobAbortSignal } from '@/server/jobs/job-context';
import { withRetries, type RetryBackoff } from '@/server/jobs/retry';
import type { JobSummary } from '@/server/jobs/types';
import { OperationError } from '@/lib/operation-error';
import { configuredInstagramCollector, configuredInstagramPolicy } from './runtime';
import { hasScopes } from './publishing';
import { object } from './transport';
import { assertInstagramSource } from './source-binding';

const DAY_MS = 86_400_000; // Date protocol conversion, not a scheduling policy.
const CURSOR_KEY = 'sync.cursor.instagram-analytics';
async function access(workspaceId: string) {
  if (await runtimeConfig('platforms.instagram.enabled') !== true) throw new OperationError('forbidden', (await configuredInstagramPolicy()).copy.unavailable.en);
  await assertWorkspaceJobAccess(workspaceId, { provider: 'instagram', anyFeatureOf: ['analytics/overview'] });
}
type Target = { id: string; workspaceId: string; providerId: string; socialAccountId: string | null };
async function binding(target: Target, now: Date) {
  const current = await prisma.target.findFirst({ where: { id: target.id, workspaceId: target.workspaceId, providerId: target.providerId, socialAccountId: target.socialAccountId, enabled: true, type: 'instagram', socialAccount: { is: { workspaceId: target.workspaceId, provider: 'instagram', invalidatedAt: null } } }, select: { accessToken: true, socialAccountId: true, socialAccount: { select: { scopes: true, tokenExpiresAt: true } } } });
  const policy = await configuredInstagramPolicy();
  if (!current?.accessToken || !current.socialAccount || (current.socialAccount.tokenExpiresAt && current.socialAccount.tokenExpiresAt <= new Date(Math.max(now.getTime(), Date.now())))) return null;
  const credential = { accessToken: decryptSecret(current.accessToken), grantedScopes: current.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean) };
  if (!hasScopes(credential, policy.insightScopes) || !hasScopes(credential, policy.readScopes)) return null;
  try { await assertInstagramSource({ workspaceId: target.workspaceId, targetId: target.id, remoteTargetId: target.providerId, accessToken: credential.accessToken, requiredScopes: [...new Set([...policy.insightScopes, ...policy.readScopes])] }); } catch { return null; }
  const account = await prisma.instagramAccount.findFirst({ where: { workspaceId: target.workspaceId, targetId: target.id, igUserId: target.providerId, socialAccountId: target.socialAccountId, enabled: true }, select: { id: true } });
  return account ? { credential, token: current.accessToken, accountId: account.id } : null;
}

/** Background system collector. Provider reads finish before acquiring selected-resource persistence locks. */
export async function syncInstagramAnalytics(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  const result: JobSummary = { examined: 0, updated: 0, skipped: 0, failed: 0 };
  if (await runtimeConfig('platforms.instagram.enabled') !== true) return result;
  const [policy, limit, saved] = await Promise.all([configuredInstagramPolicy(), runtimeConfig('sync.maxItemsPerJob'), prisma.appSetting.findUnique({ where: { key: CURSOR_KEY }, select: { value: true } })]);
  const cursor = typeof saved?.value === 'string' ? saved.value : null;
  const base = { enabled: true, type: 'instagram' as const, socialAccount: { is: { provider: 'instagram', invalidatedAt: null } } };
  const select = { id: true, workspaceId: true, providerId: true, socialAccountId: true } as const;
  let targets = await prisma.target.findMany({ where: { ...base, ...(cursor ? { id: { gt: cursor } } : {}) }, select, orderBy: { id: 'asc' }, take: limit });
  if (cursor && targets.length < limit) targets = targets.concat(await prisma.target.findMany({ where: { ...base, id: { lte: cursor } }, select, orderBy: { id: 'asc' }, take: limit - targets.length }));
  const since = new Date(now.getTime() - policy.analyticsLookbackDays * DAY_MS);
  for (const target of targets) {
    if (jobStopRequested()) break;
    result.examined++;
    try {
      await withWorkspaceOperation(target.workspaceId, async () => undefined);
      await access(target.workspaceId);
      const initial = await binding(target, now);
      if (!initial) { result.skipped++; continue; }
      const signal = jobAbortSignal(); signal?.throwIfAborted();
      const collector = await configuredInstagramCollector(signal);
      const [profile, insights, history] = await Promise.all([
        withRetries(() => collector.profile(initial.credential, target.providerId), retryLimit, retryBackoff),
        withRetries(() => collector.account({ credential: initial.credential, targetId: target.providerId, since, until: now }), retryLimit, retryBackoff),
        withRetries(() => collector.media(initial.credential, target.providerId, since, now), retryLimit, retryBackoff),
      ]);
      signal?.throwIfAborted();
      const persisted = await withWorkspaceOperation(target.workspaceId, () => withSelectedResourceOperation(target.workspaceId, { kind: 'target', id: target.id }, async (tx, lockSignal) => {
        await access(target.workspaceId);
        const current = await binding(target, now);
        if (!current || current.accountId !== initial.accountId || current.token !== initial.token) return false;
        lockSignal.throwIfAborted();
        for (const row of insights.rows) {
          if (!Number.isFinite(row.asOf.getTime()) || row.value === undefined) continue;
          const period = row.rangeTotal ? `${row.period}:range` : row.period; // Separate totals from series at the existing unique storage key.
          const value = { instagramHostVersion: 1, period: row.period, value: row.value, rangeTotal: row.rangeTotal, raw: row.raw } as Prisma.InputJsonValue;
          const numeric = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
          await tx.instagramInsight.upsert({ where: { accountId_metric_period_endTime: { accountId: current.accountId, metric: row.metric, period, endTime: row.asOf } }, create: { id: randomUUID(), accountId: current.accountId, metric: row.metric, period, endTime: row.asOf, value, numeric, fetchedAt: now }, update: { value, numeric, fetchedAt: now } });
        }
        for (const item of history.items) {
          const media = { instagramHostVersion: 1, ...item.insights } as Prisma.InputJsonValue;
          const fields = { caption: item.caption, mediaType: item.mediaType, mediaProductType: item.mediaProductType, mediaUrl: item.mediaUrl, permalink: item.permalink, thumbnailUrl: item.thumbnailUrl, timestamp: item.timestamp, likeCount: item.likeCount, commentsCount: item.commentsCount, insights: media, insightsSyncedAt: item.insightsSyncedAt, fetchedAt: now };
          await tx.instagramMedia.upsert({ where: { accountId_remoteId: { accountId: current.accountId, remoteId: item.remoteId } }, create: { id: randomUUID(), accountId: current.accountId, remoteId: item.remoteId, ...fields }, update: fields });
        }
        // A failed/missing profile value remains unknown; it never becomes zero.
        const raw = object(profile.raw);
        const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
        await tx.instagramAccount.update({ where: { id: current.accountId }, data: { followersCount: profile.followersCount, followsCount: count(raw.follows_count), mediaCount: count(raw.media_count), ...(typeof raw.username === 'string' ? { username: raw.username } : {}), ...(typeof raw.name === 'string' ? { name: raw.name } : {}), ...(typeof raw.profile_picture_url === 'string' ? { profilePictureUrl: raw.profile_picture_url } : {}), lastSyncedAt: profile.fetchedAt } });
        lockSignal.throwIfAborted();
        await access(target.workspaceId);
        const final = await binding(target, now);
        if (!final || final.accountId !== current.accountId || final.token !== current.token) throw new OperationError('forbidden', policy.copy.permission.en);
        await tx.$executeRaw`INSERT INTO root_activities (id, action, detail, "createdAt") VALUES (${randomUUID()}, 'instagram.analytics_synced', ${JSON.stringify({ workspaceId: target.workspaceId, targetId: target.id, observations: insights.rows.length, failedMetrics: insights.failedMetrics, media: history.items.length, failedMedia: history.failedMedia })}::jsonb, NOW())`;
        return true;
      }));
      if (persisted) { result.updated++; result.failed += insights.failedMetrics.length + history.failedMedia.length; } else result.skipped++;
    } catch (error) {
      if (error instanceof OperationError && ['forbidden', 'not_found', 'conflict'].includes(error.code)) result.skipped++;
      else result.failed++;
    } finally {
      await prisma.appSetting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value: target.id, encrypted: false, updatedAt: now }, update: { value: target.id, updatedAt: now } });
    }
  }
  return result;
}
