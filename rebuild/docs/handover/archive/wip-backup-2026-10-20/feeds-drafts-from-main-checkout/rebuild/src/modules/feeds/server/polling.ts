import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { authorizeFeature, type ToolActor } from '@/modules/media/server/access';
import { defaultFetchDeps, type FetchDeps } from '@/modules/media/net-guard';
import { FEEDS_BOUNDS } from '../config';
import { bounds, FEED_COLUMNS_SQL, ingestFeed, type FeedDeps, type FeedRow } from './feeds';

/**
 * Automatic feed checking (module-owned, pure of worker plumbing).
 *
 * The shared worker owns scheduling, the job lease and run history; it calls `runFeedPolling`
 * on its schedule. This module owns per-feed claiming, interval/backoff, idempotent drafts and
 * the eligibility rules. The host supplies one port (`FeedPollingPort`) that names the
 * qualifying workspace owner; with no port registered the feature is simply absent.
 *
 *  - Per-feed claim: one compare-and-set UPDATE stamps `lastPolledAt` only if the feed is still
 *    due. Two workers racing for one feed cannot both win. The stamp doubles as the lease: a
 *    worker that dies mid-run leaves the feed not due until the next interval (no double read).
 *  - Interval: healthy feeds every `feeds.autoCheck.intervalSeconds`; each consecutive failure
 *    doubles the wait up to `feeds.autoCheck.maxBackoffMultiplier` x interval.
 *  - Idempotency: the (feed, guid) unique pair, same as the manual flow.
 *  - Drafts only. Never scheduled, approved or published. Same destination/scope hook
 *    (`validateTargets`) and write entitlement (`authorizeFeature`) as the manual flow, evaluated
 *    for the qualifying owner, and re-evaluated inside the draft transaction.
 *  - Stops per feed when it is turned off, its channels changed or were deselected, or the
 *    workspace is suspended/being erased (the guarded transaction refuses).
 */
export type FeedPollingPort = {
  /** An active owner of the workspace that currently has the Publishing feature, or null. Re-evaluated on every claim. */
  qualifyingActor(workspaceId: string): Promise<ToolActor | null>;
};

const KEY = Symbol.for('msp.feeds.pollingPort');
type Holder = { [KEY]?: FeedPollingPort };
/** Process-wide so the web and worker module graphs agree when they import the same registration module. */
export function registerFeedPolling(port: FeedPollingPort | null): void { (globalThis as Holder)[KEY] = port ?? undefined; }
export function registeredFeedPolling(): FeedPollingPort | null { return (globalThis as Holder)[KEY] ?? null; }

export type PollSettings = { enabled: boolean; intervalSeconds: number; maxFeeds: number; maxBackoff: number };
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= r.min && v <= r.max;
export async function pollSettings(): Promise<PollSettings | null> {
  try {
    const [enabled, intervalSeconds, maxFeeds, maxBackoff] = await Promise.all(['feeds.autoCheck.enabled', 'feeds.autoCheck.intervalSeconds', 'feeds.autoCheck.maxFeedsPerRun', 'feeds.autoCheck.maxBackoffMultiplier'].map(k => runtimeConfig(k)));
    if (typeof enabled !== 'boolean' || !inRange(intervalSeconds, FEEDS_BOUNDS.autoCheckIntervalSeconds) || !inRange(maxFeeds, FEEDS_BOUNDS.autoCheckMaxFeedsPerRun) || !inRange(maxBackoff, FEEDS_BOUNDS.autoCheckMaxBackoffMultiplier)) return null;
    return { enabled, intervalSeconds, maxFeeds, maxBackoff };
  } catch { return null; }
}

/** What the customer screen may say. Present only when a port is registered and Root turned it on. */
export async function automaticCheckingStatus(): Promise<{ available: boolean; intervalMinutes: number | null }> {
  if (!registeredFeedPolling()) return { available: false, intervalMinutes: null };
  const s = await pollSettings();
  return s?.enabled ? { available: true, intervalMinutes: Math.round(s.intervalSeconds / 60) } : { available: false, intervalMinutes: null };
}

export type FeedPollOutcome = 'drafted' | 'checked' | 'not_modified' | 'lost_claim' | 'no_qualifying_owner' | 'not_permitted' | 'failed';
export type FeedPollSummary = { reason?: 'no_port' | 'disabled' | 'misconfigured'; examined: number; claimed: number; draftsCreated: number; skipped: number; failed: number; outcomes: Array<{ feedId: string; outcome: FeedPollOutcome }> };
export type PollDeps = { port?: FeedPollingPort | null; net?: FetchDeps; validateTargets?: FeedDeps['validateTargets']; shouldStop?: () => boolean };

