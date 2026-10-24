import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  root: vi.fn(), owner: vi.fn(), transaction: vi.fn(), renew: vi.fn(),
  tx: { user: { findUnique: vi.fn() }, socialAccount: { findFirst: vi.fn(), updateMany: vi.fn() }, target: { updateMany: vi.fn() }, workspaceDataPurge: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: h.root }, socialAccount: { findUnique: h.owner }, $transaction: h.transaction } }));
vi.mock('../src/modules/root/server/admin/policy', () => ({ adminSetting: async (key: string) => key.endsWith('TimeoutMs') ? 60000 : 5000 }));
vi.mock('../src/server/platforms', () => ({ PLATFORM_HOSTS: { oauth: { connection: { renewToken: h.renew } } } }));

import { decryptSecret, encryptSecret } from '../src/server/secret-crypto';
import { refreshRootConnection } from '../src/modules/root/server/admin/connection-refresh';
import { storeRenewedToken } from '../src/server/platforms/token-connection';

const input = { socialAccountId: 'c1', confirmation: 'REFRESH CONNECTION c1' };
const root = { isInstanceOwner: true, disabledAt: null };
const access = new Date('2099-01-01');
const grant = new Date('2031-06-01');

function setupRoot() {
  h.root.mockResolvedValue(root); h.tx.user.findUnique.mockResolvedValue(root);
  h.owner.mockResolvedValue({ workspaceId: 'w1' });
  h.transaction.mockImplementation(fn => fn(h.tx));
  h.tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('workspaces') ? [{ id: 'w1', suspendedAt: null }] : [{ acquired: true }]);
  h.tx.socialAccount.findFirst.mockImplementation(async ({ select }) => select.targets
    ? { targets: [{ id: 't1' }], adAccounts: [] }
    : { provider: 'oauth', accessToken: encryptSecret('old-token'), refreshToken: encryptSecret('old-refresh'), invalidatedAt: null });
  h.tx.socialAccount.updateMany.mockResolvedValue({ count: 1 });
  h.tx.target.updateMany.mockResolvedValue({ count: 2 });
  h.tx.workspaceDataPurge.findUnique.mockResolvedValue(null);
  h.tx.$executeRaw.mockResolvedValue(1);
  h.renew.mockResolvedValue({ accessToken: 'new-token', refreshToken: 'new-refresh', expiresAt: access, grantExpiresAt: grant, rotateDestinationCopies: true });
}

const rawCalls = () => h.tx.$executeRaw.mock.calls;
const metaIndex = () => rawCalls().findIndex(call => String((call[0] as TemplateStringsArray).join('')).includes('meta'));
const auditIndex = () => rawCalls().findIndex(call => typeof call[3] === 'string' && (call[3] as string).startsWith('root.connection_refresh'));

function snapshotPersistence() {
  const account = h.tx.socialAccount.updateMany.mock.calls[0]![0];
  const destinations = h.tx.target.updateMany.mock.calls[0]![0];
  return {
    account: { accessToken: decryptSecret(account.data.accessToken), refreshToken: decryptSecret(account.data.refreshToken), tokenExpiresAt: account.data.tokenExpiresAt },
    destinations: { where: destinations.where, accessToken: decryptSecret(destinations.data.accessToken) },
    meta: JSON.parse(rawCalls()[metaIndex()]![1]),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 4).toString('base64'));
  setupRoot();
});

describe('Root connection refresh atomicity', () => {
  it('writes account, access expiry, destination copies and audit through one transaction in order', async () => {
    const receipt = await refreshRootConnection('root', input);
    expect(receipt).toEqual({ socialAccountId: 'c1', workspaceId: 'w1', outcome: 'renewed', tokenExpiresAt: access.toISOString() });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    // The row lock replaces automatic renewal's compare-and-set; the write stays workspace-scoped.
    expect(h.tx.socialAccount.updateMany.mock.calls[0]![0].where).toEqual({ id: 'c1', workspaceId: 'w1', invalidatedAt: null });
    expect(h.tx.$queryRaw.mock.calls.map(([sql]) => sql.join('?'))).toEqual(expect.arrayContaining([expect.stringContaining('FOR UPDATE')]));
    expect(h.tx.socialAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.target.updateMany).toHaveBeenCalledTimes(1);
    expect(metaIndex()).toBeGreaterThanOrEqual(0);
    expect(auditIndex()).toBeGreaterThanOrEqual(0);
    // Account first, then the access-expiry merge, then destination copies, audit last.
    expect(metaIndex()).toBeLessThan(auditIndex());
    const [accountAt] = h.tx.socialAccount.updateMany.mock.invocationCallOrder;
    const [metaAt, auditAt] = h.tx.$executeRaw.mock.invocationCallOrder;
    const [destinationsAt] = h.tx.target.updateMany.mock.invocationCallOrder;
    expect([accountAt, metaAt, destinationsAt, auditAt]).toEqual([accountAt, metaAt, destinationsAt, auditAt].sort((a, b) => a! - b!));
  });

  it('confirms nothing when a persistence step fails inside the transaction', async () => {
    h.tx.target.updateMany.mockRejectedValue(new Error('destination write failed'));
    await expect(refreshRootConnection('root', input)).rejects.toThrow('destination write failed');
    expect(h.transaction).toHaveBeenCalledTimes(1);
    // Every write was attempted on the same aborted transaction client; no success audit exists.
    expect(h.tx.socialAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(metaIndex()).toBeGreaterThanOrEqual(0);
    expect(auditIndex()).toBe(-1);
  });

  it('persists the same credential state as automatic renewal for the same renewed token', async () => {
    h.transaction.mockImplementation(fn => fn(h.tx));
    h.tx.socialAccount.updateMany.mockResolvedValue({ count: 1 });
    h.tx.$executeRaw.mockResolvedValue(1);
    h.tx.target.updateMany.mockResolvedValue({ count: 2 });
    expect(await storeRenewedToken({
      workspaceId: 'w1', socialAccountId: 'c1', previousStoredAccessToken: encryptSecret('old-token'),
      accessToken: 'new-token', refreshToken: 'new-refresh', accessExpiresAt: access, grantExpiresAt: grant,
    })).toBe(true);
    const automatic = snapshotPersistence();
    vi.resetAllMocks();
    vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 4).toString('base64'));
    setupRoot();
    expect((await refreshRootConnection('root', input)).outcome).toBe('renewed');
    expect(snapshotPersistence()).toEqual(automatic);
  });
});
