import { hit } from '@/server/rate-limit';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { runEnabledPlatformJob } from '@/server/platforms/registry';
import { runAnalyticsRollups } from '../rollups/runner';

/**
 * « Sync now » on Insights and Ads: reads this workspace's Pages, professional accounts and ad accounts from their
 * networks now and rebuilds its daily figures, instead of waiting for the scheduled sync (a freshly connected Page
 * otherwise shows nothing until then). Once a minute per workspace; the same collectors and access checks as the
 * scheduled jobs, limited to this workspace.
 */
export async function syncAnalyticsNow(actor: { userId: string; workspaceId: string }) {
  if (!hit(`analytics-sync-now:${actor.workspaceId}`, { limit: 1, windowMs: 60_000 }).allowed) throw new OperationError('conflict', 'A sync just ran for this workspace. Try again in a minute.');
  const [baseDelayMs, maxDelayMs] = await Promise.all([runtimeConfig('sync.retryBaseDelayMs'), runtimeConfig('sync.retryMaxDelayMs')]);
  const now = new Date();
  const scope = { workspaceId: actor.workspaceId };
  const collected = await runEnabledPlatformJob('analytics', now, 0, { baseDelayMs: Number(baseDelayMs), maxDelayMs: Number(maxDelayMs) }, scope);
  const rolled = await runAnalyticsRollups(now, scope);
  return { examined: collected.examined, updated: collected.updated, failed: collected.failed, rolledUp: rolled.written, syncedAt: now.toISOString() };
}
