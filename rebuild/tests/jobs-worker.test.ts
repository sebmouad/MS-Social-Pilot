import { describe, expect, it, vi } from 'vitest';
import { createWorker, type JobName, type WorkerDependencies } from '../src/server/jobs/worker';

function dependencies(overrides: Partial<WorkerDependencies> = {}) {
  const started: string[] = [];
  const runs: unknown[] = [];
  const deps: WorkerDependencies = {
    readConfig: async key => key === 'jobs.order' ? ['posts', 'analytics', 'inbox', 'purges', 'mediaCleanup'] : key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 3 : key === 'sync.retryBaseDelayMs' ? 200 : key === 'sync.retryMaxDelayMs' ? 900 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : key === 'sync.workerPollSeconds' ? 7 : key === 'sync.posts.schedule' ? '* * * * *' : key === 'sync.analytics.schedule' ? '0 * * * *' : '0 * * * *',
    execute: async job => { started.push(job); return 'checked=1 updated=1 skipped=0 failed=0'; },
    tryLease: async () => true,
    renewLease: async () => true,
    releaseLease: async () => undefined,
    writeRun: async run => { runs.push(run); },
    writeHeartbeat: async () => undefined,
    alreadyRanThisMinute: async () => false,
    recordError: vi.fn(async () => true),
    logger: () => undefined,
    ...overrides,
  };
  const read = deps.readConfig;
  const shared: Record<string, number> = { 'sync.workerLeaseRenewalDivisor': 3, 'logging.workerErrorMaxCharacters': 2000, 'logging.workerSummaryMaxCharacters': 2000 };
  deps.readConfig = async key => key in shared ? shared[key] : read(key);
  return { deps, started, runs };
}

