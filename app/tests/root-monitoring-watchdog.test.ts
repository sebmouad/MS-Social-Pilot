import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ config: vi.fn(), create: vi.fn(), loop: vi.fn(), dependencies: vi.fn(), record: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('@/server/jobs/worker', () => ({ createWorker: state.create }));
vi.mock('@/server/jobs/runtime', () => ({ createWorkerDependencies: state.dependencies }));
vi.mock('@/server/jobs/run-loop', () => ({ runWorkerLoop: state.loop }));
vi.mock('@/server/errors/recorder', () => ({ recordError: state.record }));
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); vi.stubEnv('NEXT_PHASE', ''); state.config.mockResolvedValue(true); state.dependencies.mockReturnValue({ readConfig: state.config }); state.create.mockReturnValue({}); state.loop.mockResolvedValue({ abandoned: [] }); });
describe('independent web monitoring observer', () => {
  it('starts only monitoring with worker heartbeat disabled', async () => {
    const { startOperatorWatchdog } = await import('../src/modules/root/server/watchdog');
    await startOperatorWatchdog();
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ readConfig: expect.any(Function) }), expect.stringContaining('monitoring-web-'), { jobs: ['operatorMonitoring'], heartbeat: false });
    expect(state.loop).toHaveBeenCalledOnce();
    await Promise.resolve();
  });
  it('does not start during production builds and rechecks Root enablement at each tick', async () => {
    const { startOperatorWatchdog } = await import('../src/modules/root/server/watchdog');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await startOperatorWatchdog();
    expect(state.config).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PHASE', ''); state.config.mockResolvedValue(false);
    await startOperatorWatchdog();
    expect(state.create).toHaveBeenCalledOnce();
    const dependencies = state.create.mock.calls[0][0];
    expect(await dependencies.readConfig('jobs.enabled')).toBe(false);
    state.config.mockResolvedValue(true);
    expect(await dependencies.readConfig('jobs.enabled')).toBe(true);
  });
});
