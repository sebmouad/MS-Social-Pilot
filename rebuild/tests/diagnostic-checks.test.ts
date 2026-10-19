import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ config: vi.fn(), secret: vi.fn(), operations: vi.fn(), access: vi.fn(), stat: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), query: vi.fn(), transaction: vi.fn(), probe: vi.fn(), hooks: vi.fn() }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config, runtimeSecret: state.secret }));
vi.mock('../src/server/data', () => ({ prisma: { $transaction: state.transaction } }));
vi.mock('../src/server/root/operations', () => ({ loadRootOperations: state.operations }));
vi.mock('../src/server/secret-crypto', () => ({ encryptSecret: state.encrypt, decryptSecret: state.decrypt }));
vi.mock('node:fs/promises', () => ({ access: state.access, lstat: state.stat }));
vi.mock('../src/server/platforms', () => ({ PLATFORM_HOSTS: { facebook: { diagnostics: { checks: state.hooks } } } }));
vi.mock('../src/server/media/inspect', () => ({ checkMediaProbeAvailability: state.probe }));
import { diagnosticChecks } from '../src/server/diagnostics/checks';
const checks = async (scope = 'shared') => Object.fromEntries((await diagnosticChecks('root', scope)).map(check => [check.id, check.run]));
beforeEach(() => {
  vi.clearAllMocks(); state.probe.mockResolvedValue({ available: true });
  state.config.mockImplementation(async key => key === 'storage.mediaRoot' ? '/synthetic/media' : key === 'diagnostics.databaseTimeoutMs' ? 5000 : true);
  state.secret.mockResolvedValue(null); state.query.mockResolvedValue([{ read: 1 }]);
  state.transaction.mockImplementation(async run => run({ $queryRaw: state.query }));
  state.stat.mockResolvedValue({ isDirectory: () => true, isSymbolicLink: () => false }); state.access.mockResolvedValue(undefined);
  state.encrypt.mockImplementation(value => value); state.decrypt.mockImplementation(value => value);
  state.operations.mockResolvedValue({ enabled: true, jobs: [{ name: 'posts' }], worker: { state: 'fresh' }, runs: [{ job: 'posts', outcome: 'ok' }] });
  state.hooks.mockResolvedValue([]);
});
describe('owned infrastructure diagnostic checks', () => {
  it('validates only the chosen module settings and reports a safe key without its value', async () => {
    const run = await checks('product:inbox');
    state.config.mockImplementation(async key => { if (key === 'sync.inbox.schedule') throw new Error('saved-secret'); return true; });
    const result = await run.configuration();
    expect(result).toMatchObject({ status: 'fail', code: 'invalid_configuration' }); expect(result.message).toContain('sync.inbox.schedule'); expect(result.message).not.toContain('saved-secret');
    expect(state.secret).not.toHaveBeenCalled();
    expect(state.config.mock.calls.some(([key]) => String(key).startsWith('meta.'))).toBe(false);
  });
  it('delegates provider checks to its installed host and checks saved secret envelopes', async () => {
    state.secret.mockRejectedValueOnce(new Error('ENCRYPTION_KEY=private'));
    const run = await checks('platform:facebook');
    expect(state.hooks).toHaveBeenCalledWith(undefined);
    const result = await run.configuration(); expect(result.status).toBe('fail'); expect(result.message).not.toContain('ENCRYPTION_KEY=private');
  });
  it('runs bounded database read and in-memory encryption without persisting a secret', async () => {
    const run = await checks();
    expect(await run.database()).toMatchObject({ status: 'pass', code: 'database_read' });
    expect(state.transaction.mock.calls[0][1]).toEqual({ timeout: 5000, maxWait: 5000 });
    expect(await run.encryption()).toMatchObject({ status: 'pass' });
    state.decrypt.mockReturnValueOnce('wrong'); expect(await run.encryption()).toMatchObject({ status: 'fail' });
  });
  it('separates unconfigured, invalid and accessible storage without writing files', async () => {
    const run = await checks();
    state.config.mockResolvedValueOnce(''); expect(await run.storage()).toMatchObject({ status: 'skipped', code: 'storage_unconfigured' });
    state.stat.mockResolvedValueOnce({ isDirectory: () => false, isSymbolicLink: () => true }); expect(await run.storage()).toMatchObject({ status: 'fail', code: 'storage_invalid' });
    expect(await run.storage()).toMatchObject({ status: 'pass', code: 'storage_accessible' }); expect(state.access).toHaveBeenCalled();
  });
  it.each([
    [{ enabled: false, jobs: [{ name: 'posts' }] }, 'skipped', 'jobs_disabled'],
    [{ enabled: true, jobs: [] }, 'skipped', 'no_background_jobs'],
    [{ enabled: true, jobs: [{ name: 'posts' }], worker: { state: 'never' } }, 'fail', 'worker_unavailable'],
    [{ enabled: true, jobs: [{ name: 'posts' }], worker: { state: 'fresh' }, runs: [] }, 'skipped', 'coverage_incomplete'],
    [{ enabled: true, jobs: [{ name: 'posts' }], worker: { state: 'fresh' }, runs: [{ job: 'posts', outcome: 'failed' }] }, 'fail', 'job_failed'],
  ])('does not overstate worker health for %j', async (health, status, code) => {
    state.operations.mockResolvedValueOnce(health); expect(await (await checks('product:publishing')).worker()).toMatchObject({ status, code });
    expect(state.operations).toHaveBeenCalledWith('root', 'publishing');
  });
});

describe('Publishing media probe diagnostic', () => {
  it('checks only the Publishing scope and forwards cancellation', async () => {
    const publishing = await checks('product:publishing');
    const controller = new AbortController();
    expect(await publishing.media_probe(controller.signal)).toMatchObject({ status: 'pass', code: 'media_probe_available' });
    expect(state.probe).toHaveBeenCalledWith(controller.signal);
    expect((await checks()).media_probe).toBeUndefined();
    expect((await checks('product:inbox')).media_probe).toBeUndefined();
  });
  it('reports safe failure without executable paths or stderr', async () => {
    state.probe.mockRejectedValueOnce(new Error('/private/secret executable stderr'));
    const result = await (await checks('product:publishing')).media_probe();
    expect(result).toMatchObject({ status: 'fail', code: 'media_probe_unavailable' });
    expect(result.message).not.toContain('/private/secret');
  });
});
