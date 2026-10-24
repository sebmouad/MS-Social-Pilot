import { recordError } from '../src/server/errors/recorder';
import { hostname } from 'node:os';
import { WORKER_PREFIX } from '../src/server/jobs/identity';
import { prisma } from '../src/server/data';
import { runtimeConfig } from '../src/server/config/store';
import { createWorker } from '../src/server/jobs/worker';
import { createWorkerDependencies } from '../src/server/jobs/runtime';
import { runWorkerLoop } from '../src/server/jobs/run-loop';

const owner = `${WORKER_PREFIX}${hostname()}-${process.pid}`;
const log = (message: string, detail?: unknown) => console.log(`${new Date().toISOString()} [${owner}] ${message}`, detail ?? '');

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  const worker = createWorker(createWorkerDependencies(log), owner);
  log('replacement worker started');
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { if (!stop.signal.aborted) log(`${signal} received; draining jobs`); stop.abort(); });
  await runWorkerLoop({ worker, readConfig: runtimeConfig, stop: stop.signal, log });
  await prisma.$disconnect();
  // Abandoned jobs may still hold timers or sockets; leases are already released.
  process.exit(0);
}

main().catch(async error => { await recordError({ source: 'worker', error, location: 'worker.main' }); log('worker stopped unexpectedly', error); process.exitCode = 1; });
