import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), query: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor }, $queryRaw: state.query } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
import { loadRootOperations, operationJobs } from '../src/server/root/operations';
import { workerConfigKeys } from '../src/server/jobs/worker';
beforeEach(() => {
  vi.clearAllMocks(); state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  state.config.mockImplementation(async key => key === 'root.operationalTimezone' ? 'UTC' : key === 'root.operationsRecentLimit' ? 25 : key === 'root.workerStaleSeconds' ? 180 : true);
  state.query.mockResolvedValue([]);
});
describe('Root rebuild-only operations', () => {
  it('shares installed job ownership and schedules with worker', async () => {
    expect(new Set(operationJobs.map(job => job.name)).size).toBe(operationJobs.length);
    expect(workerConfigKeys).toEqual(operationJobs.map(job => job.configKey));
    expect(operationJobs.find(job => job.name === 'mediaCleanup')?.moduleId).toBe('publishing');
    expect(operationJobs.find(job => job.name === 'purges')?.moduleId).toBe('settings');
  });
  it.each([null, { isInstanceOwner: false }, { isInstanceOwner: true, disabledAt: new Date() }])('requires current active Root before querying telemetry', async actor => {
    state.actor.mockResolvedValue(actor); await expect(loadRootOperations('root')).rejects.toMatchObject({ code: 'forbidden' }); expect(state.query).not.toHaveBeenCalled();
  });
  it('refuses invalid scopes and distinguishes a module with no jobs', async () => {
    await expect(loadRootOperations('root', 'absent')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(loadRootOperations('root', 'publishing', 0)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await loadRootOperations('root', 'ads')).toMatchObject({ jobs: [], runs: [], worker: { state: 'not_applicable' } });
    expect(state.query).not.toHaveBeenCalled();
  });
  it('selects only rebuild telemetry, filters module jobs, caps rows and excludes raw errors', async () => {
    const startedAt = new Date(Date.now() - 60000);
    state.query.mockResolvedValueOnce([{ id: 'r', job: 'inbox', startedAt, finishedAt: new Date(startedAt.getTime() + 1000), outcome: 'failed', attempts: 1, hasError: true }]).mockResolvedValueOnce([{ seenAt: new Date() }]);
    const health = await loadRootOperations('root', 'inbox', 2);
    expect(health).toMatchObject({ jobs: [{ name: 'inbox', moduleId: 'inbox' }], worker: { state: 'fresh' }, runs: [{ durationMs: 1000, hasError: true, outcome: 'failed' }] });
    const runSql = state.query.mock.calls[0][0];
    expect(runSql.sql).toContain('FROM rebuild_sync_runs'); expect(runSql.sql).not.toContain('worker_job_runs');
    expect(runSql.values).toContain('inbox'); expect(runSql.values).toContain(2); expect(runSql.values).not.toContain('posts');
    expect(state.query.mock.calls[1].slice(1)).toContain('rebuild-');
    expect(JSON.stringify(health)).not.toMatch(/"owner"|"error"|"summary"|workerId/);
  });
  it('reports missing/stale heartbeats honestly and normalizes unknown outcomes', async () => {
    expect((await loadRootOperations('root')).worker.state).toBe('never');
    state.query.mockResolvedValueOnce([{ id: 'r', job: 'posts', startedAt: new Date(), finishedAt: null, outcome: 'secret-in-outcome', attempts: 0, hasError: false }]).mockResolvedValueOnce([{ seenAt: new Date(0) }]);
    const result = await loadRootOperations('root'); expect(result.worker.state).toBe('stale'); expect(result.runs[0].outcome).toBe('unknown'); expect(result.runs[0].durationMs).toBeNull();
  });
});
