/**
 * The background worker.
 *
 * Run alongside the web app:  npm run worker
 *
 * It runs five jobs on independent intervals: publishing due posts, polling RSS
 * feeds, recycling evergreen posts, refreshing analytics, and warning about
 * expiring tokens. Everything it does is also reachable through
 * POST /api/cron/tick, so serverless deployments can skip this process.
 *
 * Running several instances is safe: destinations are claimed atomically, so
 * two workers never publish the same post twice.
 */

import { prisma } from '../src/lib/prisma';
import { jobDefinitions, type JobDefinition } from '../src/lib/scheduler/jobs';

const workerId = `worker-${process.pid}`;
let stopping = false;
/** Jobs currently mid-run, so shutdown can wait for them. */
const inFlight = new Set<Promise<unknown>>();

function log(message: string, detail?: unknown): void {
  const timestamp = new Date().toISOString();
  if (detail === undefined) {
    console.log(`${timestamp} [${workerId}] ${message}`);
  } else {
    console.log(`${timestamp} [${workerId}] ${message}`, detail);
  }
}

/**
 * Run one job, swallowing its errors.
 *
 * A failing RSS poll must not stop posts publishing, so no job is allowed to
 * take the loop down with it.
 */
async function runJob(job: JobDefinition): Promise<void> {
  const started = Date.now();
  try {
    const summary = await job.run({
      now: new Date(),
      logger: (message, detail) => log(`[${job.name}] ${message}`, detail),
    });
    // Quiet when there was nothing to do: a worker that logs every 30 seconds
    // trains people to ignore its output.
    if (summary) log(`[${job.name}] ${summary} (${Date.now() - started}ms)`);
  } catch (error) {
    console.error(`${new Date().toISOString()} [${workerId}] [${job.name}] failed`, error);
  }
}

async function main(): Promise<void> {
  const jobs = jobDefinitions();

  log(`starting; jobs: ${jobs.map((job) => `${job.name}@${Math.round(job.intervalMs / 1000)}s`).join(' ')}`);

  // Fail fast on a misconfigured database rather than logging an error on
  // every tick for the rest of time.
  await prisma.$queryRaw`SELECT 1`;

  const nextRunAt = new Map<string, number>(jobs.map((job) => [job.name, 0]));

  while (!stopping) {
    const now = Date.now();

    for (const job of jobs) {
      if ((nextRunAt.get(job.name) ?? 0) > now) continue;
      nextRunAt.set(job.name, now + job.intervalMs);

      const running = runJob(job).finally(() => inFlight.delete(running));
      inFlight.add(running);
    }

    // One-second heartbeat: fine-grained enough that a 30-second job fires on
    // time, cheap enough to be free.
    await sleep(1000);
  }

  log('draining in-flight jobs');
  await Promise.allSettled([...inFlight]);
  log('stopped');
  await prisma.$disconnect();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Graceful shutdown: stop scheduling new work, then wait for what is in
 * flight, so a post mid-publish is not abandoned with its row locked. A second
 * signal exits immediately.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) {
      log(`${signal} received again; exiting now`);
      process.exit(1);
    }
    stopping = true;
    log(`${signal} received; finishing current jobs`);
  });
}

main().catch((error) => {
  console.error('worker crashed', error);
  process.exit(1);
});
