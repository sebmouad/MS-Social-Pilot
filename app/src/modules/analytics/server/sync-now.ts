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

type SyncResult = Awaited<ReturnType<typeof syncAnalyticsNow>>;
export type SyncNowState = { state: 'running'; startedAt: string } | { state: 'done'; startedAt: string; result: SyncResult } | { state: 'failed'; startedAt: string; error: string };

// One run per workspace, kept in this server process. A sync reads every Page and ad account and can take minutes,
// longer than a proxy keeps a request open, so the request only starts it and the screen asks for its state.
const runs = new Map<string, SyncNowState>();

/** Starts a sync in the background, or reports the one already running for this workspace. */
export function startAnalyticsSync(actor: { userId: string; workspaceId: string }): SyncNowState {
  const current = runs.get(actor.workspaceId);
  if (current?.state === 'running') return current;
  const startedAt = new Date().toISOString();
  // The once-a-minute limit is checked before anything starts, so a refused click changes nothing.
  if (!hit(`analytics-sync-now:${actor.workspaceId}`, { limit: 1, windowMs: 60_000 }).allowed) throw new OperationError('conflict', 'A sync just ran for this workspace. Try again in a minute.');
  const running: SyncNowState = { state: 'running', startedAt };
  runs.set(actor.workspaceId, running);
  void runSync(actor).then(
    result => { if (runs.get(actor.workspaceId) === running) runs.set(actor.workspaceId, { state: 'done', startedAt, result }); },
    () => { if (runs.get(actor.workspaceId) === running) runs.set(actor.workspaceId, { state: 'failed', startedAt, error: 'The sync could not finish. Try again.' }); },
  );
  return running;
}

export function analyticsSyncState(workspaceId: string): SyncNowState | null { return runs.get(workspaceId) ?? null; }

async function runSync(actor: { userId: string; workspaceId: string }) {
  const [baseDelayMs, maxDelayMs] = await Promise.all([runtimeConfig('sync.retryBaseDelayMs'), runtimeConfig('sync.retryMaxDelayMs')]);
  const now = new Date();
  const scope = { workspaceId: actor.workspaceId };
  const collected = await runEnabledPlatformJob('analytics', now, 0, { baseDelayMs: Number(baseDelayMs), maxDelayMs: Number(maxDelayMs) }, scope);
  const rolled = await runAnalyticsRollups(now, scope);
  return { examined: collected.examined, updated: collected.updated, failed: collected.failed, rolledUp: rolled.written, syncedAt: now.toISOString() };
}