async function drain(worker: ReturnType<typeof createWorker>) {
  for (let i = 0; i < 20 && worker.running.size; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

describe('replacement worker scheduling', () => {
  it('uses the same lease and run history for confirmed on-demand monitoring', async () => {
    const state = dependencies({ alreadyRanThisMinute: async () => true });
    const worker = createWorker(state.deps, 'monitoring-manual-test', { jobs: ['operatorMonitoring'], heartbeat: false });
    expect(await worker.runNow('posts')).toBe(false);
    expect(await worker.runNow('operatorMonitoring')).toBe(true);
    expect(state.started).toEqual(['operatorMonitoring']);
    expect(state.runs).toHaveLength(1);
    const held = dependencies({ tryLease: async () => false });
    const heldWorker = createWorker(held.deps, 'monitoring-held', { jobs: ['operatorMonitoring'], heartbeat: false });
    expect(await heldWorker.runNow('operatorMonitoring')).toBe(false);
    expect(held.started).toHaveLength(0);
    expect(held.runs).toHaveLength(0);
  });


  it('restricts the web observer to monitoring and never writes a worker heartbeat', async () => {
    const heartbeat = vi.fn(async () => undefined);
    const tryLease = vi.fn(async () => true);
    const state = dependencies({ writeHeartbeat: heartbeat, tryLease });
    const read = state.deps.readConfig;
    state.deps.readConfig = async key => key.endsWith('.schedule') ? '* * * * *' : read(key);
    const worker = createWorker(state.deps, 'monitoring-web-test', { jobs: ['operatorMonitoring'], heartbeat: false });
    await worker.tick(new Date(2026, 0, 1, 12, 5));
    await drain(worker);
    expect(state.started).toEqual(['operatorMonitoring']);
    expect(tryLease.mock.calls).toHaveLength(1);
    expect(heartbeat).not.toHaveBeenCalled();
    expect(state.runs).toHaveLength(1);
    await worker.shutdown(100, 1);
  });


  it('obeys Root enabled switch and limits simultaneous jobs', async () => {
    let resolveGate!: (value: string) => void;
    const gate = new Promise<string>(resolve => { resolveGate = resolve; });
    const state = dependencies({
      readConfig: async key => key === 'jobs.order' ? ['posts', 'analytics', 'inbox', 'purges', 'mediaCleanup'] : key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.retryBaseDelayMs' ? 1000 : key === 'sync.retryMaxDelayMs' ? 60000 : key === 'sync.workerPollSeconds' ? 5 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : '* * * * *',
      execute: async job => { state.started.push(job); return gate; },
    });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(state.started).toHaveLength(1);
    resolveGate('done');
    await drain(worker);
    expect(state.runs).toHaveLength(1);
  });

  it('records completion and skips duplicate schedule slots', async () => {
    const state = dependencies();
    const worker = createWorker(state.deps, 'test-worker');
    const now = new Date(2026, 0, 1, 12, 5);
    await worker.tick(now);
    await drain(worker);
    await worker.tick(now);
    await drain(worker);
    expect(state.started).toEqual(['posts']);
    expect(state.runs).toHaveLength(1);
  });

  it('lets later ticks spend launch budget on jobs still due this minute', async () => {
    // Regression: the worker ticks several times per minute, and jobs launched
    // on the first tick used to burn the whole concurrency budget again as
    // no-ops on every later tick, permanently starving jobs ordered past the
    // cap (analyticsAlerts, sharingDeadlines and captionTests never ran).
    const launched = new Set<string>();
    const state = dependencies({
      readConfig: async key => key === 'jobs.order' ? ['posts', 'analytics'] : key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.retryBaseDelayMs' ? 1000 : key === 'sync.retryMaxDelayMs' ? 60000 : key === 'sync.workerPollSeconds' ? 5 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : '* * * * *',
      execute: async job => { launched.add(job); state.started.push(job); return 'done'; },
      alreadyRanThisMinute: async job => launched.has(job as string),
    });
    const worker = createWorker(state.deps, 'test-worker', { jobs: ['posts', 'analytics'], heartbeat: false });
    const now = new Date(2026, 0, 1, 12, 5);
    await worker.tick(now);
    await drain(worker);
    await worker.tick(new Date(now.getTime() + 5000));
    await drain(worker);
    expect(state.started).toEqual(['posts', 'analytics']);
    expect(state.runs).toHaveLength(2);
    await worker.shutdown(100, 1);
  });

  it('does not run when its distributed lease is held elsewhere', async () => {
    const state = dependencies({ tryLease: vi.fn(async () => false) });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 5));
    await drain(worker);
    expect(state.started).toHaveLength(0);
    expect(state.runs).toHaveLength(0);
  });

  it('uses Root lease and heartbeat settings', async () => {
    const before = Date.now();
    const tryLease = vi.fn(async (_job: JobName, _owner: string, _token: string, _until: Date) => true);
    const writeHeartbeat = vi.fn(async () => undefined);
    const state = dependencies({
      readConfig: async key => key === 'jobs.order' ? ['posts', 'analytics', 'inbox', 'purges', 'mediaCleanup'] : key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.retryBaseDelayMs' ? 1000 : key === 'sync.retryMaxDelayMs' ? 60000 : key === 'sync.workerPollSeconds' ? 5 : key === 'sync.workerLeaseMinutes' ? 2 : key === 'sync.workerHeartbeatSeconds' ? 5 : '* * * * *',
      tryLease,
      writeHeartbeat,
    });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 5));
    await drain(worker);
    const until = tryLease.mock.calls[0]?.[3];
    expect(until).toBeInstanceOf(Date);
    expect(until!.getTime()).toBeGreaterThanOrEqual(before + 2 * 60_000);
    expect(until!.getTime()).toBeLessThan(before + 2 * 60_000 + 1000);
    expect(writeHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('uses Root polling and retry backoff settings', async () => {
    const execute = vi.fn(async () => 'done');
    const state = dependencies({ execute });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 5));
    await drain(worker);
    expect(worker.pollIntervalMs).toBe(7000);
    expect(execute).toHaveBeenCalledWith('posts', expect.any(Date), 3, { baseDelayMs: 200, maxDelayMs: 900 });
  });

  it('preserves dispatch priority centrally and applies Root order without changing module ownership', async () => {
    const state = dependencies({
      readConfig: async key => key === 'jobs.order' ? ['analytics', 'posts'] : key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.retryBaseDelayMs' ? 1000 : key === 'sync.retryMaxDelayMs' ? 60000 : key === 'sync.workerPollSeconds' ? 5 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : '* * * * *',
    });
    const worker = createWorker(state.deps, 'test-worker'); await worker.tick(new Date(2026, 0, 1, 12, 0)); await drain(worker);
    expect(state.started).toEqual(['analytics']);
  });

  it('runs purge recovery on its own Root-configured schedule', async () => {
    const state = dependencies({
      readConfig: async key => key === 'jobs.order' ? ['posts', 'analytics', 'inbox', 'purges', 'mediaCleanup'] : key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.retryBaseDelayMs' ? 1000 : key === 'sync.retryMaxDelayMs' ? 60000 : key === 'sync.workerPollSeconds' ? 5 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : key === 'data.purgeRecoverySchedule' ? '*/7 * * * *' : '0 * * * *',
    });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 7));
    await drain(worker);
    expect(state.started).toEqual(['purges']);
  });

  it('runs media cleanup on its own Root-configured schedule', async () => {
    const state = dependencies({
      readConfig: async key => key === 'jobs.order' ? ['posts', 'analytics', 'inbox', 'purges', 'mediaCleanup'] : key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.retryBaseDelayMs' ? 1000 : key === 'sync.retryMaxDelayMs' ? 60000 : key === 'sync.workerPollSeconds' ? 5 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : key === 'storage.orphanMediaCleanupSchedule' ? '17 3 * * *' : '0 * * * *',
    });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 3, 17));
    await drain(worker);
    expect(state.started).toEqual(['mediaCleanup']);
  });
});


