import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $transaction: mocks.transaction } }));

afterEach(() => vi.clearAllMocks());

describe('disconnect local data choices', () => {
  it('retains related records and only disables the source when retain mode is selected', async () => {
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) },
      socialAccount: { findFirst: vi.fn().mockResolvedValue({ id: 's1', targets: [{ id: 't1' }], adAccounts: [{ id: 'a1' }] }), updateMany: vi.fn() },
      postTarget: { count: vi.fn().mockResolvedValue(1) }, target: { updateMany: vi.fn() }, adAccount: { updateMany: vi.fn() }, $executeRaw: vi.fn(),
    };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const { disconnectSocialAccount } = await import('../src/server/connection-mutations');
    const result = await disconnectSocialAccount({ userId: 'u1', workspaceId: 'w1' }, 's1', 'retain');
    expect(result).toMatchObject({ mode: 'retain', stillScheduled: 1, retained: { channels: 1, adAccounts: 1 } });
    expect(tx.target.updateMany).toHaveBeenCalled();
    expect(tx.socialAccount.updateMany).toHaveBeenCalled();
    expect('deleteMany' in tx.socialAccount).toBe(false);
  });

  it('requires typed confirmation before removing related local records', async () => {
    const tx = { membership: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) } };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const { disconnectSocialAccount } = await import('../src/server/connection-mutations');
    await expect(disconnectSocialAccount({ userId: 'u1', workspaceId: 'w1' }, 's1', 'delete')).rejects.toThrow(/Type DELETE/);
  });

  it('preserves local records while provider-scheduled posts remain', async () => {
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) },
      socialAccount: { findFirst: vi.fn().mockResolvedValue({ id: 's1', targets: [{ id: 't1' }], adAccounts: [] }) },
      postTarget: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const { disconnectSocialAccount } = await import('../src/server/connection-mutations');
    await expect(disconnectSocialAccount({ userId: 'u1', workspaceId: 'w1' }, 's1', 'delete', 'DELETE')).rejects.toThrow(/still scheduled/);
    expect(tx.postTarget.findMany).not.toHaveBeenCalled();
  });

  it('deletes dependent local rows before channels and preserves posts linked elsewhere', async () => {
    const order: string[] = [];
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'admin' }) },
      socialAccount: { findFirst: vi.fn().mockResolvedValue({ id: 's1', targets: [{ id: 't1' }], adAccounts: [{ id: 'a1' }] }), deleteMany: vi.fn(async () => { order.push('source'); return { count: 1 }; }) },
      postTarget: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([{ id: 'pt1', postId: 'p1' }]), deleteMany: vi.fn(async () => { order.push('postTargets'); return { count: 1 }; }) },
      postComment: { deleteMany: vi.fn(async () => { order.push('comments'); return { count: 1 }; }) },
      post: { deleteMany: vi.fn(async () => { order.push('orphanPosts'); return { count: 0 }; }) },
      conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]), deleteMany: vi.fn(async () => { order.push('conversations'); return { count: 1 }; }) },
      conversationMessage: { deleteMany: vi.fn(async () => { order.push('messages'); return { count: 2 }; }) },
      pageInsight: { deleteMany: vi.fn(async () => { order.push('pageInsights'); return { count: 3 }; }) },
      adInsight: { deleteMany: vi.fn(async () => { order.push('adInsights'); return { count: 4 }; }) },
      target: { deleteMany: vi.fn(async () => { order.push('targets'); return { count: 1 }; }) },
      adAccount: { deleteMany: vi.fn(async () => { order.push('adAccounts'); return { count: 1 }; }) },
      $executeRaw: vi.fn(async () => { order.push('audit'); return 1; }),
    };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const { disconnectSocialAccount } = await import('../src/server/connection-mutations');
    const result = await disconnectSocialAccount({ userId: 'u1', workspaceId: 'w1' }, 's1', 'delete', 'DELETE');
    expect(result).toMatchObject({ mode: 'delete', deleted: { channels: 1, postTargets: 1, orphanPosts: 0, comments: 1, conversations: 1, pageInsights: 3, adInsights: 4 } });
    expect(order.indexOf('comments')).toBeLessThan(order.indexOf('postTargets'));
    expect(order.indexOf('postTargets')).toBeLessThan(order.indexOf('orphanPosts'));
    expect(order.indexOf('targets')).toBeLessThan(order.indexOf('source'));
    expect(order.at(-1)).toBe('audit');
  });
});
