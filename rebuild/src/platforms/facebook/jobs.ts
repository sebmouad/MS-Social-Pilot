import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { configuredFacebookEngine } from '@/platforms/facebook/runtime';
import { runtimeConfig } from '@/server/config/store';
import { Prisma } from '../../../generated/client';
import { withRetries } from '@/server/jobs/retry';
import type { RetryBackoff } from '@/server/jobs/retry';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { withInboxChannelOperation, inboxCommentSuppressed, orderInboxCommentBatch } from '@/modules/inbox/server/comment-guard';
import { lockPublishingTargets } from '@/modules/publishing/server/guard';
import { assertNoPostDeletionForRemoteIdentity } from '@/modules/publishing/server/post-deletion-guard';
import type { JobSummary } from '@/server/jobs/types';
import { OperationError } from '@/lib/operation-error';

const DAY_MS = 86_400_000;
type FairRow = { id: string };
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
  const requiredScopes = new Set(((await runtimeConfig('meta.postReadScopes')) as string[]).map(scope => scope.trim()).filter(Boolean));
  const rows = await prisma.postTarget.findMany({
    where: { status: 'scheduled_remote', remotePostId: { not: null }, target: { enabled: true, type: 'page', socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } } },
    orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], take: limit,
    select: { id: true, postId: true, remotePostId: true, target: { select: { id: true, workspaceId: true, providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } } } },
  });
  const result: JobSummary = { examined: rows.length, updated: 0, skipped: 0, failed: 0 };
  if (!rows.length) return result;
  const engine = await configuredFacebookEngine();
  for (const row of rows) {
    const account = row.target.socialAccount;
    const encrypted = row.target.accessToken ?? account?.accessToken;
    if (!account || account.workspaceId !== row.target.workspaceId || account.invalidatedAt || (account.tokenExpiresAt && account.tokenExpiresAt <= now) || !encrypted || !row.remotePostId) { result.skipped++; continue; }
    const grantedScopes = new Set((account.scopes ?? '').split(',').map(scope => scope.trim()).filter(Boolean));
    if (!requiredScopes.size || [...requiredScopes].some(scope => !grantedScopes.has(scope))) { result.skipped++; continue; }
    try {
      await withWorkspaceOperation(row.target.workspaceId, async () => {
        await prisma.$transaction(async tx => {
          const postKey = JSON.stringify(['publishing-post', row.target.workspaceId, row.postId]);
          const postLock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${postKey}, 0)) AS acquired`;
          if (postLock[0]?.acquired !== true) { result.skipped++; return; }
          await lockPublishingTargets(tx, row.target.workspaceId, [row.target.id]);
          await assertNoPostDeletionForRemoteIdentity(tx, row.target.workspaceId, row.target.id, row.remotePostId!);
          const status = await withRetries(() => engine.getStatus(decryptSecret(encrypted), row.remotePostId!), retryLimit, retryBackoff);
          if (status.state !== 'published') { result.skipped++; return; }
          const changed = await tx.postTarget.updateMany({
            where: { id: row.id, postId: row.postId, targetId: row.target.id, status: 'scheduled_remote', remotePostId: row.remotePostId },
            data: { status: 'published', ...(status.publishedAt ? { publishedAt: status.publishedAt } : { publishedAt: now }) },
          });
          if (!changed.count) return;
          const counts = await tx.postTarget.groupBy({ by: ['status'], where: { postId: row.postId }, _count: true });
          const total = counts.reduce((sum, item) => sum + item._count, 0);
          const published = counts.find(item => item.status === 'published')?._count ?? 0;
          const remote = counts.find(item => item.status === 'scheduled_remote')?._count ?? 0;
          const failed = counts.find(item => item.status === 'failed')?._count ?? 0;
          const processing = counts.find(item => item.status === 'processing')?._count ?? 0;
          const nextStatus = processing ? (published + remote > 0 ? 'partially_failed' : 'publishing') : (published + remote === total ? (remote ? 'scheduled' : 'published') : published ? 'partially_failed' : failed ? 'failed' : undefined);
          if (nextStatus) await tx.post.updateMany({ where: { id: row.postId }, data: { status: nextStatus, ...(published && !remote ? { publishedAt: now } : {}), updatedAt: now } });
          result.updated++;
        });
      });
    } catch (error) {
      if (error instanceof OperationError && error.code === 'conflict') result.skipped++;
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
    select: { id: true, workspaceId: true, providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, tokenExpiresAt: true, invalidatedAt: true } } },
  }));
  const engine = await configuredFacebookEngine();
  const result: JobSummary = { examined: targets.length, updated: 0, skipped: 0, failed: 0 };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(today.getTime() - 6 * DAY_MS);
  for (const target of targets) {
    const account = target.socialAccount;
    const encrypted = target.accessToken ?? account?.accessToken;
    if (!account || account.workspaceId !== target.workspaceId || account.invalidatedAt || (account.tokenExpiresAt && account.tokenExpiresAt <= now) || !encrypted) { result.skipped++; continue; }
    try {
      await withWorkspaceOperation(target.workspaceId, async () => {
        const observations = await withRetries(() => engine.getPageInsightObservations(decryptSecret(encrypted), target.providerId, since, now), retryLimit, retryBackoff);
        if (observations.failedMetrics?.length) result.failed++;
        for (const { metric, period, endTime, value, numeric } of observations) {
          await prisma.pageInsight.upsert({
            where: { targetId_metric_period_endTime: { targetId: target.id, metric, period, endTime } },
            create: { id: `rebuild_${randomUUID()}`, targetId: target.id, metric, period, endTime, value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue, numeric, fetchedAt: now },
            update: { value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue, numeric, fetchedAt: now },
          });
          result.updated++;
        }
      });
    } catch { result.failed++; }
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
    select: { id: true, workspaceId: true, actId: true, name: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } },
  }));
  const requiredScopes = new Set((await runtimeConfig('meta.adsReadScopes') as string[]).map(scope => scope.trim()).filter(Boolean));
  const engine = await configuredFacebookEngine();
  const result: JobSummary = { examined: accounts.length, updated: 0, skipped: 0, failed: 0 };
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(until.getTime() - 29 * DAY_MS);
  for (const account of accounts) {
    const connection = account.socialAccount;
    const granted = new Set((connection?.scopes ?? '').split(',').map(scope => scope.trim()).filter(Boolean));
    if (!connection || connection.workspaceId !== account.workspaceId || connection.invalidatedAt || (connection.tokenExpiresAt && connection.tokenExpiresAt <= now) || !connection.accessToken || !requiredScopes.size || [...requiredScopes].some(scope => !granted.has(scope))) { result.skipped++; continue; }
    try {
      await withWorkspaceOperation(account.workspaceId, async () => {
        const rows = await withRetries(() => engine.getAdInsights(decryptSecret(connection.accessToken!), account.actId, since, until), retryLimit, retryBackoff);
        for (const row of rows) {
          const date = validDate(row.date_start);
          if (!date) continue;
          const objectId = typeof row.account_id === 'string' ? row.account_id : account.actId;
          const objectName = typeof row.account_name === 'string' ? row.account_name : account.name;
          const spend = finite(row.spend) ?? 0;
          const impressions = Math.max(0, Math.trunc(finite(row.impressions) ?? 0));
          const clicks = Math.max(0, Math.trunc(finite(row.clicks) ?? 0));
          const reach = Math.max(0, Math.trunc(finite(row.reach) ?? 0));
          const cpc = finite(row.cpc); const cpm = finite(row.cpm); const cpp = finite(row.cpp); const ctr = finite(row.ctr); const frequency = finite(row.frequency);
          await prisma.adInsight.upsert({
            where: { adAccountId_level_objectId_date: { adAccountId: account.id, level: 'account', objectId, date } },
            create: { id: `rebuild_${randomUUID()}`, adAccountId: account.id, level: 'account', objectId, objectName, date, spend, impressions, clicks, reach, cpc, cpm, cpp, ctr, frequency, actions: row.actions === undefined ? undefined : row.actions as Prisma.InputJsonValue, fields: row as unknown as Prisma.InputJsonValue, fetchedAt: now },
            update: { objectName, spend, impressions, clicks, reach, cpc, cpm, cpp, ctr, frequency, actions: row.actions === undefined ? undefined : row.actions as Prisma.InputJsonValue, fields: row as unknown as Prisma.InputJsonValue, fetchedAt: now },
          });
          result.updated++;
        }
        await prisma.adAccount.updateMany({ where: { id: account.id, workspaceId: account.workspaceId, enabled: true }, data: { lastSyncedAt: now } });
      });
    } catch { result.failed++; }
  }
  return result;
}

/** Sync conversations/messages and post comments through the Facebook platform engine. */
export async function syncInbox(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  if (await runtimeConfig('platforms.facebook.enabled') !== true) return { examined: 0, updated: 0, skipped: 0, failed: 0 };
  const [readScopes, limit] = await Promise.all([
    runtimeConfig('meta.inboxReadScopes') as Promise<string[]>, runtimeConfig('sync.maxItemsPerJob') as Promise<number>,
  ]);
  const required = new Set(readScopes.map(scope => scope.trim()).filter(Boolean));
  const targetWhere = { type: 'page' as const, enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } };
  const targets = await fairBatch('inbox', limit, (cursor, direction, take) => prisma.target.findMany({
    where: { AND: [targetWhere, ...(cursor ? [{ id: { [direction === 'after' ? 'gt' : 'lte']: cursor } }] : [])] },
    orderBy: { id: 'asc' }, take,
    select: { id: true, workspaceId: true, providerId: true, accessToken: true, socialAccount: { select: { workspaceId: true, accessToken: true, scopes: true, tokenExpiresAt: true, invalidatedAt: true } } },
  }));
  const engine = await configuredFacebookEngine();
  const result: JobSummary = { examined: targets.length, updated: 0, skipped: 0, failed: 0 };
  for (const target of targets) {
    const account = target.socialAccount;
    const encrypted = target.accessToken ?? account?.accessToken;
    const granted = new Set((account?.scopes ?? '').split(',').map(scope => scope.trim()).filter(Boolean));
    if (!account || account.workspaceId !== target.workspaceId || account.invalidatedAt || (account.tokenExpiresAt && account.tokenExpiresAt <= now) || !encrypted || !required.size || [...required].some(scope => !granted.has(scope))) { result.skipped++; continue; }
    try {
      let targetUpdated = 0;
      await withWorkspaceOperation(target.workspaceId, async () => {
        const token = decryptSecret(encrypted);
        const conversations = await withRetries(() => engine.listInbox(token, target.providerId), retryLimit, retryBackoff);
        const posts = await prisma.postTarget.findMany({ where: { targetId: target.id, status: 'published', remotePostId: { not: null } }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: limit, select: { id: true, remotePostId: true } });
        const commentBatches: Array<{ postTargetId: string; comments: Awaited<ReturnType<typeof engine.listComments>> }> = [];
        for (const post of posts) if (post.remotePostId) commentBatches.push({ postTargetId: post.id, comments: await withRetries(() => engine.listComments(token, post.remotePostId!), retryLimit, retryBackoff) });
        await withInboxChannelOperation(target.workspaceId, target.id, async signal => {
          signal.throwIfAborted();
          await prisma.$transaction(async tx => {
          for (const conversation of conversations) {
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
          for (const batch of commentBatches) for (const comment of orderInboxCommentBatch(batch.comments)) {
            if (await inboxCommentSuppressed(tx, target.workspaceId, target.id, comment.id, comment.parentId)) continue;
            await tx.postComment.upsert({
              where: { postTargetId_remoteId: { postTargetId: batch.postTargetId, remoteId: comment.id } },
              create: { id: `rebuild_${randomUUID()}`, postTargetId: batch.postTargetId, remoteId: comment.id, parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, createdTime: comment.createdAt, fetchedAt: now },
              update: { parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, fetchedAt: now },
            });
            targetUpdated++;
          }
          });
        });
      });
      result.updated += targetUpdated;
    } catch { result.failed++; }
  }
  return result;
}
