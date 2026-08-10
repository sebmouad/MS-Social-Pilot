import { prisma } from '../prisma';
import { env } from '../env';
import { notifyTokenExpiring } from '../email/notify';
import { runEvergreenCycle } from '../evergreen';
import { pollDueSources } from '../rss/poll';
import { runSchedulerTick } from './runner';
import { syncPostInsights, syncWorkspaceAnalytics } from '../analytics';

/**
 * The worker's job set.
 *
 * Each job is an independent async function with the same shape, so the worker
 * loop is a table rather than a pile of branches, and any job can be run from a
 * test or the cron endpoint on its own.
 *
 * A job that throws must never stop the others — the loop catches per job.
 */

export type JobName = 'publish' | 'rss' | 'evergreen' | 'analytics' | 'pageInsights' | 'tokens';

export interface JobContext {
  now: Date;
  logger: (message: string, detail?: unknown) => void;
}

export interface JobDefinition {
  name: JobName;
  intervalMs: number;
  run: (context: JobContext) => Promise<string | null>;
}

/** Warn this many days before a token expires. */
const TOKEN_WARNING_DAYS = 7;
/** How many destinations one analytics pass refreshes. */
const ANALYTICS_BATCH = 50;

/**
 * Warn about tokens nearing expiry.
 *
 * This is what prevents the classic silent failure: a 60-day user token dies,
 * every scheduled post starts failing, and nobody notices until a client asks
 * why their page has gone quiet.
 */
export async function runTokenExpiryCheck(context: JobContext): Promise<string | null> {
  const horizon = new Date(context.now.getTime() + TOKEN_WARNING_DAYS * 24 * 60 * 60 * 1000);

  const accounts = await prisma.socialAccount.findMany({
    where: {
      invalidatedAt: null,
      tokenExpiresAt: { not: null, lte: horizon, gt: context.now },
      // Warn once per token, not daily until it dies.
      expiryWarningSentAt: null,
    },
    take: 100,
  });

  for (const account of accounts) {
    if (!account.tokenExpiresAt) continue;

    const days = Math.max(
      1,
      Math.ceil((account.tokenExpiresAt.getTime() - context.now.getTime()) / (24 * 60 * 60 * 1000)),
    );

    await notifyTokenExpiring({
      workspaceId: account.workspaceId,
      accountName: account.name,
      expiresAt: account.tokenExpiresAt,
      days,
    });

    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { expiryWarningSentAt: context.now },
    });
  }

  return accounts.length > 0 ? `warned about ${accounts.length} expiring token(s)` : null;
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
    take: ANALYTICS_BATCH,
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
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });

  let stored = 0;
  let failed = 0;

  for (const workspace of workspaces) {
    const results = await syncWorkspaceAnalytics({
      workspaceId: workspace.id,
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
  }

  if (stored === 0 && failed === 0) return null;
  return `stored=${stored} failed=${failed}`;
}

export function jobDefinitions(): JobDefinition[] {
  return [
    {
      name: 'publish',
      intervalMs: env.pollSeconds * 1000,
      run: async (context) => {
        const result = await runSchedulerTick({ now: context.now, logger: context.logger });
        return result.claimed > 0 || result.reclaimedStale > 0
          ? `claimed=${result.claimed} published=${result.published} failed=${result.failed} ` +
              `retrying=${result.retrying} reclaimed=${result.reclaimedStale}`
          : null;
      },
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
      name: 'tokens',
      intervalMs: env.tokenExpiryCheckHours * 60 * 60 * 1000,
      run: runTokenExpiryCheck,
    },
  ];
}
