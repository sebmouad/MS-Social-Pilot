import { recordError } from '@/server/errors/recorder';
import { CONFIG_BY_KEY } from '@/lib/config/registry';
import type { createWorker, WorkerLogger } from './worker';

type Worker = Pick<ReturnType<typeof createWorker>, 'tick' | 'shutdown' | 'pollIntervalMs'>;

function sleep(ms: number, stop: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (stop.aborted) return resolve();
    const done = () => { clearTimeout(timer); stop.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    stop.addEventListener('abort', done, { once: true });
  });
}

async function numberSetting(readConfig: (key: string) => Promise<unknown>, key: string): Promise<number> {
  const value = await readConfig(key).catch(() => null);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Number(CONFIG_BY_KEY.get(key)!.defaultValue);
}

/** Tick until `stop` aborts, then drain within the Root-configured grace period. */
export async function runWorkerLoop(input: { worker: Worker; readConfig: (key: string) => Promise<unknown>; stop: AbortSignal; log: WorkerLogger; recordError?: typeof recordError }): Promise<{ abandoned: string[] }> {
  const { worker, readConfig, stop, log } = input;
  while (!stop.aborted) {
    try { await worker.tick(new Date()); }
    catch (error) {
      await (input.recordError ?? recordError)({ source: 'worker', error, location: 'worker.tick' });
      log('worker tick failed', error);
    }
    await sleep(worker.pollIntervalMs, stop);
  }
  const [graceMs, pollMs] = await Promise.all([numberSetting(readConfig, 'sync.workerShutdownGraceMs'), numberSetting(readConfig, 'sync.workerDrainPollMs')]);
  const outcome = await worker.shutdown(graceMs, pollMs);
  log(outcome.abandoned.length ? `shutdown complete; abandoned ${outcome.abandoned.join(', ')}` : 'shutdown complete; all jobs drained');
  return outcome;
}