/** Due predicate shared by the candidate scan and the claim: $1 interval s, $2 backoff ceiling. */
const DUE = `("lastPolledAt" IS NULL OR "lastPolledAt" + (LEAST(power(2, LEAST("pollErrorCount", 30)), $2::double precision) * $1::double precision) * interval '1 second' <= NOW())`;

export async function runFeedPolling(deps: PollDeps = {}): Promise<FeedPollSummary> {
  const empty = (reason?: FeedPollSummary['reason']): FeedPollSummary => ({ ...(reason ? { reason } : {}), examined: 0, claimed: 0, draftsCreated: 0, skipped: 0, failed: 0, outcomes: [] });
  const port = deps.port === undefined ? registeredFeedPolling() : deps.port;
  if (!port) return empty('no_port');
  const settings = await pollSettings();
  if (!settings) return empty('misconfigured');
  if (!settings.enabled) return empty('disabled');
  const limits = await bounds().catch(() => null);
  if (!limits) return empty('misconfigured');
  const net = deps.net ?? defaultFetchDeps();

  const due = await prisma.$queryRawUnsafe<Array<{ id: string; workspaceId: string }>>(
    `SELECT id, "workspaceId" FROM feed_sources WHERE enabled = true AND ${DUE} ORDER BY "lastPolledAt" ASC NULLS FIRST, id ASC LIMIT $3`,
    settings.intervalSeconds, settings.maxBackoff, settings.maxFeeds);
  const summary = empty(); summary.examined = due.length;
  const note = (feedId: string, outcome: FeedPollOutcome) => { summary.outcomes.push({ feedId, outcome }); };

  for (const candidate of due) {
    if (deps.shouldStop?.()) break;
    // The claim is the lease: it succeeds for exactly one worker and only while the feed is still due and on.
    const claimed = await prisma.$queryRawUnsafe<Array<FeedRow & { pollErrorCount: number }>>(
      `UPDATE feed_sources SET "lastPolledAt" = NOW() WHERE id = $4 AND "workspaceId" = $5 AND enabled = true AND ${DUE} RETURNING ${FEED_COLUMNS_SQL()}, "pollErrorCount"`,
      settings.intervalSeconds, settings.maxBackoff, 0, candidate.id, candidate.workspaceId).catch(() => null);
    const feed = claimed?.[0];
    if (!feed) { summary.skipped += 1; note(candidate.id, 'lost_claim'); continue; }
    summary.claimed += 1;
    const previousErrors = Number(feed.pollErrorCount) || 0;
    try {
      const actor = await port.qualifyingActor(candidate.workspaceId);
      if (!actor || actor.workspaceId !== candidate.workspaceId) { summary.skipped += 1; note(feed.id, 'no_qualifying_owner'); continue; }
      // Same entitlement/role/purge boundary as a person using the screen.
      const auth = await authorizeFeature(actor, 'publishing/posts', 'write');
      if (!['owner', 'admin', 'editor', 'contributor'].includes(auth.role)) { summary.skipped += 1; note(feed.id, 'not_permitted'); continue; }
      const validate = deps.validateTargets ?? (async (a: ToolActor, ids: string[], max: number) => {
        const { validateTargets } = await import('@/server/publishing/lifecycle');
        return validateTargets({ userId: a.userId, workspaceId: a.workspaceId, ...(a.allowedTargetIds === undefined ? {} : { allowedTargetIds: a.allowedTargetIds }) }, ids, max);
      });
      const result = await ingestFeed(auth.actor, feed, limits, {
        createDrafts: true, net, validate, automatic: true,
        // The fetch stage already recorded its own failure; this covers eligibility/draft failures so backoff still grows.
        onDraftStageFailure: async () => { await prisma.$executeRaw`UPDATE feed_sources SET "lastError" = ${'Automatic drafts could not be created. Check the feed channels.'}, "pollErrorCount" = ${previousErrors + 1} WHERE id = ${feed.id} AND "workspaceId" = ${candidate.workspaceId}`; },
      });
      summary.draftsCreated += result.draftsCreated;
      note(feed.id, result.draftsCreated ? 'drafted' : result.notModified ? 'not_modified' : 'checked');
    } catch (error) {
      if (error instanceof OperationError && ['forbidden', 'unauthorized', 'unavailable'].includes(error.code) && !('reason' in error)) { summary.skipped += 1; note(feed.id, 'not_permitted'); }
      else { summary.failed += 1; note(feed.id, 'failed'); }
    }
  }
  return summary;
}
