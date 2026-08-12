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
import { createLoopState, dueJobs, markFinished, markStarted } from '../src/lib/scheduler/loop';
import { ensureSettings } from '../src/lib/settings';

const workerId = `${process.env.HOSTNAME ?? 'host'}-${process.pid}`;

/** How often this process records that it is alive. */
const HEARTBEAT_MS = 30_000;
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
  // Fail fast on a misconfigured database rather than logging an error on
  // every tick for the rest of time.
  await prisma.$queryRaw`SELECT 1`;

  await ensureSettings();
  log(
    `starting; jobs: ${jobDefinitions()
      .map((job) => `${job.name}@${Math.round(job.intervalMs / 1000)}s`)
      .join(' ')}`,
  );

  const state = createLoopState();
  let lastHeartbeat = 0;

  while (!stopping) {
    // Re-read configuration every pass (cached, so this is one query a minute
    // at most). An interval changed on the config screen therefore takes
    // effect without restarting this process, and a job switched off stops
    // being scheduled.
    await ensureSettings();
    const jobs = jobDefinitions();

    for (const job of dueJobs(jobs, state, Date.now())) {
      markStarted(state, job);

      const running = runJob(job).finally(() => {
        // Scheduled from the finish, so a job that overruns its interval
        // settles into a longer cycle rather than running back to back.
        markFinished(state, job, Date.now());
        inFlight.delete(running);
      });
      inFlight.add(running);
    }

    // Record that this process is alive, every half minute rather than every
    // pass. Nothing publishes without a worker, and an installation whose
    // worker was never started otherwise looks exactly like one that works —
    // posts sit at "scheduled" and nobody is told why. The setup screen reads
    // this row to say so.
    if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
      lastHeartbeat = Date.now();
      const names = jobs.map((job) => job.name);
      // Never fatal: a worker that cannot write its heartbeat should keep
      // publishing, which is the thing it exists to do.
      await prisma.workerHeartbeat
        .upsert({
          where: { workerId },
          create: { workerId, jobs: names },
          update: { jobs: names, seenAt: new Date() },
        })
        .catch((error: unknown) => log('heartbeat failed', error));
    }

    // One-second loop: fine-grained enough that a 30-second job fires on
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