describe('Root worker telemetry limits', () => {
  it('applies current error and summary bounds to the saved run', async () => {
    const state = dependencies({ execute: async () => 'checked=123456789 failed=1' });
    const read = state.deps.readConfig;
    state.deps.readConfig = async key => key === 'logging.workerErrorMaxCharacters' ? 9 : key === 'logging.workerSummaryMaxCharacters' ? 7 : read(key);
    const worker = createWorker(state.deps, 'bounded-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 5)); await drain(worker);
    expect(state.runs[0]).toMatchObject({ summary: 'checked', error: 'Some work', outcome: 'failed' });
  });
  it('renews at the configured fraction of the lease', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: string) => void;
      const gate = new Promise<string>(resolve => { finish = resolve; });
      const renewLease = vi.fn(async () => true);
      const state = dependencies({ execute: () => gate, renewLease });
      const read = state.deps.readConfig;
      state.deps.readConfig = async key => key === 'sync.workerLeaseRenewalDivisor' ? 10 : read(key);
      const worker = createWorker(state.deps, 'renewal-worker');
      await worker.tick(new Date(2026, 0, 1, 12, 5));
      await vi.advanceTimersByTimeAsync(29_999); expect(renewLease).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); expect(renewLease).toHaveBeenCalledTimes(1);
      finish('done'); await vi.advanceTimersByTimeAsync(0);
      expect(worker.running.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});


describe('worker error recording', () => {
  it('records thrown failures once and preserves failed run history and lease release', async () => {
    const error = new Error('job refused');
    const recordError = vi.fn(async () => true);
    const releaseLease = vi.fn(async () => undefined);
    const state = dependencies({ recordError, releaseLease, execute: async () => { throw error; } });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 5)); await drain(worker);
    expect(recordError).toHaveBeenCalledWith({ source: 'worker', error, location: 'posts' });
    expect(recordError).toHaveBeenCalledTimes(1);
    expect(state.runs[0]).toMatchObject({ outcome: 'failed' });
    expect(releaseLease).toHaveBeenCalledTimes(1);
  });
  it('records partial failures returned by module jobs', async () => {
    const recordError = vi.fn(async () => true);
    const state = dependencies({ recordError, execute: async () => 'updated=1 failed=2' });
    const worker = createWorker(state.deps, 'test-worker');
    await worker.tick(new Date(2026, 0, 1, 12, 5)); await drain(worker);
    expect(recordError).toHaveBeenCalledWith({ source: 'worker', error: expect.any(Error), location: 'posts' });
    expect(state.runs[0]).toMatchObject({ outcome: 'failed' });
  });
});
