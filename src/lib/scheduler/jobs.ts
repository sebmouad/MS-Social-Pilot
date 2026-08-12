import { prisma } from '../prisma';
import { env } from '../env';
import { notifyTokenExpiring } from '../email/notify';
import { runEvergreenCycle } from '../evergreen';
import { pollDueSources } from '../rss/poll';
import { refreshPostStatus, runSchedulerTick } from './runner';
import { syncPostInsights, syncWorkspaceAnalytics } from '../analytics';
import { syncTargetEdges } from '../engagement';
import { discoverInstagramAccounts, syncWorkspaceInstagram } from '../instagram';
import { discoverAdAccounts, syncWorkspaceAds } from '../ads';
import { deleteUnusedMedia } from '../media';
import { pruneHistory, prunedTotal } from '../housekeeping';
import { forEachEnabledPage, forEachWorkspace } from './iterate';
import { fetchRemotePostState } from '../facebook/publish';
import { asGraphError } from '../facebook/graph';
import { decryptSecret } from '../crypto';

/**
 * The worker's job set.
 *
 * Each job is an independent async function with the same shape, so the worker
 * loop is a table rather than a pile of branches, and any job can be run from a
 * test or the cron endpoint on its own.
 *
 * A job that throws must never stop the others — the loop catches per job.
 */

export type JobName =
  | 'publish'
  | 'nativeReconcile'
  | 'rss'
  | 'evergreen'
  | 'analytics'
  | 'pageInsights'
  | 'edges'
  | 'instagram'
  | 'ads'
  | 'housekeeping'
  | 'tokens';

export interface JobContext {
  now: Date;
  logger: (message: string, detail?: unknown) => void;
}

export interface JobDefinition {
  name: JobName;
  intervalMs: number;
  run: (context: JobContext) => Promise<string | null>;
}


/**
 * Warn about tokens nearing expiry.
 *
 * This is what prevents the classic silent failure: a 60-day user token dies,
 * every scheduled post starts failing, and nobody notices until a client asks
 * why their page has gone quiet.
 */
export async function runTokenExpiryCheck(context: JobContext): Promise<string | null> {
  const horizon = new Date(context.now.getTime() + env.tokenWarningDays * 24 * 60 * 60 * 1000);

  const accounts = await prisma.socialAccount.findMany({
    where: {
      invalidatedAt: null,
      tokenExpiresAt: { not: null, lte: horizon, gt: context.now },
      // Warn once per token, not daily until it dies.
      expiryWarningSentAt: null,
    },
    take: 100,
  });

  let warned = 0;

  for (const account of accounts) {
    if (!account.tokenExpiresAt) continue;

    const days = Math.max(
      1,
      Math.ceil((account.tokenExpiresAt.getTime() - context.now.getTime()) / (24 * 60 * 60 * 1000)),
    );

    // Claim the warning before sending it. "Once per token" has to hold across
    // workers, not just across runs: every worker runs every job, so each one
    // read this same unwarned account and would send the client its own copy.
    //
    // Marking first costs nothing that was not already lost — `notifyTokenExpiring`
    // swallows its own failures, so the send result was never consulted here
    // anyway, and a failed send is recorded in the email log either way.

    const { count: claimed } = await prisma.socialAccount.updateMany({
      where: { id: account.id, expiryWarningSentAt: null },
      data: { expiryWarningSentAt: context.now },
    });
    if (claimed === 0) continue;

    await notifyTokenExpiring({
      workspaceId: account.workspaceId,
      accountName: account.name,
      expiresAt: account.tokenExpiresAt,
      days,
    });
    warned += 1;
  }

  return warned > 0 ? `warned about ${warned} expiring token(s)` : null;
}

/**
 * Find out whether the posts Facebook is holding have gone out yet.
 *
 * Native scheduling hands the post to Facebook at creation time and Facebook
 * publishes it later on its own. Nothing tells us when that happens. Without
 * asking, a `scheduled_remote` destination stays that way for ever: the post
 * reads "Scheduled" months after it went live, never gets a `publishedAt`, and
 * is invisible to the analytics refresh, which only looks at published rows.
 * So the whole point of choosing native mode — the post survives our downtime
 * — came at the price of the post vanishing from every report.
 *
 * Only destinations whose scheduled moment has passed are worth asking about,
 * which keeps this to one Graph call per post, once.
 */
