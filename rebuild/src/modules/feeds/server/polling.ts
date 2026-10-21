import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { defaultFetchDeps, type FetchDeps } from '@/modules/publishing/server/media/network/net-guard';
import { FEEDS_BOUNDS } from '../config';
import { qualifyingOwner, type FeedAuthorization } from './access';
import { bounds, FEED_COLUMNS, idsOf, type FeedRow } from './core';
import { defaultPorts, ingestFeed, type FeedPorts } from './ingest';

/**
 * Automatic feed reading, run by the shared worker as the Publishing-declared `feedsPoll` job.
 *
 * The worker owns scheduling, the job lease and run history; this module owns per-feed claiming,
 * interval/backoff, exactly-once item creation and the eligibility rules.
 *
 *  - Per-feed claim: one compare-and-set UPDATE stamps `lastPolledAt` only while the feed is still due and
 *    on. Two workers racing for one feed cannot both win, and a worker that dies mid-run leaves the feed
 *    not due until the next interval (no double read). A feed is never read twice in one interval.
 *  - Interval: healthy feeds every `feeds.autoCheck.intervalSeconds`; each consecutive failure doubles the
 *    wait up to `feeds.autoCheck.maxBackoffMultiplier` x interval. After `disableAfterFailures` failures in
 *    a row the feed is turned off and audited.
 *  - Idempotency: the (feed, guid) unique pair, written in the same transaction as the post(s). A failed run
 *    rolls back whole and the next read takes the items again; a repeated run skips what exists.
 *  - Authority: the oldest active workspace owner whose current plan and grants allow feeds and whose access
 *    covers every destination (the workspace-owner worker policy). Rechecked inside the post transaction.
 *  - Approvals: items are held for review when the feed is set to `review` or the workspace requires approval;
 *    this job never publishes, only places posts in the queue for the delivery worker.
 *  - Stops per feed when it is turned off, its channels changed after validation, or the workspace is
 *    suspended or being erased (the guarded transaction refuses).
 */
export type PollSettings = { enabled: boolean; intervalSeconds: number; maxFeeds: number; maxBackoff: number; disableAfterFailures: number };
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= r.min && v <= r.max;
export async function pollSettings(): Promise<PollSettings | null> {
  try {
    const keys = ['feeds.autoCheck.enabled', 'feeds.autoCheck.intervalSeconds', 'feeds.autoCheck.maxFeedsPerRun', 'feeds.autoCheck.maxBackoffMultiplier', 'feeds.autoCheck.disableAfterFailures'];
    const [enabled, intervalSeconds, maxFeeds, maxBackoff, disableAfterFailures] = await Promise.all(keys.map(k => runtimeConfig(k)));
    if (typeof enabled !== 'boolean' || !inRange(intervalSeconds, FEEDS_BOUNDS.autoCheckIntervalSeconds) || !inRange(maxFeeds, FEEDS_BOUNDS.autoCheckMaxFeedsPerRun) || !inRange(maxBackoff, FEEDS_BOUNDS.autoCheckMaxBackoffMultiplier) || !inRange(disableAfterFailures, FEEDS_BOUNDS.autoCheckDisableAfterFailures)) return null;
    return { enabled, intervalSeconds, maxFeeds, maxBackoff, disableAfterFailures };
  } catch { return null; }
}

/** What the customer screen may say about automatic reading. */
export async function automaticCheckingStatus(): Promise<{ available: boolean; intervalMinutes: number | null }> {
  const s = await pollSettings();
  return s?.enabled ? { available: true, intervalMinutes: Math.round(s.intervalSeconds / 60) } : { available: false, intervalMinutes: null };
}

export type FeedPollOutcome = 'created' | 'checked' | 'not_modified' | 'lost_claim' | 'no_destinations' | 'no_qualifying_owner' | 'not_permitted' | 'failed';
export type FeedPollSummary = { reason?: 'disabled' | 'misconfigured'; examined: number; claimed: number; postsCreated: number; held: number; skipped: number; failed: number; outcomes: Array<{ feedId: string; outcome: FeedPollOutcome }>; recipes?: import('./wordpress-planner').RecipePlanSummary };
export type PollDeps = {
  /** Replaces the recipe planner's ports (tests). */
  recipes?: Partial<import('./wordpress-planner').PlannerPorts>;
  net?: FetchDeps; validateTargets?: FeedPorts['validate']; resolveFormats?: FeedPorts['formats']; shouldStop?: () => boolean; now?: () => Date;
  /** Replaces owner qualification (tests); the default is the workspace-owner worker policy. */
  qualify?: (workspaceId: string, validate: (actor: FeedAuthorization['actor']) => Promise<void>) => Promise<FeedAuthorization | null>;
};

