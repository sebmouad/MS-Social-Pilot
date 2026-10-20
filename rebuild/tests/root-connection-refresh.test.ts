import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  root: vi.fn(), owner: vi.fn(), transaction: vi.fn(), renew: vi.fn(),
  tx: { user: { findUnique: vi.fn() }, socialAccount: { findFirst: vi.fn(), updateMany: vi.fn() }, workspaceDataPurge: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: h.root }, socialAccount: { findUnique: h.owner }, $transaction: h.transaction } }));
vi.mock('../src/server/root/legacy/policy', () => ({ legacySetting: async (key: string) => key.endsWith('TimeoutMs') ? 60000 : 5000 }));
vi.mock('../src/server/platforms', () => ({ PLATFORM_HOSTS: { facebook: { connection: { renewToken: h.renew } }, nohook: { connection: {} } } }));
import { encryptSecret, decryptSecret } from '../src/server/secret-crypto';
import { refreshRootConnection } from '../src/server/root/legacy/connection-refresh';

const input = { socialAccountId: 'c1', confirmation: 'REFRESH CONNECTION c1' };
const root = { isInstanceOwner: true, disabledAt: null };
const expiry = new Date('2099-01-01');
const account = () => ({ provider: 'facebook', accessToken: encryptSecret('old-private-token'), refreshToken: encryptSecret('old-private-refresh'), invalidatedAt: null });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 4).toString('base64'));
  h.root.mockResolvedValue(root); h.tx.user.findUnique.mockResolvedValue(root);
  h.owner.mockResolvedValue({ workspaceId: 'w1' });
  h.transaction.mockImplementation(fn => fn(h.tx));
  h.tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('workspaces') ? [{ id: 'w1', suspendedAt: null }] : [{ acquired: true }]);
  h.tx.socialAccount.findFirst.mockImplementation(async ({ select }) => select.targets ? { targets: [{ id: 't1' }], adAccounts: [{ id: 'a1' }] } : account());
  h.tx.socialAccount.updateMany.mockResolvedValue({ count: 1 });
  h.tx.workspaceDataPurge.findUnique.mockResolvedValue(null);
  h.tx.$executeRaw.mockResolvedValue(1);
  h.renew.mockResolvedValue({ accessToken: 'new-private-token', refreshToken: 'new-private-refresh', expiresAt: expiry });
});
const audit = () => JSON.parse(h.tx.$executeRaw.mock.calls[0]![4]);

