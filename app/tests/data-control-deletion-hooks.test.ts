import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), cleanup: vi.fn(), transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('@/server/data-control/account', () => ({ deleteAccountSupplementaryData: m.cleanup }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn() }));
vi.mock('@/server/account-settings', () => ({}));
vi.mock('@/server/auth', () => ({}));
vi.mock('@/server/mail', () => ({ mailReady: vi.fn(), publicMailOrigin: vi.fn(), sendTransactionalMail: vi.fn() }));
import { deleteRootUser } from '@/server/root/user-controls';
import { deleteUnverifiedRegistration } from '@/modules/settings/server/registration';
import type { Prisma } from '../generated/client';
const tx = { $queryRaw: m.query, $executeRaw: m.execute };
beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation(async run => run(tx));
  m.execute.mockResolvedValue(1);
  m.cleanup.mockResolvedValue({ count: 1 });
  m.query.mockImplementation(async (sql: TemplateStringsArray) => {
    const text = Array.isArray(sql) ? sql.join('') : (sql as unknown as { text: string }).text;
    if (text.includes('FOR SHARE')) return [{ isInstanceOwner: true, disabledAt: null }];
    if (text.includes('FROM memberships')) return [];
    return [{ id: 'target', email: 'synthetic@example.test', isInstanceOwner: false, disabledAt: new Date() }];
  });
});
describe('account supplementary deletion integration', () => {
  it('runs Root cleanup in the same transaction immediately before deleting the authorized account', async () => {
    await deleteRootUser('root', 'target', 'DELETE ACCOUNT synthetic@example.test');
    expect(m.cleanup).toHaveBeenCalledWith(tx, 'target');
    const deletion = m.execute.mock.calls.findIndex(([sql]) => sql.join('').includes('DELETE FROM users'));
    expect(m.cleanup.mock.invocationCallOrder[0]).toBeGreaterThan(m.execute.mock.invocationCallOrder[deletion - 1]);
    expect(m.cleanup.mock.invocationCallOrder[0]).toBeLessThan(m.execute.mock.invocationCallOrder[deletion]);
  });
  it('runs unverified-registration cleanup only after eligibility locks, with no separate transaction', async () => {
    await deleteUnverifiedRegistration(tx as unknown as Prisma.TransactionClient, 'target');
    expect(m.query.mock.calls[0][0].join('')).toContain('FOR UPDATE OF u');
    expect(m.cleanup).toHaveBeenCalledWith(tx, 'target');
    expect(m.query.mock.invocationCallOrder[0]).toBeLessThan(m.cleanup.mock.invocationCallOrder[0]);
    expect(m.cleanup.mock.invocationCallOrder[0]).toBeLessThan(m.execute.mock.invocationCallOrder[0]);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it('does not clean or delete a Root target with invalid confirmation or ineligible registration', async () => {
    await expect(deleteRootUser('root', 'target', 'wrong')).rejects.toMatchObject({ code: 'invalid_request' });
    m.query.mockResolvedValue([]);
    await expect(deleteUnverifiedRegistration(tx as unknown as Prisma.TransactionClient, 'target')).rejects.toMatchObject({ code: 'conflict' });
    expect(m.cleanup).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
  });
  it.each(['root', 'registration'])('aborts %s deletion if supplementary cleanup fails', async path => {
    m.cleanup.mockRejectedValue(new Error('cleanup failed'));
    await expect(path === 'root' ? deleteRootUser('root', 'target', 'DELETE ACCOUNT synthetic@example.test') : deleteUnverifiedRegistration(tx as unknown as Prisma.TransactionClient, 'target')).rejects.toThrow('cleanup failed');
    expect(m.execute.mock.calls.some(([sql]) => sql.join('').includes('DELETE FROM users'))).toBe(false);
  });
});