/** Due predicate shared by the candidate scan and the claim: $1 interval s, $2 backoff ceiling. */
const DUE = `("lastPolledAt" IS NULL OR "lastPolledAt" + (LEAST(power(2, LEAST("pollErrorCount", 30)), $2::double precision) * $1::double precision) * interval '1 second' <= NOW())`;

/**
 * The `feedsPoll` job: RSS/Atom/WordPress-REST reading, then the WordPress recipe planner. The planner has its own
 * Root master switch (`feeds.wordpress.enabled`) and its own source switches, independent of automatic feed reading,
 * so one job schedule drives both and a failure in one never stops the other.
 */
export async function runFeedPolling(deps: PollDeps = {}): Promise<FeedPollSummary> {
  const summary = await pollRssFeeds(deps);
  try {
    const { runRecipePlanning } = await import('./wordpress-planner');
    const recipes = await runRecipePlanning(deps.recipes);
    if (recipes.reason !== 'disabled' && recipes.reason !== 'misconfigured') summary.recipes = recipes;
  } catch { /* planner problems are recorded per source; they never fail the feed job */ }
  return summary;
}

async function pollRssFeeds(deps: PollDeps = {}): Promise<FeedPollSummary> {
  const empty = (reason?: FeedPollSummary['reason']): FeedPollSummary => ({ ...(reason ? { reason } : {}), examined: 0, claimed: 0, postsCreated: 0, held: 0, skipped: 0, failed: 0, outcomes: [] });
  const settings = await pollSettings();
  if (!settings) return empty('misconfigured');
  if (!settings.enabled) return empty('disabled');
  const limits = await bounds().catch(() => null);
  if (!limits) return empty('misconfigured');
  const ports = await defaultPorts(deps.net ?? defaultFetchDeps());
  if (deps.validateTargets) ports.validate = deps.validateTargets;
  if (deps.resolveFormats) ports.formats = deps.resolveFormats;

  const due = await prisma.$queryRawUnsafe<Array<{ id: string; workspaceId: string }>>(
    `SELECT id, "workspaceId" FROM feed_sources WHERE enabled = true AND ${DUE} ORDER BY "lastPolledAt" ASC NULLS FIRST, id ASC LIMIT $3`,
    settings.intervalSeconds, settings.maxBackoff, settings.maxFeeds);
  const summary = empty(); summary.examined = due.length;
  const note = (feedId: string, outcome: FeedPollOutcome) => { summary.outcomes.push({ feedId, outcome }); };

  for (const candidate of due) {
    if (deps.shouldStop?.()) break;
    // The claim is the lease: it succeeds for exactly one worker and only while the feed is still due and on.
    const claimed = await prisma.$queryRawUnsafe<FeedRow[]>(
      `UPDATE feed_sources SET "lastPolledAt" = NOW() WHERE id = $3 AND "workspaceId" = $4 AND enabled = true AND ${DUE} RETURNING ${FEED_COLUMNS}`,
      settings.intervalSeconds, settings.maxBackoff, candidate.id, candidate.workspaceId).catch(() => null);
    const feed = claimed?.[0];
    if (!feed) { summary.skipped += 1; note(candidate.id, 'lost_claim'); continue; }
    summary.claimed += 1;
    const targetIds = idsOf(feed.targetIds);
    try {
      if (!targetIds.length) {
        await prisma.$executeRaw`UPDATE feed_sources SET "lastError" = ${'No channels are chosen for this feed.'} WHERE id = ${feed.id} AND "workspaceId" = ${candidate.workspaceId}`;
        summary.skipped += 1; note(feed.id, 'no_destinations'); continue;
      }
      // The same owner must hold the feature and reach every destination; grants of different owners are never combined.
      const validateFor = async (actor: FeedAuthorization['actor']) => { await ports.validate(actor, targetIds, limits.maxTargets, null, true); };
      const owner = await (deps.qualify ?? ((workspaceId, accept) => qualifyingOwner(workspaceId, accept)))(candidate.workspaceId, validateFor);
      if (!owner) { summary.skipped += 1; note(feed.id, 'no_qualifying_owner'); continue; }
      const result = await ingestFeed(owner.actor, feed, candidate.workspaceId, limits, { mode: 'posts', ports, now: (deps.now ?? (() => new Date()))(), automatic: true, disableAfterFailures: settings.disableAfterFailures });
      summary.postsCreated += result.postsCreated; summary.held += result.held;
      note(feed.id, result.postsCreated ? 'created' : result.notModified ? 'not_modified' : 'checked');
    } catch (error) {
      // Fetch and creation failures were already recorded on the feed (with backoff); only authority changes are skips.
      if (error instanceof OperationError && ['forbidden', 'unauthorized'].includes(error.code)) { summary.skipped += 1; note(feed.id, 'not_permitted'); }
      else { summary.failed += 1; note(feed.id, 'failed'); }
    }
  }
  return summary;
}