export async function runNativeReconcile(context: JobContext): Promise<string | null> {
  const rows = await prisma.postTarget.findMany({
    where: {
      status: 'scheduled_remote',
      remotePostId: { not: null },
      nativeScheduledFor: { lte: context.now },
    },
    include: { target: { include: { socialAccount: true } } },
    orderBy: { nativeScheduledFor: 'asc' },
    take: 100,
  });

  let published = 0;
  let missing = 0;
  const touched = new Set<string>();

  for (const row of rows) {
    const encrypted = row.target.accessToken ?? row.target.socialAccount?.accessToken ?? null;
    if (!encrypted || !row.remotePostId) continue;

    try {
      const state = await fetchRemotePostState(row.remotePostId, decryptSecret(encrypted));
      // `null` means Facebook did not tell us, which is not the same as "no".
      // Leaving the row alone costs one more check next pass; guessing costs a
      // post marked published that never went out.
      if (state.isPublished !== true) continue;

      const { count } = await prisma.postTarget.updateMany({
        where: { id: row.id, status: 'scheduled_remote' },
        data: {
          status: 'published',
          publishedAt: state.createdTime ?? row.nativeScheduledFor ?? context.now,
        },
      });
      if (count === 0) continue;

      published += 1;
      touched.add(row.postId);
    } catch (error) {
      const graphError = asGraphError(error);

      // Code 100 on a post we hold an id for means it is not there any more —
      // somebody deleted it in Facebook. Saying so is the point: the post
      // never went out, and left as `scheduled_remote` it would claim for ever
      // that it is about to.
      if (graphError.code === 100) {
        const { count } = await prisma.postTarget.updateMany({
          where: { id: row.id, status: 'scheduled_remote' },
          data: {
            status: 'failed',
            errorCode: 'deleted_on_facebook',
            errorMessage:
              'This post is no longer on Facebook. It was most likely deleted there, so it never went out.',
          },
        });
        if (count > 0) {
          missing += 1;
          touched.add(row.postId);
        }
        continue;
      }

      context.logger(
        `Could not check ${row.target.name} on Facebook: ${graphError.displayMessage}`,
      );
    }
  }

  for (const postId of touched) await refreshPostStatus(postId, context.now);

  if (published === 0 && missing === 0) return null;
  return `native: ${published} published, ${missing} gone from Facebook`;
}

/**
 * Refresh engagement figures, stalest first.
 *
 * Deliberately batched: these counters move slowly, and refreshing everything
 * would spend the app's rate limit for no benefit.
 */
export async function runAnalyticsRefresh(context: JobContext): Promise<string | null> {
  const rows = await prisma.postTarget.findMany({
    where: { status: 'published', remotePostId: { not: null } },
    orderBy: [{ insightsSyncedAt: { sort: 'asc', nulls: 'first' } }, { publishedAt: 'desc' }],
    take: env.analyticsBatch,
    select: { id: true, target: { select: { name: true } } },
  });

  let refreshed = 0;
  let metrics = 0;

  for (const row of rows) {
    // The full per-post catalogue, not just the four headline numbers: a bad
    // metric name costs only itself, since the fetcher bisects.
    const result = await syncPostInsights(row.id);
    if (result.ok) {
      refreshed += 1;
      metrics += result.metrics;
    } else if (result.error) {
      context.logger(`Analytics refresh failed for ${row.target.name}: ${result.error}`);
    }
  }

  return refreshed > 0 ? `refreshed ${refreshed} post(s), ${metrics} metric reads` : null;
}

/**
 * Pull Page-level insights for every enabled Page.
 *
 * Separate from `analytics`, which refreshes per-post numbers: this one reads
 * the whole Page catalogue and stores snapshots, because Graph serves only
 * about two years of history and drops metrics between versions.
 */
