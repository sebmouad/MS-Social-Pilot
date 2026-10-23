import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import type { JobName, WorkerDependencies, WorkerLogger } from './worker';
import type { RetryBackoff } from './retry';

/** Shared persistence and dispatch for the dedicated worker and the web monitoring observer. */
export function createWorkerDependencies(log: WorkerLogger): WorkerDependencies {
return {
  readConfig: runtimeConfig,
  async execute(job: JobName, now: Date, retryLimit: number, retryBackoff: RetryBackoff) {
    if (job === 'operatorMonitoring') {
      const { runOperatorMonitoring } = await import('@/modules/root/server/operator-monitoring');
      const result = await runOperatorMonitoring(now);
      return `opened=${result.opened.length} resolved=${result.resolved.length} checks=${result.checks.length}`;
    }
    if (job === 'postExports') {
      const { runPostExportBatch } = await import('@/modules/publishing/server/export/jobs');
      return runPostExportBatch();
    }
    if (job === 'publishingRecycle') {
      const { runPublishingRecycle } = await import('@/modules/publishing/server/automation');
      const result = await runPublishingRecycle(now);
      return Object.entries(result).map(([key, count]) => `${key}=${count}`).join(' ');
    }
    if (job === 'publishingMix') {
      const { runPublishingMix } = await import('@/modules/publishing/server/automation');
      const result = await runPublishingMix(now);
      return Object.entries(result).map(([key, count]) => `${key}=${count}`).join(' ');
    }
    if (job === 'feedsPoll') {
      const { formatFeedPollSummary, runFeedPolling } = await import('@/modules/feeds/server/polling');
      return formatFeedPollSummary(await runFeedPolling());
    }
    if (job === 'calendarHolidays' || job === 'calendarTrends') {
      const { formatRefreshSummary, refreshHolidays, refreshTrends } = await import('@/modules/calendar-extras/server/refresh');
      return formatRefreshSummary(await (job === 'calendarHolidays' ? refreshHolidays({ now }) : refreshTrends({ now })));
    }
    if (job === 'captionTests') {
      const { settleCaptionTests } = await import('@/modules/studio/caption-tests/server/service');
      return `settled=${await settleCaptionTests({ now: () => now })}`;
    }
    if (job === 'aiVideos') {
      const { pollAiVideos } = await import('@/modules/studio/content-tools/server/media');
      return `finished=${await pollAiVideos({ now: () => now })}`;
    }
    if (job === 'workspaceExports') {
      const { runWorkspaceExports } = await import('@/modules/settings/server/exports');
      return runWorkspaceExports();
    }
    if (job === 'purges') {
      const { resumePendingWorkspaceDataPurges } = await import('@/server/data-control');
      const { runAuditRetention } = await import('@/server/root/audit-retention');
      const audit = await runAuditRetention(now);
      const result = await resumePendingWorkspaceDataPurges();
      return `examined=${result.examined} completed=${result.completed} failed=${result.failed} auditRootDeleted=${audit.rootDeleted} auditWorkspaceDeleted=${audit.workspaceDeleted}`;
    }
    if (job === 'analyticsReports') {
      const { runScheduledReports } = await import('@/modules/analytics/server/report-workflows');
      const result = await runScheduledReports(now);
      return Object.entries(result).map(([key, value]) => `${key}=${value}`).join(' ');
    }
    if (job === 'analyticsAlerts') {
      const { runMetricAlerts } = await import('@/modules/analytics/alerts/server/workflows');
      const result = await runMetricAlerts(now);
      return Object.entries(result).map(([key, value]) => `${key}=${value}`).join(' ');
    }
    if (job === 'notifications') {
      const { deliverNotifications } = await import('@/modules/settings/notifications/delivery');
      const { scanConnectionAlerts } = await import('@/modules/settings/notifications/connection-alerts');
      await scanConnectionAlerts(now);
      const result = await deliverNotifications(now);
      const { runChatDeliveries } = await import('@/modules/notifications/chat-channels/server/delivery');
      const chat = await runChatDeliveries(now);
      return `examined=${result.examined} sent=${result.sent} cancelled=${result.cancelled} failed=${result.failed} uncertain=${result.uncertain} skipped=${result.skipped} purged=${result.purged} chatAccepted=${chat.accepted} chatRejected=${chat.rejected} chatUncertain=${chat.uncertain} chatCancelled=${chat.cancelled}`;
    }
    if (job === 'webhooks') {
      const { deliverDueWebhooks } = await import('@/modules/integrations/server/webhooks');
      const result = await deliverDueWebhooks(undefined, now);
      return `events=${result.events} delivered=${result.delivered} retrying=${result.retrying} failed=${result.failed} purged=${result.purged}`;
    }
    if (job === 'retention') {
      const { runRetentionSweep } = await import('@/modules/settings/server/retention');
      return runRetentionSweep(now);
    }
    if (job === 'sharingDeadlines') {
      const { runShareLinkDeadlines } = await import('@/modules/sharing/server/deadlines');
      return runShareLinkDeadlines(now);
    }
    if (job === 'scheduledAgents') {
      const { runDueScheduledAgents } = await import('@/modules/studio/agents/server/scheduled');
      return runDueScheduledAgents(now);
    }
    if (job === 'bestTimes') {
      const { runBestTimeApplication } = await import('@/modules/publishing/server/best-time-apply');
      return runBestTimeApplication(now);
    }
    if (job === 'mediaRetention') {
      const { runMediaRetention, formatMediaRetentionSummary } = await import('@/modules/media/server/retention');
      return formatMediaRetentionSummary(await runMediaRetention(now));
    }
    if (job === 'mediaCleanup') {
      const { cleanupOrphanImages } = await import('@/modules/publishing/server/media/storage');
      const result = await cleanupOrphanImages(now);
      return `removed=${result.removed} bytes=${result.bytes} failed=${result.errors}`;
    }
    const { publishDuePosts } = await import('@/server/jobs/sync');
    const { runEnabledPlatformJob } = await import('@/server/platforms/registry');
    if (job === 'posts') {
      const due = await publishDuePosts(now);
      const remote = await runEnabledPlatformJob('posts', now, retryLimit, retryBackoff);
      const { runDueFirstComments } = await import('@/modules/publishing/server/first-comment-jobs');
      const comments = await runDueFirstComments(new Date());
      return `due=${due.examined}/${due.updated} platform=${remote.examined}/${remote.updated} comments=${comments.examined}/${comments.sent} held=${comments.held} skipped=${due.skipped + remote.skipped + comments.skipped} failed=${due.failed + remote.failed + comments.failed}`;
    }
    if (job === 'analytics') {
      const result = await runEnabledPlatformJob('analytics', now, retryLimit, retryBackoff);
      return `examined=${result.examined} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`;
    }
    const result = await runEnabledPlatformJob('inbox', now, retryLimit, retryBackoff);
    const { runAutomaticInboxModeration } = await import('@/modules/inbox/server/moderation');
    const moderation = await runAutomaticInboxModeration(new Date()).catch(() => null);
    const { runInboxAlertProducers } = await import('@/modules/inbox/server/notification-events');
    await runInboxAlertProducers(now);
    const { reconcileInboxDeletions } = await import('@/modules/inbox/server/deletion-reconcile');
    const deletions = await reconcileInboxDeletions(now).catch(() => null);
    const rules =moderation ? `rules=${moderation.workspaces}/${moderation.acted} rulesFailed=${moderation.failed}` : 'rules=unavailable';
    return `examined=${result.examined} updated=${result.updated} skipped=${result.skipped} failed=${result.failed} ${rules} deletions=${deletions ? `${deletions.examined}/${deletions.updated}` : 'unavailable'}`;
  },
  async tryLease(job, leaseOwner, token, until) {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      INSERT INTO rebuild_job_leases (name, owner, token, "leaseExpiresAt", "updatedAt")
      VALUES (${job}, ${leaseOwner}, ${token}, ${until}, NOW())
      ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, token = EXCLUDED.token,
        "leaseExpiresAt" = EXCLUDED."leaseExpiresAt", "updatedAt" = NOW()
      WHERE rebuild_job_leases."leaseExpiresAt" <= NOW()
      RETURNING name`;
    return rows.length === 1;
  },
  async renewLease(job, token, until) {
    const count = await prisma.$executeRaw`UPDATE rebuild_job_leases SET "leaseExpiresAt" = ${until}, "updatedAt" = NOW() WHERE name = ${job} AND token = ${token}`;
    return count === 1;
  },
  async releaseLease(job, token) {
    await prisma.$executeRaw`DELETE FROM rebuild_job_leases WHERE name = ${job} AND token = ${token}`;
  },
  async writeRun(run) {
    await prisma.$executeRaw`INSERT INTO rebuild_sync_runs (id, job, owner, "startedAt", "finishedAt", outcome, attempts, summary, error)
      VALUES (${run.id}, ${run.job}, ${run.owner}, ${run.startedAt}, ${run.finishedAt}, ${run.outcome}, ${run.attempts}, ${run.summary ?? null}, ${run.error ?? null})`;
    const failed = run.outcome === 'failed';
    await prisma.$executeRaw`INSERT INTO worker_job_runs (name, "startedAt", "finishedAt", "durationMs", outcome, summary, "lastError", "lastErrorAt", failures)
      VALUES (${run.job}, ${run.startedAt}, ${run.finishedAt}, ${run.finishedAt.getTime() - run.startedAt.getTime()}, ${run.outcome}, ${run.summary ?? null}, ${run.error ?? null}, ${failed ? run.finishedAt : null}, ${failed ? 1 : 0})
      ON CONFLICT (name) DO UPDATE SET "startedAt" = EXCLUDED."startedAt", "finishedAt" = EXCLUDED."finishedAt", "durationMs" = EXCLUDED."durationMs", outcome = EXCLUDED.outcome, summary = EXCLUDED.summary, "lastError" = EXCLUDED."lastError", "lastErrorAt" = EXCLUDED."lastErrorAt", failures = CASE WHEN EXCLUDED.outcome = 'failed' THEN worker_job_runs.failures + 1 ELSE 0 END`;
  },
  async writeHeartbeat(workerId, activeJobs, at) {
    await prisma.$executeRaw`INSERT INTO worker_heartbeats ("workerId", "seenAt", jobs) VALUES (${workerId}, ${at}, ${activeJobs})
      ON CONFLICT ("workerId") DO UPDATE SET "seenAt" = EXCLUDED."seenAt", jobs = EXCLUDED.jobs`;
  },
  async alreadyRanThisMinute(job, from, until) {
    const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS (SELECT 1 FROM rebuild_sync_runs WHERE job = ${job} AND "startedAt" >= ${from} AND "startedAt" < ${until}) AS present`;
    return rows[0]?.present === true;
  },
  logger: log,
};
}
