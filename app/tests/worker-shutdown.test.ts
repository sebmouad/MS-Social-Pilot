import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorker, type JobName, type WorkerDependencies } from '../src/server/jobs/worker';
import { jobAbortSignal, jobStopRequested } from '../src/server/jobs/job-context';
import { runWorkerLoop } from '../src/server/jobs/run-loop';

const config: Record<string, unknown> = {
  'jobs.order': ['posts'], 'jobs.enabled': true, 'sync.maxConcurrentJobs': 4, 'sync.retryLimit': 0, 'sync.retryBaseDelayMs': 1, 'sync.retryMaxDelayMs': 1,
  'sync.workerLeaseMinutes': 5, 'sync.workerLeaseRenewalDivisor': 3, 'sync.workerHeartbeatSeconds': 30, 'sync.workerPollSeconds': 5,
  'logging.workerErrorMaxCharacters': 2000, 'logging.workerSummaryMaxCharacters': 2000, 'sync.workerShutdownGraceMs': 60000, 'sync.workerDrainPollMs': 250,
};

function setup(execute: WorkerDependencies['execute']) {
  const released: string[] = []; const runs: Array<{ job: string; outcome: string }> = []; const leased: string[] = [];
  const deps: WorkerDependencies = {
    readConfig: async key => key in config ? config[key] : key === 'sync.posts.schedule' ? '* * * * *' : '0 0 31 2 *',
    execute,
    tryLease: async job => { leased.push(job); return true; },
    renewLease: async () => true,
    releaseLease: async job => { released.push(job); },
    writeRun: async run => { runs.push(run); },
    writeHeartbeat: async () => undefined,
    alreadyRanThisMinute: async () => false,
    logger: () => undefined,
  };
  return { deps, released, runs, leased };
}

const noon = () => new Date(2026, 0, 1, 12, 0);

describe('worker graceful shutdown', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(noon()); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops claiming new work once shutdown begins', async () => {
    const state = setup(async () => 'failed=0');
    const worker = createWorker(state.deps, 'w1');
    const pending = worker.shutdown(1000, 50);
    await worker.tick(noon());
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(state.leased).toEqual([]);
  });

  it('lets an in-flight job finish within the grace period and releases its lease', async () => {
    let finish!: () => void;
    const state = setup(() => new Promise<string>(resolve => { finish = () => resolve('failed=0'); }));
    const worker = createWorker(state.deps, 'w1');
    await worker.tick(noon());
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.running.size).toBe(1);

    let result: { abandoned: JobName[] } | undefined;
    void worker.shutdown(10_000, 100).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(result).toBeUndefined();
    finish();
    await vi.advanceTimersByTimeAsync(200);

    expect(result).toEqual({ abandoned: [] });
    expect(state.runs).toEqual([expect.objectContaining({ job: 'posts', outcome: 'ok' })]);
    expect(state.released).toEqual(['posts']);
  });

  it('aborts jobs that outlive the grace period and releases their leases', async () => {
    let sawStop = false; let signal: AbortSignal | undefined;
    const state = setup(() => new Promise<string>(() => { signal = jobAbortSignal(); sawStop = jobStopRequested(); }));
    const worker = createWorker(state.deps, 'w1');
    await worker.tick(noon());
    await vi.advanceTimersByTimeAsync(0);

    let result: { abandoned: JobName[] } | undefined;
    void worker.shutdown(5_000, 100).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(4_900);
    expect(signal?.aborted).toBe(false);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);

    expect(sawStop).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(result).toEqual({ abandoned: ['posts'] });
    expect(state.released).toEqual(['posts']);
  });

  it('exposes the stop request to the running job before the abort', async () => {
    let stopSeen: boolean | undefined; let release!: () => void;
    const state = setup(async () => { await new Promise<void>(resolve => { release = resolve; }); stopSeen = jobStopRequested(); return 'failed=0'; });
    const worker = createWorker(state.deps, 'w1');
    await worker.tick(noon());
    await vi.advanceTimersByTimeAsync(0);
    const pending = worker.shutdown(10_000, 50);
    release();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(stopSeen).toBe(true);
  });
});

describe('worker run loop shutdown', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(noon()); });
  afterEach(() => { vi.useRealTimers(); });

  it('wakes from its poll sleep on stop, drains with the configured grace and resolves', async () => {
    const tick = vi.fn(async () => undefined);
    const shutdown = vi.fn(async () => ({ abandoned: [] as JobName[] }));
    const stop = new AbortController();
    const done = runWorkerLoop({ worker: { tick, shutdown, pollIntervalMs: 3_600_000 }, readConfig: async key => key === 'sync.workerShutdownGraceMs' ? 45_000 : 100, stop: stop.signal, log: () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    stop.abort();
    await vi.advanceTimersByTimeAsync(0);
    await done;

    expect(shutdown).toHaveBeenCalledWith(45_000, 100);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('falls back to the registered default grace when configuration cannot be read', async () => {
    const shutdown = vi.fn(async () => ({ abandoned: [] as JobName[] }));
    const stop = new AbortController(); stop.abort();
    await runWorkerLoop({ worker: { tick: async () => undefined, shutdown, pollIntervalMs: 1000 }, readConfig: async () => { throw new Error('db down'); }, stop: stop.signal, log: () => undefined });
    const [grace] = shutdown.mock.calls[0] as unknown as [number, number];
    expect(grace).toBeGreaterThan(0);
    expect(grace).toBeLessThan(90_000);
  });
});

it('records tick failures through the worker error recorder before shutdown', async () => {
  const stop = new AbortController();
  const failure = new Error('configuration unavailable');
  const recorder = vi.fn(async () => true);
  const log = vi.fn();
  const shutdown = vi.fn(async () => ({ abandoned: [] }));
  const worker = { tick: async () => { stop.abort(); throw failure; }, shutdown, pollIntervalMs: 1 };
  await runWorkerLoop({ worker, readConfig: async key => config[key], stop: stop.signal, log, recordError: recorder });
  expect(recorder).toHaveBeenCalledWith({ source: 'worker', error: failure, location: 'worker.tick' });
  expect(shutdown).toHaveBeenCalledTimes(1);
});