export async function runPageInsightsSync(context: JobContext): Promise<string | null> {
  let stored = 0;
  let failed = 0;

  const pass = await forEachWorkspace(async (workspaceId) => {
    const results = await syncWorkspaceAnalytics({
      workspaceId,
      // A week back each run, so a missed day is filled in on the next.
      since: new Date(context.now.getTime() - 7 * 24 * 60 * 60 * 1000),
      until: context.now,
    });

    for (const result of results) {
      stored += result.stored;
      if (result.error) {
        failed += 1;
        context.logger(`${result.targetName}: ${result.error}`);
      }
    }
  });

  failed += pass.failures.length;
  for (const failure of pass.failures) context.logger(`Workspace ${failure.id}: ${failure.message}`);

  if (stored === 0 && failed === 0) return null;
  return `stored=${stored} failed=${failed}`;
}

/**
 * Refresh the non-insights edges: comments, reviews, inbox, videos, and posts
 * published outside this app.
 *
 * Runs against every enabled Page rather than a batch, because these edges are
 * cheap per call and stale comments are the ones people notice.
 */
export async function runEdgeSync(context: JobContext): Promise<string | null> {
  let comments = 0;
  let reviews = 0;
  let conversations = 0;
  let external = 0;
  let failed = 0;

  const pass = await forEachEnabledPage(async (targetId) => {
    const result = await syncTargetEdges({ targetId, now: context.now });
    comments += result.comments;
    reviews += result.reviews;
    conversations += result.conversations;
    external += result.externalPosts;

    for (const error of result.errors) {
      failed += 1;
      context.logger(`${result.targetName} ${error.edge}: ${error.message}`);
    }
  });

  failed += pass.failures.length;
  for (const failure of pass.failures) context.logger(`Page ${failure.id}: ${failure.message}`);

  if (comments + reviews + conversations + external + failed === 0) return null;
  return `comments=${comments} reviews=${reviews} threads=${conversations} external=${external} failed=${failed}`;
}

/**
 * Discover and refresh Instagram Business accounts.
 *
 * Discovery runs every pass rather than once: an account can be linked to a
 * Page at any time, and there is no webhook that tells us when.
 */
export async function runInstagramSync(context: JobContext): Promise<string | null> {
  let accounts = 0;
  let stored = 0;
  let failed = 0;

  const pass = await forEachWorkspace(async (workspaceId) => {
    const discovery = await discoverInstagramAccounts(workspaceId);
    for (const error of discovery.errors) context.logger(`Instagram discovery: ${error}`);

    const results = await syncWorkspaceInstagram({
      workspaceId,
      since: new Date(context.now.getTime() - env.edgeWindowDays * 24 * 60 * 60 * 1000),
      until: context.now,
    });

    for (const result of results) {
      accounts += 1;
      stored += result.stored;
      if (result.error) {
        failed += 1;
        context.logger(`Instagram ${result.username}: ${result.error}`);
      }
    }
  });

  failed += pass.failures.length;
  for (const failure of pass.failures) context.logger(`Workspace ${failure.id}: ${failure.message}`);

  if (accounts === 0 && failed === 0) return null;
  return `accounts=${accounts} stored=${stored} failed=${failed}`;
}

/** Discover and refresh ad accounts, so spend can sit next to organic reach. */
export async function runAdsSync(context: JobContext): Promise<string | null> {
  let rows = 0;
  let failed = 0;

  const pass = await forEachWorkspace(async (workspaceId) => {
    const discovery = await discoverAdAccounts(workspaceId);
    for (const error of discovery.errors) context.logger(`Ads discovery: ${error}`);

    const results = await syncWorkspaceAds({
      workspaceId,
      since: new Date(context.now.getTime() - env.adWindowDays * 24 * 60 * 60 * 1000),
      until: context.now,
    });

    for (const result of results) {
      rows += result.rows;
      if (result.error) {
        failed += 1;
        context.logger(`Ads ${result.name}: ${result.error}`);
      }
    }
  });

  failed += pass.failures.length;
  for (const failure of pass.failures) context.logger(`Workspace ${failure.id}: ${failure.message}`);

  if (rows === 0 && failed === 0) return null;
  return `rows=${rows} failed=${failed}`;
}