describe('Root connection renewal service', () => {
  it.each([null, { ...root, isInstanceOwner: false }, { ...root, disabledAt: new Date() }])('denies current non-Root authority before connection reads', async actor => {
    h.root.mockResolvedValue(actor);
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.owner).not.toHaveBeenCalled(); expect(h.renew).not.toHaveBeenCalled();
  });
  it.each([{}, { ...input, confirmation: 'REFRESH CONNECTION other' }, { ...input, confirmation: 'REFRESH CONNECTION c1 ' }, { ...input, force: true }, { ...input, socialAccountId: 'bad\nid' }])('rejects invalid input and exact confirmation mismatches', async args => {
    await expect(refreshRootConnection('root', args)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.owner).not.toHaveBeenCalled(); expect(h.transaction).not.toHaveBeenCalled();
  });
  it('renews under scoped lifecycle/resource/credential locks and encrypts stored credentials', async () => {
    const receipt = await refreshRootConnection('root', input);
    expect(receipt).toEqual({ socialAccountId: 'c1', workspaceId: 'w1', outcome: 'renewed', tokenExpiresAt: expiry.toISOString() });
    expect(h.renew).toHaveBeenCalledWith({ accessToken: 'old-private-token', refreshToken: 'old-private-refresh', signal: expect.any(AbortSignal) });
    const write = h.tx.socialAccount.updateMany.mock.calls[0]![0];
    expect(write.where).toEqual({ id: 'c1', workspaceId: 'w1', invalidatedAt: null });
    expect(decryptSecret(write.data.accessToken)).toBe('new-private-token');
    expect(decryptSecret(write.data.refreshToken)).toBe('new-private-refresh');
    expect(write.data).not.toHaveProperty('invalidatedAt');
    expect(audit()).toEqual(receipt);
    expect(h.tx.$executeRaw.mock.calls[0]![3]).toBe('root.connection_refresh.renewed');
    expect(JSON.stringify(receipt) + JSON.stringify(audit())).not.toMatch(/private|accessToken|refreshToken/);
    const queries = h.tx.$queryRaw.mock.calls.map(([sql]) => sql.join('?'));
    expect(queries).toEqual(expect.arrayContaining([expect.stringContaining('FOR SHARE'), expect.stringContaining('FOR UPDATE'), expect.stringContaining('pg_try_advisory_xact_lock')]));
    expect(h.tx.socialAccount.findFirst.mock.calls.every(([args]) => args.where.workspaceId === 'w1')).toBe(true);
    expect(h.transaction.mock.calls[0]![1]).toEqual({ timeout: 65000, maxWait: 5000 });
  });
  it.each(['missing-module', 'nohook', 'revoked', 'module-declined'])('audits not renewable without changing credentials: %s', async mode => {
    h.tx.socialAccount.findFirst.mockResolvedValueOnce({ targets: [], adAccounts: [] }).mockResolvedValueOnce({ ...account(), provider: mode === 'missing-module' ? 'unknown' : mode === 'nohook' ? 'nohook' : 'facebook', invalidatedAt: mode === 'revoked' ? new Date() : null });
    if (mode === 'module-declined') h.renew.mockResolvedValue(null);
    expect((await refreshRootConnection('root', input)).outcome).toBe('not_renewable');
    expect(audit().outcome).toBe('not_renewable'); expect(h.tx.socialAccount.updateMany).not.toHaveBeenCalled();
    if (mode !== 'module-declined') expect(h.renew).not.toHaveBeenCalled();
  });
  it('records provider failure without credentials or raw error messages', async () => {
    h.renew.mockRejectedValue(new Error('https://provider?access_token=private-credential'));
    expect((await refreshRootConnection('root', input)).outcome).toBe('failed');
    expect(audit().outcome).toBe('failed'); expect(JSON.stringify(audit())).not.toContain('private');
    expect(h.tx.socialAccount.updateMany).not.toHaveBeenCalled();
  });
  it('rejects an invalid renewal result as failed, preserving the old token', async () => {
    h.renew.mockResolvedValue({ accessToken: 'new-token', expiresAt: new Date('2000-01-01') });
    expect((await refreshRootConnection('root', input)).outcome).toBe('failed');
    expect(h.tx.socialAccount.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks Root authority inside the transaction', async () => {
    h.tx.user.findUnique.mockResolvedValue({ ...root, isInstanceOwner: false });
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'forbidden' }); expect(h.renew).not.toHaveBeenCalled();
  });
  it('denies suspended workspaces and active purges before transport', async () => {
    h.tx.$queryRaw.mockResolvedValueOnce([{ id: 'w1', suspendedAt: new Date() }]);
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'forbidden' });
    h.tx.workspaceDataPurge.findUnique.mockResolvedValue({ status: 'running' });
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'conflict' }); expect(h.renew).not.toHaveBeenCalled();
  });
  it('rejects missing or concurrently removed connections', async () => {
    h.owner.mockResolvedValueOnce(null);
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'not_found' });
    h.tx.socialAccount.findFirst.mockResolvedValueOnce(null);
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'not_found' }); expect(h.renew).not.toHaveBeenCalled();
  });
  it('fails closed when selected resources are already in use', async () => {
    h.tx.$queryRaw.mockResolvedValueOnce([{ id: 'w1', suspendedAt: null }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ acquired: false }]);
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'conflict' }); expect(h.renew).not.toHaveBeenCalled();
  });
  it('does not confirm success if local persistence or audit failed', async () => {
    h.tx.$executeRaw.mockResolvedValueOnce(0);
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'unavailable' });
    h.tx.socialAccount.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(refreshRootConnection('root', input)).rejects.toMatchObject({ code: 'conflict' });
  });
});
