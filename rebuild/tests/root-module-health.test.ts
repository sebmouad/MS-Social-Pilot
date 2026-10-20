import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ auth: vi.fn(), settings: vi.fn(), run: vi.fn(), count: vi.fn(), audit: vi.fn(), config: vi.fn(), secret: vi.fn(), heartbeat: vi.fn() }));
vi.mock('../src/server/root/operations', () => ({ requireActiveRoot: db.auth }));
vi.mock('../src/server/data', () => ({ prisma: { appSetting: { findMany: db.settings }, rebuildSyncRun: { findFirst: db.run }, post: { count: db.count }, publicationAttempt: { count: db.count }, rebuildWorkspaceExport: { count: db.count }, $executeRaw: db.audit, $queryRaw: db.heartbeat } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: db.config, runtimeSecret: db.secret }));
import { jobHealth, loadRootModuleHealth, moduleHealthScopes } from '../src/server/root/module-health';
const now = new Date('2026-10-20T12:00:00Z');
const run = { id: 'safe-run', startedAt: new Date('2026-10-20T11:00:00Z'), finishedAt: new Date('2026-10-20T11:00:01Z'), outcome: 'ok' };
beforeEach(() => {
  vi.clearAllMocks(); db.auth.mockResolvedValue(undefined); db.settings.mockResolvedValue([]); db.run.mockResolvedValue(null); db.count.mockResolvedValue(0); db.audit.mockResolvedValue(1); db.secret.mockResolvedValue(null); db.heartbeat.mockResolvedValue([]);
  db.config.mockImplementation(async key => key === 'root.jobHealthLookbackMinutes' ? 1440 : key === 'root.workerStaleSeconds' ? 180 : key === 'jobs.enabled' ? true : '* * * * *');
});
describe('stored module health', () => {
  it('distinguishes missing evidence, failed outcomes, schedule freshness and unknown outcomes', () => {
    expect(jobHealth(null, '* * * * *', now, 180, 1440)).toMatchObject({ freshness: 'unknown', outcome: 'unknown', durationMs: null });
    expect(jobHealth(run, '* * * * *', now, 180, 1440)).toMatchObject({ freshness: 'fail', outcome: 'pass', durationMs: 1000 });
    expect(jobHealth({ ...run, outcome: 'failed' }, '0 * * * *', now, 180, 1440)).toMatchObject({ freshness: 'pass', outcome: 'fail' });
    expect(jobHealth({ ...run, outcome: 'raw-secret' }, 'invalid', now, 180, 1440)).toMatchObject({ freshness: 'unknown', outcome: 'unknown' });
    expect(jobHealth({ ...run, finishedAt: null }, null, now, 180, 1440)).toMatchObject({ freshness: 'unknown', outcome: 'unknown', durationMs: null });
  });
  it('uses the supplied freshness lookback instead of a fixed day', () => {
    expect(jobHealth(run, '0 * * * *', now, 180, 15).freshness).toBe('unknown');
    expect(jobHealth(run, '0 * * * *', now, 180, 120).freshness).toBe('pass');
  });
  it('refuses non-Root and uninstalled scopes before reading data', async () => {
    db.auth.mockRejectedValueOnce(new Error('denied'));
    await expect(loadRootModuleHealth('member')).rejects.toThrow('denied'); expect(db.settings).not.toHaveBeenCalled();
    await expect(loadRootModuleHealth('root', 'platform:absent')).rejects.toMatchObject({ code: 'invalid_request' }); expect(db.settings).not.toHaveBeenCalled();
  });
  it('groups every installed declaration and never presents missing evidence as zero', async () => {
    expect(new Set(moduleHealthScopes.map(s => s.kind))).toEqual(new Set(['shared', 'product', 'platform']));
    db.count.mockRejectedValue(new Error('private database error'));
    const data = await loadRootModuleHealth('root', 'product:publishing');
    expect(data.modules).toHaveLength(1); expect(data.modules[0].queues.every(q => q.count === null)).toBe(true);
    expect(data.modules[0].jobs.every(j => j.runId === null && j.outcome === 'unknown')).toBe(true);
    expect(JSON.stringify(data)).not.toContain('private database error'); expect(data.auditRecorded).toBe(true); expect(db.auth).toHaveBeenCalledTimes(2);
  });
  it('validates module configuration without exposing values and audits safe scoped statuses', async () => {
    db.settings.mockResolvedValue([{ key: 'meta.appId', value: 'private-value', encrypted: true }]);
    const data = await loadRootModuleHealth('root', 'platform:facebook');
    expect(data.modules[0].configuration.find(c => c.key === 'meta.appId')?.status).toBe('fail');
    expect(data.modules[0].configuration.find(c => c.key === 'meta.appSecret')?.status).toBe('fail');
    expect(data.modules[0].status).toBe('fail'); expect(JSON.stringify(data)).not.toContain('private-value');
    expect(JSON.stringify(db.audit.mock.calls)).not.toContain('private-value');
  });
  it('selects latest evidence for each declared job independently of recent history caps', async () => {
    db.run.mockResolvedValue({ ...run, startedAt: new Date(Date.now() - 2000), finishedAt: new Date(Date.now() - 1000) });
    const data = await loadRootModuleHealth('root', 'product:inbox');
    expect(db.run).toHaveBeenCalledWith(expect.objectContaining({ where: { job: 'inbox', owner: { startsWith: 'rebuild-' } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }));
    expect(data.modules[0].jobs[0]).toMatchObject({ runId: 'safe-run', outcome: 'pass' });
  });
  it('returns all installed groups, scopes platform queues and records unknown shared heartbeat', async () => {
    const data = await loadRootModuleHealth('root');
    expect(data.modules.map(m => m.id)).toEqual(moduleHealthScopes.map(m => m.id));
    expect(data.modules.find(m => m.id === 'shared')?.worker).toEqual({ seenAt: null, status: 'unknown' });
    expect(db.count).toHaveBeenCalledWith({ where: { provider: 'facebook', state: { in: ['started', 'uncertain', 'submitted', 'receipt_recorded'] } } });
    expect(data.modules.find(m => m.id === 'platform:facebook')?.queues[0]).toMatchObject({ count: 0, status: 'pass' });
  });
  it('rechecks revoked Root authority before recording or returning inspection results', async () => {
    db.auth.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'));
    await expect(loadRootModuleHealth('root', 'product:ads')).rejects.toThrow('revoked');
    expect(db.audit).not.toHaveBeenCalled();
  });
  it('does not claim a recorded audit when persistence fails', async () => {
    db.audit.mockRejectedValue(new Error('unavailable'));
    await expect(loadRootModuleHealth('root', 'product:ads')).rejects.toThrow('unavailable');
  });
});