/**
 * Sweep what nothing will ever read again.
 *
 * Two kinds of growth, one pass. Uploads nobody attached to a post — someone
 * adds an image, changes their mind, closes the composer — and the append-only
 * records of things that already happened: the audit trail, the email log, the
 * click detail, the AI spend log.
 *
 * A media file used by any post is kept whatever that post's status; deleting
 * one a published post still renders turns history into broken images. What is
 * deliberately *not* swept, and why, is documented in `src/lib/housekeeping.ts`
 * — the RSS de-duplication ledger above all, because pruning it would re-post a
 * feed's entire archive.
 */
export async function runHousekeeping(context: JobContext): Promise<string | null> {
  let files = 0;
  let bytes = 0;
  let records = 0;

  const pass = await forEachWorkspace(async (workspaceId) => {
    const media = await deleteUnusedMedia({
      workspaceId,
      olderThanDays: env.mediaRetainUnusedDays,
      now: context.now,
    });

    files += media.removed;
    bytes += media.bytes;
    for (const error of media.errors) context.logger(`Media cleanup: ${error}`);

    records += prunedTotal(await pruneHistory({ workspaceId, now: context.now }));
  });

  for (const failure of pass.failures) context.logger(`Workspace ${failure.id}: ${failure.message}`);

  if (files === 0 && records === 0 && pass.failures.length === 0) return null;
  return `pruned ${records} record(s), removed ${files} unused file(s) (${Math.round(bytes / 1024)}KB)`;
}

export function jobDefinitions(): JobDefinition[] {
  return [
    {
      name: 'publish',
      intervalMs: env.pollSeconds * 1000,
      run: async (context) => {
        const result = await runSchedulerTick({ now: context.now, logger: context.logger });
        const moved =
          result.claimed > 0 ||
          result.reclaimedStale > 0 ||
          result.abandonedStale > 0 ||
          result.skipped > 0;
        return moved
          ? `claimed=${result.claimed} published=${result.published} failed=${result.failed} ` +
              `retrying=${result.retrying} reclaimed=${result.reclaimedStale} ` +
              `abandoned=${result.abandonedStale} skipped=${result.skipped}`
          : null;
      },
    },
    {
      name: 'nativeReconcile',
      intervalMs: env.nativeReconcileMinutes * 60 * 1000,
      run: runNativeReconcile,
    },
    {
      name: 'rss',
      intervalMs: env.rssPollMinutes * 60 * 1000,
      run: async (context) => {
        const result = await pollDueSources({
          now: context.now,
          intervalMinutes: env.rssPollMinutes,
          logger: context.logger,
        });
        return result.polled > 0
          ? `polled=${result.polled} created=${result.created} errors=${result.errors}`
          : null;
      },
    },
    {
      name: 'evergreen',
      intervalMs: env.evergreenCheckMinutes * 60 * 1000,
      run: async (context) => {
        const result = await runEvergreenCycle({ now: context.now, logger: context.logger });
        return result.created > 0 ? `recycled=${result.created} finished=${result.finished}` : null;
      },
    },
    {
      name: 'analytics',
      intervalMs: env.analyticsRefreshHours * 60 * 60 * 1000,
      run: runAnalyticsRefresh,
    },
    {
      name: 'pageInsights',
      intervalMs: env.pageInsightsHours * 60 * 60 * 1000,
      run: runPageInsightsSync,
    },
    {
      name: 'edges',
      intervalMs: env.edgeSyncHours * 60 * 60 * 1000,
      run: runEdgeSync,
    },
    // Instagram and Ads need permissions Meta reviews separately. Running them
    // unapproved would spend the rate limit on a permission error every pass,
    // so they are only scheduled once the app is actually allowed to ask.
    ...(env.instagramEnabled
      ? [
          {
            name: 'instagram' as const,
            intervalMs: env.instagramSyncHours * 60 * 60 * 1000,
            run: runInstagramSync,
          },
        ]
      : []),
    ...(env.adsEnabled
      ? [
          {
            name: 'ads' as const,
            intervalMs: env.adsSyncHours * 60 * 60 * 1000,
            run: runAdsSync,
          },
        ]
      : []),
    {
      name: 'housekeeping',
      intervalMs: env.housekeepingHours * 60 * 60 * 1000,
      run: runHousekeeping,
    },
    {
      name: 'tokens',
      intervalMs: env.tokenExpiryCheckHours * 60 * 60 * 1000,
      run: runTokenExpiryCheck,
    },
  ];
}
