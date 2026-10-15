import { hostname } from 'node:os';
import { prisma } from '../src/server/data';
import { runtimeConfig } from '../src/server/config/store';
import { createWorker, type JobName, type WorkerDependencies } from '../src/server/jobs/worker';
import type { RetryBackoff } from '../src/server/jobs/retry';

const owner = `rebuild-${hostname()}-${process.pid}`;
let stopping = false;
const log = (message: string, detail?: unknown) => console.log(`${new Date().toISOString()} [${owner}] ${message}`, detail ?? '');

const dependencies: WorkerDependencies = {
  readConfig: runtimeConfig,
  async execute(job: JobName, now: Date, retryLimit: number, retryBackoff: RetryBackoff) {
    if (job === 'purges') {
      const { resumePendingWorkspaceDataPurges } = await import('../src/server/data-control');
      const result = await resumePendingWorkspaceDataPurges();
      return `examined=${result.examined} completed=${result.completed} failed=${result.failed}`;
    }
    if (job === 'mediaCleanup') {
      const { cleanupOrphanImages } = await import('../src/server/media/storage');
      const result = await cleanupOrphanImages(now);
      return `removed=${result.removed} bytes=${result.bytes} failed=${result.errors}`;
    }
    const { publishDuePosts, syncAdsAnalytics, syncInbox, syncPageAnalytics, syncScheduledPostStatus } = await import('../src/server/jobs/sync');
    if (job === 'posts') {
      const due = await publishDuePosts(now);
      const remote = await syncScheduledPostStatus(now, retryLimit, retryBackoff);
      return `due=${due.examined}/${due.updated} remote=${remote.examined}/${remote.updated} skipped=${due.skipped + remote.skipped} failed=${due.failed + remote.failed}`;
    }
    if (job === 'analytics') {
      const page = await syncPageAnalytics(now, retryLimit, retryBackoff);
      const ads = await syncAdsAnalytics(now, retryLimit, retryBackoff);
      return `pages=${page.examined}/${page.updated} ads=${ads.examined}/${ads.updated} skipped=${page.skipped + ads.skipped} failed=${page.failed + ads.failed}`;
    }
    const result = await syncInbox(now, retryLimit, retryBackoff);
    return `pages=${result.examined} records=${result.updated} skipped=${result.skipped} failed=${result.failed}`;
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

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  const worker = createWorker(dependencies, owner);
  log('replacement worker started');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; log(`${signal} received; draining jobs`); });
  while (!stopping) {
    try { await worker.tick(new Date()); }
    catch (error) { log('worker tick failed', error); }
    await new Promise(resolve => setTimeout(resolve, worker.pollIntervalMs));
  }
  while (worker.running.size > 0) await new Promise(resolve => setTimeout(resolve, 250));
  await prisma.$disconnect();
}

main().catch(error => { log('worker stopped unexpectedly', error); process.exitCode = 1; });
