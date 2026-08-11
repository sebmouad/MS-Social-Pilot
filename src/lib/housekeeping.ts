import { prisma } from './prisma';
import { settingNumber } from './settings';

/**
 * Retention for the tables that only ever grow.
 *
 * Several tables here are append-only records of things that already happened:
 * an audit entry per publish, an email log per notification, a row per click on
 * a short link, a row per AI call. Nothing deletes them, and on a busy agency
 * workspace they outgrow everything else in the database within a year while
 * being the rows nobody reads past the first month.
 *
 * Two categories are deliberately excluded, and the reasons matter more than
 * the code:
 *
 * - **`FeedItem` is a de-duplication ledger, not history.** Its guids are what
 *   stop an RSS feed republishing its archive and flooding a client's page.
 *   Pruning it would re-post years-old articles the moment a feed touched them,
 *   which is the single worst failure this product could have. It grows, and it
 *   stays.
 *
 * - **Insight snapshots are the product.** `PageInsight` and friends exist
 *   precisely because Graph only serves about two years of history; deleting
 *   them to save space would throw away the thing the analytics module was
 *   built to keep. An operator who genuinely needs that space can delete rows
 *   deliberately; a background job must not decide it for them.
 *
 * Sessions are already pruned opportunistically on every login, so they are not
 * repeated here.
 */

export interface PruneResult {
  activityLogs: number;
  emailLogs: number;
  linkClicks: number;
  aiGenerations: number;
}

export function prunedTotal(result: PruneResult): number {
  return (
    result.activityLogs + result.emailLogs + result.linkClicks + result.aiGenerations
  );
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Delete records older than their configured retention.
 *
 * Scoped by workspace so one client's retention never touches another's, and so
 * the job can spread the work over several passes rather than locking a table
 * for every tenant at once.
 */
export async function pruneHistory(options: {
  workspaceId: string;
  now?: Date;
}): Promise<PruneResult> {
  const now = options.now ?? new Date();
  const workspaceId = options.workspaceId;

  const [activityLogs, emailLogs, linkClicks, aiGenerations] = await Promise.all([
    prisma.activityLog.deleteMany({
      where: { workspaceId, createdAt: { lt: cutoff(now, settingNumber('retention.activityDays')) } },
    }),
    prisma.emailLog.deleteMany({
      where: { workspaceId, createdAt: { lt: cutoff(now, settingNumber('retention.emailDays')) } },
    }),
    // The headline number lives on ShortLink.clickCount, so removing the detail
    // rows costs the per-day breakdown and nothing else.
    prisma.linkClick.deleteMany({
      where: {
        shortLink: { workspaceId },
        createdAt: { lt: cutoff(now, settingNumber('retention.clickDays')) },
      },
    }),
    // The spend audit trail. Kept longest by default, because "why was the bill
    // that size" is a question asked months later.
    prisma.aiGeneration.deleteMany({
      where: { workspaceId, createdAt: { lt: cutoff(now, settingNumber('retention.aiDays')) } },
    }),
  ]);

  return {
    activityLogs: activityLogs.count,
    emailLogs: emailLogs.count,
    linkClicks: linkClicks.count,
    aiGenerations: aiGenerations.count,
  };
}
