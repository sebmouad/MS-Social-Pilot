import { hostname } from 'node:os';
import { runtimeConfig } from '@/server/config/store';
import { createWorker } from '@/server/jobs/worker';
import { createWorkerDependencies } from '@/server/jobs/runtime';
import { runWorkerLoop } from '@/server/jobs/run-loop';
import { recordError } from '@/server/errors/recorder';

let controller: AbortController | undefined;
/** Independent web observer: shares the durable monitoring lease, never publishes or advertises a worker heartbeat. */
export async function startOperatorWatchdog() {
  if (controller || process.env.NEXT_PHASE === 'phase-production-build') return;
  controller = new AbortController();
  const owner = `monitoring-web-${hostname()}-${process.pid}`;
  const log = (message: string) => console.log(`${new Date().toISOString()} [${owner}] ${message}`);
  const dependencies = createWorkerDependencies(log);
  const readConfig = dependencies.readConfig;
  dependencies.readConfig = async key => {
    if (key !== 'jobs.enabled') return readConfig(key);
    const [enabled, watchdogEnabled] = await Promise.all([readConfig(key), runtimeConfig('root.monitoring.watchdogEnabled')]);
    return enabled === true && watchdogEnabled === true;
  };
  const worker = createWorker(dependencies, owner, { jobs: ['operatorMonitoring'], heartbeat: false });
  const stop = controller;
  const onStop = () => stop.abort();
  process.once('SIGTERM', onStop);
  process.once('SIGINT', onStop);
  void runWorkerLoop({ worker, readConfig: runtimeConfig, stop: stop.signal, log }).catch(error => recordError({ source: 'server', error, location: 'root.monitoring.watchdog' })).finally(() => {
    process.removeListener('SIGTERM', onStop);
    process.removeListener('SIGINT', onStop);
    if (controller === stop) controller = undefined;
  });
}
