import { runWorkerAlertChecks } from '../system-alerts';
import { prisma } from '../prisma';
import { backgroundBudget } from '../facebook/budget';
import { postDueFirstComments, postFirstComment } from '../first-comment';
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
import { sendDueReports } from '../report-schedules';

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
  | 'tokens'
  | 'reports'
  | 'alerts';

export interface JobContext {
  now: Date;
  logger: (message: string, detail?: unknown) => void;
  /** Ask to run again sooner than the interval: a sync that stood aside. */
  defer?: (ms: number) => void;
}

/**
 * A background sync that spends Graph calls only while the app has some to
 * spare. Publishing is never wrapped: it is what the allowance is kept for.
 * A sync that stands aside asks to be tried again once the window has moved,
 * rather than waiting out a six- or twelve-hour interval.
 */
function withinBudget(run: (context: JobContext) => Promise<string | null>) {
  return async (context: JobContext): Promise<string | null> => {
    const verdict = backgroundBudget(context.now.getTime());
    if (!verdict.ok) {
      context.defer?.(verdict.retryInMs);
      return `waiting: ${verdict.reason}; publishing keeps the rest`;
    }
    return run(context);
  };
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
      // Facebook's tokens: the other networks' refresh themselves on publishing.
      provider: 'facebook',
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
 * How long after its scheduled moment a Facebook-held post may stay
 * unconfirmed. A week of checks is long enough to outlast an expired token
 * being renewed or a Graph outage; past that, "Scheduled" is no longer a
 * plausible state and saying so beats saying nothing.
 */
const NATIVE_CONFIRM_GIVE_UP_DAYS = 7;

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
 *
 * The batch rotates: rows are taken least-recently-checked first, and a row
 * that could not be confirmed is stamped (`updatedAt`) so the next pass starts
 * with the others. Ordering by scheduled time alone meant a hundred rows that
 * never confirm — no token, a post Facebook will not describe — were the whole
 * batch every pass, and everything scheduled after them was never asked about.
 * A row still unconfirmed {@link NATIVE_CONFIRM_GIVE_UP_DAYS} days after its
 * moment is settled as failed with an explanation instead of waiting for ever.
 */
export async function runNativeReconcile(context: JobContext): Promise<string | null> {
  const rows = await prisma.postTarget.findMany({
    where: {
      status: 'scheduled_remote',
      remotePostId: { not: null },
      nativeScheduledFor: { lte: context.now },
    },
    include: { target: { include: { socialAccount: true } } },
    orderBy: [{ updatedAt: 'asc' }, { nativeScheduledFor: 'asc' }],
    take: 100,
  });

  const giveUpBefore = new Date(context.now.getTime() - NATIVE_CONFIRM_GIVE_UP_DAYS * 24 * 60 * 60 * 1000);

  let published = 0;
  let missing = 0;
  let unconfirmed = 0;
  const touched = new Set<string>();

  /** Nothing definite this pass: give up if it has been long enough, else rotate. */
  async function leaveUnconfirmed(row: (typeof rows)[number]): Promise<void> {
    if (row.nativeScheduledFor && row.nativeScheduledFor < giveUpBefore) {
      const { count } = await prisma.postTarget.updateMany({
        where: { id: row.id, status: 'scheduled_remote' },
        data: {
          status: 'failed',
          errorCode: 'unconfirmed_on_facebook',
          errorMessage:
            'Facebook never confirmed that this post went out. Check the Page to see whether it was published.',
        },
      });
      if (count > 0) {
        unconfirmed += 1;
        touched.add(row.postId);
      }
      return;
    }
    // Wall-clock rather than `context.now`: the stamp orders rows against
    // other writes to them, which Prisma stamps with the real time.
    await prisma.postTarget.updateMany({
      where: { id: row.id, status: 'scheduled_remote' },
      data: { updatedAt: new Date() },
    });
  }

  for (const row of rows) {
    const encrypted = row.target.accessToken ?? row.target.socialAccount?.accessToken ?? null;
    if (!encrypted || !row.remotePostId) {
      await leaveUnconfirmed(row);
      continue;
    }

    try {
      const state = await fetchRemotePostState(row.remotePostId, decryptSecret(encrypted));
      // `null` means Facebook did not tell us, which is not the same as "no".
      // Leaving the row alone costs one more check next pass; guessing costs a
      // post marked published that never went out.
      if (state.isPublished !== true) {
        await leaveUnconfirmed(row);
        continue;
      }

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
      // Facebook published it on its own; this is the first moment we know,
      // and so the first moment its comment can go under it.
      await postFirstComment(row.id, context.now);
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
      await leaveUnconfirmed(row);
    }
  }

  for (const postId of touched) await refreshPostStatus(postId, context.now);

  if (published === 0 && missing === 0 && unconfirmed === 0) return null;
  return `native: ${published} published, ${missing} gone from Facebook, ${unconfirmed} never confirmed`;
}

/**
 * Refresh engagement figures, stalest first.
 *
 * Deliberately batched: these counters move slowly, and refreshing everything
 * would spend the app's rate limit for no benefit.
 */
export async function runAnalyticsRefresh(context: JobContext): Promise<string | null> {
  const rows = await prisma.postTarget.findMany({
    where: { status: 'published', remotePostId: { not: null }, remoteMissingAt: null },
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
        // Comments set to wait after their post, whose time has come.
        const comments = await postDueFirstComments(context.now);
        const moved =
          result.claimed > 0 ||
          result.reclaimedStale > 0 ||
          result.abandonedStale > 0 ||
          result.skipped > 0;
        const commented =
          comments.posted + comments.failed > 0
            ? ` comments=${comments.posted}${comments.failed ? ` commentFailures=${comments.failed}` : ''}`
            : '';
        return moved
          ? `claimed=${result.claimed} published=${result.published} failed=${result.failed} ` +
              `retrying=${result.retrying} reclaimed=${result.reclaimedStale} ` +
              `abandoned=${result.abandonedStale} skipped=${result.skipped}${commented}`
          : commented
            ? commented.trim()
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
      run: withinBudget(runAnalyticsRefresh),
    },
    {
      name: 'pageInsights',
      intervalMs: env.pageInsightsHours * 60 * 60 * 1000,
      run: withinBudget(runPageInsightsSync),
    },
    {
      name: 'edges',
      intervalMs: env.edgeSyncHours * 60 * 60 * 1000,
      run: withinBudget(runEdgeSync),
    },
    // Instagram and Ads need permissions Meta reviews separately. Running them
    // unapproved would spend the rate limit on a permission error every pass,
    // so they are only scheduled once the app is actually allowed to ask.
    ...(env.instagramEnabled
      ? [
          {
            name: 'instagram' as const,
            intervalMs: env.instagramSyncHours * 60 * 60 * 1000,
            run: withinBudget(runInstagramSync),
          },
        ]
      : []),
    ...(env.adsEnabled
      ? [
          {
            name: 'ads' as const,
            intervalMs: env.adsSyncHours * 60 * 60 * 1000,
            run: withinBudget(runAdsSync),
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
    {
      // Root's alerts: database reads and a disk check, no Graph calls.
      name: 'alerts',
      intervalMs: 5 * 60 * 1000,
      run: async ({ now }) => {
        const { opened, resolved } = await runWorkerAlertChecks(now.getTime());
        return opened.length + resolved.length > 0 ? `alerts opened=${opened.join(',')} resolved=${resolved.join(',')}` : null;
      },
    },
    {
      // Email only: no Graph calls, so it runs outside the budget.
      name: 'reports',
      intervalMs: 10 * 60 * 1000,
      run: async ({ now }) => {
        const { sent, failed } = await sendDueReports(now);
        return sent + failed > 0 ? `${sent} report(s) sent, ${failed} failed` : null;
      },
    },
  ];
}
