import { describe, expect, it, vi } from 'vitest';
import { createWorker, type WorkerDependencies } from '../src/server/jobs/worker';

function dependencies(overrides: Partial<WorkerDependencies> = {}) {
  const started: string[] = [];
  const runs: unknown[] = [];
  const deps: WorkerDependencies = {
    readConfig: async key => key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 3 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : key === 'sync.posts.schedule' ? '* * * * *' : key === 'sync.analytics.schedule' ? '0 * * * *' : '0 * * * *',
    execute: async job => { started.push(job); return 'checked=1 updated=1 skipped=0 failed=0'; },
    tryLease: async () => true,
    renewLease: async () => true,
    releaseLease: async () => undefined,
    writeRun: async run => { runs.push(run); },
    writeHeartbeat: async () => undefined,
    alreadyRanThisMinute: async () => false,
    logger: () => undefined,
    ...overrides,
  };
  return { deps, started, runs };
}

async function drain(worker: ReturnType<typeof createWorker>) {
  for (let i = 0; i < 20 && worker.running.size; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

describe('replacement worker scheduling', () => {
  it('obeys Root enabled switch and limits simultaneous jobs', async () => {
    let resolveGate!: (value: string) => void;
    const gate = new Promise<string>(resolve => { resolveGate = resolve; });
    const state = dependencies({
      readConfig: async key => key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.workerLeaseMinutes' ? 5 : key === 'sync.workerHeartbeatSeconds' ? 30 : '* * * * *',
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
    const tryLease = vi.fn(async (_job: 'posts' | 'analytics' | 'inbox', _owner: string, _token: string, _until: Date) => true);
    const writeHeartbeat = vi.fn(async () => undefined);
    const state = dependencies({
      readConfig: async key => key === 'jobs.enabled' ? true : key === 'sync.maxConcurrentJobs' ? 1 : key === 'sync.retryLimit' ? 0 : key === 'sync.workerLeaseMinutes' ? 2 : key === 'sync.workerHeartbeatSeconds' ? 5 : '* * * * *',
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
});
