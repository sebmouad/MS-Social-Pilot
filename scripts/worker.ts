/**
 * The scheduling worker.
 *
 * Run alongside the web app:  npm run worker
 *
 * It polls for due posts and publishes them. Everything it does is also
 * available through POST /api/cron/tick, so serverless deployments can skip
 * this process entirely — see docs/DEPLOYMENT.md.
 *
 * Running several instances is safe: destinations are claimed atomically, so
 * two workers never publish the same post twice.
 */

import { env } from '../src/lib/env';
import { prisma } from '../src/lib/prisma';
import { runSchedulerTick } from '../src/lib/scheduler/runner';

const workerId = `worker-${process.pid}`;
let stopping = false;
let activeTick: Promise<unknown> | null = null;

function log(message: string, detail?: unknown): void {
  const timestamp = new Date().toISOString();
  if (detail === undefined) {
    console.log(`${timestamp} [${workerId}] ${message}`);
  } else {
    console.log(`${timestamp} [${workerId}] ${message}`, detail);
  }
}

async function tick(): Promise<void> {
  try {
    const result = await runSchedulerTick({ workerId, logger: log });
    if (result.claimed > 0 || result.reclaimedStale > 0) {
      log(
        `tick: claimed=${result.claimed} published=${result.published} ` +
          `failed=${result.failed} retrying=${result.retrying} reclaimed=${result.reclaimedStale}`,
      );
    }
  } catch (error) {
    // A failed tick must never kill the worker — the next one may well succeed.
    console.error(`${new Date().toISOString()} [${workerId}] tick failed`, error);
  }
}

async function main(): Promise<void> {
  const intervalMs = env.pollSeconds * 1000;
  log(`starting; polling every ${env.pollSeconds}s with concurrency ${env.concurrency}`);

  // Fail fast on a misconfigured database rather than logging an error every
  // poll for the rest of time.
  await prisma.$queryRaw`SELECT 1`;

  while (!stopping) {
    activeTick = tick();
    await activeTick;
    activeTick = null;
    if (stopping) break;
    await sleep(intervalMs);
  }

  log('stopped');
  await prisma.$disconnect();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Do not hold the process open during shutdown.
    timer.unref?.();
    const check = setInterval(() => {
      if (stopping) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 200);
    check.unref?.();
  });
}

/**
 * Graceful shutdown: finish the tick in flight so a post that is mid-publish
 * is not abandoned with its row locked. A second signal exits immediately.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) {
      log(`${signal} received again; exiting now`);
      process.exit(1);
    }
    stopping = true;
    log(`${signal} received; finishing the current tick`);
    void Promise.resolve(activeTick).then(() => undefined);
  });
}

main().catch((error) => {
  console.error('worker crashed', error);
  process.exit(1);
});
