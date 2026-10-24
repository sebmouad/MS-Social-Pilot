import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  purge: vi.fn(), query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), member: vi.fn(), config: vi.fn(), entitlement: vi.fn(), permission: vi.fn(), canUse: vi.fn(), canAccess: vi.fn(), guard: vi.fn(), builder: vi.fn(), root: vi.fn(), stat: vi.fn(), mkdir: vi.fn(), open: vi.fn(), unlink: vi.fn(), read: vi.fn(), write: vi.fn(), close: vi.fn(), fileStat: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute, $transaction: m.transaction, membership: { findUnique: m.member } } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: m.entitlement, canUseFeature: m.canUse }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: m.canAccess }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: m.permission }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: m.guard }));
vi.mock('../src/server/data-control/storage', () => ({ canonicalMediaRoot: m.root, validateWorkspaceId: vi.fn() }));
vi.mock('../src/server/data-control/archive', () => ({ exportWorkspaceArchive: m.builder }));
vi.mock('node:fs/promises', () => ({ lstat: m.stat, mkdir: m.mkdir, open: m.open, unlink: m.unlink }));
import { downloadWorkspaceExport, listWorkspaceExports, requestWorkspaceExport, runWorkspaceExports } from '../src/modules/settings/server/exports';
import { SETTINGS_MODULE_CONFIG } from '../src/modules/settings/config';
const actor = { userId: 'owner', workspaceId: 'workspace' };
const job = () => ({ id: '11111111-1111-1111-1111-111111111111', workspaceId: 'workspace', requestedById: 'owner', apiKeyId: null, status: 'ready', mediaRoot: '/media', leaseToken: 'token', leaseUntil: new Date(Date.now() + 60000), createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000), error: null, bytes: 3 });
const statements = () => m.execute.mock.calls.map(call => (call[0] as TemplateStringsArray).join('?')).join('\n');
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockImplementation(async (key: string) => key === 'storage.mediaRoot' ? '/media' : key === 'data.workspaceOperationTimeoutMs' ? 10000 : SETTINGS_MODULE_CONFIG.find(entry => entry.key === key)?.defaultValue);
  m.member.mockResolvedValue({ role: 'owner', user: { disabledAt: null } }); m.entitlement.mockResolvedValue({}); m.permission.mockResolvedValue({}); m.canUse.mockReturnValue(true); m.canAccess.mockReturnValue(true);
  m.guard.mockImplementation(async (_id: string, run: () => Promise<unknown>) => run());
  m.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: m.query, $executeRaw: m.execute, workspaceDataPurge: { findUnique: m.purge } }));
  m.purge.mockResolvedValue(null); m.query.mockResolvedValue([]); m.execute.mockResolvedValue(1); m.root.mockResolvedValue('/media');
  m.stat.mockResolvedValue({ isDirectory: () => true, isSymbolicLink: () => false }); m.mkdir.mockResolvedValue(undefined); m.unlink.mockResolvedValue(undefined);
  m.fileStat.mockResolvedValue({ isFile: () => true, size: 3 }); m.read.mockResolvedValue(Buffer.from('ZIP')); m.write.mockResolvedValue(undefined); m.close.mockResolvedValue(undefined);
  m.open.mockResolvedValue({ stat: m.fileStat, readFile: m.read, writeFile: m.write, close: m.close }); m.builder.mockResolvedValue(Buffer.from('ZIP'));
});
it('requires exact workspace confirmation before entering any operation', async () => {
  await expect(requestWorkspaceExport(actor, 'REQUEST WORKSPACE EXPORT another')).rejects.toMatchObject({ code: 'invalid_request' }); expect(m.guard).not.toHaveBeenCalled();
});
it('denies nonmanagers and unavailable feature access before reading job rows', async () => {
  m.member.mockResolvedValueOnce({ role: 'editor', user: { disabledAt: null } }); await expect(listWorkspaceExports(actor)).rejects.toMatchObject({ code: 'forbidden' }); expect(m.query).not.toHaveBeenCalled();
  m.canUse.mockReturnValueOnce(false); await expect(downloadWorkspaceExport(actor, job().id)).rejects.toMatchObject({ code: 'forbidden' }); expect(m.open).not.toHaveBeenCalled();
});
it('deduplicates a pending request under the serialized workspace request transaction', async () => {
  const pending = { ...job(), status: 'requested' }; m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([pending]);
  expect(await requestWorkspaceExport(actor, 'REQUEST WORKSPACE EXPORT workspace')).toMatchObject({ id: pending.id, status: 'requested' }); expect(m.execute).not.toHaveBeenCalled(); expect(m.query.mock.calls[0]?.[1]).toBe('workspace-export:workspace');
});
it('rechecks current authority after reading the ZIP and denies a downgraded owner', async () => {
  m.query.mockResolvedValueOnce([job()]); m.member.mockResolvedValueOnce({ role: 'owner', user: { disabledAt: null } }).mockResolvedValueOnce({ role: 'editor', user: { disabledAt: null } });
  await expect(downloadWorkspaceExport(actor, job().id)).rejects.toMatchObject({ code: 'forbidden' }); expect(m.read).toHaveBeenCalledOnce(); expect(m.close).toHaveBeenCalledOnce(); expect(m.execute).not.toHaveBeenCalled();
});
it('refuses expired archives before touching storage', async () => {
  m.query.mockResolvedValueOnce([{ ...job(), expiresAt: new Date(0) }]); await expect(downloadWorkspaceExport(actor, job().id)).rejects.toMatchObject({ code: 'not_found' }); expect(m.open).not.toHaveBeenCalled();
});
it('does not build a candidate when the lease claim acquires no row', async () => {
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([]); expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=0'); expect(m.builder).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
});
it('uses the existing archive builder and marks only its claimed job ready after writing', async () => {
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([job()]);
  expect(await runWorkspaceExports()).toBe('built=1 cleanupExamined=0'); expect(m.builder).toHaveBeenCalledOnce(); expect(m.builder).toHaveBeenCalledWith(actor); expect(m.write).toHaveBeenCalledWith(Buffer.from('ZIP')); expect(m.close).toHaveBeenCalledOnce(); expect(statements()).toContain("status = 'ready'"); expect(m.unlink).toHaveBeenCalledOnce();
});
it('removes partial archive files and records a safe failure after a build error', async () => {
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([job()]); m.query.mockResolvedValueOnce([job()]); m.write.mockRejectedValueOnce(new Error('private disk details'));
  expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=0'); expect(m.close).toHaveBeenCalledOnce(); expect(m.unlink).toHaveBeenCalledTimes(2); expect(m.unlink).toHaveBeenCalledWith('/media/exports/workspace/11111111-1111-1111-1111-111111111111.zip'); expect(statements()).toContain("status = 'failed'"); expect(statements()).not.toContain('private disk details');
});
it('cleans expired files for suspended tenants without the normal workspace operation guard', async () => {
  const expired = { ...job(), expiresAt: new Date(0) };
  m.guard.mockRejectedValue(new Error('Workspace suspended.'));
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([expired]).mockResolvedValueOnce([{ id: 'workspace' }]).mockResolvedValueOnce([expired]).mockResolvedValueOnce([]);
  expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=1'); expect(m.unlink).toHaveBeenCalledOnce(); expect(statements()).toContain("status = 'expired'"); expect(m.guard).not.toHaveBeenCalled();
});
it('backs off failed expiry file cleanup without marking an archive expired', async () => {
  const expired = { ...job(), expiresAt: new Date(0) };
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([expired]).mockResolvedValueOnce([{ id: 'workspace' }]).mockResolvedValueOnce([expired]).mockResolvedValueOnce([]);
  m.unlink.mockRejectedValueOnce(new Error('permission denied'));
  expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=1'); expect(statements()).toContain('SET "leaseUntil"'); expect(statements()).not.toContain("SET status = 'expired'");
});
it('does not remove a successor archive when failure cleanup cannot reacquire the claim token', async () => {
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([job()]).mockResolvedValueOnce([]);
  m.write.mockRejectedValueOnce(new Error('disk full'));
  expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=0'); expect(m.unlink).toHaveBeenCalledOnce(); expect(statements()).not.toContain("status = 'failed'");
  const lockQuery = m.query.mock.calls.at(-1)?.[0] as TemplateStringsArray; expect(lockQuery.join('?')).toContain('"leaseToken" = ?'); expect(lockQuery.join('?')).toContain('FOR UPDATE SKIP LOCKED');
});
it('does not unlink an expired job when its exclusive row lock is unavailable', async () => {
  const expired = { ...job(), expiresAt: new Date(0) };
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([expired]).mockResolvedValueOnce([{ id: 'workspace' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=1'); expect(m.unlink).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
});
it('leaves expiry cleanup to active erasure after checking the durable purge state', async () => {
  const expired = { ...job(), expiresAt: new Date(0) }; m.purge.mockResolvedValueOnce({ status: 'running' });
  m.query.mockResolvedValueOnce([]).mockResolvedValueOnce([expired]).mockResolvedValueOnce([{ id: 'workspace' }]).mockResolvedValueOnce([]);
  expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=1'); expect(m.unlink).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
});
it('removes durable workspace deletion outbox files before retiring their cleanup entries', async () => {
  m.query.mockResolvedValueOnce([job()]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  expect(await runWorkspaceExports()).toBe('built=0 cleanupExamined=0'); expect(m.unlink).toHaveBeenCalledOnce(); expect(statements()).toContain('DELETE FROM rebuild_export_file_cleanups'); expect(m.guard).not.toHaveBeenCalled();
});
