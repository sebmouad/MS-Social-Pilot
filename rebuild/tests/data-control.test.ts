import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: {} as Record<string, unknown> }));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));

afterEach(() => vi.clearAllMocks());

describe('workspace data controls', () => {
  it('exports workspace records without provider credentials', async () => {
    Object.assign(mocks.prisma, {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }), findMany: vi.fn().mockResolvedValue([]) },
      workspace: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', name: 'Studio' }) },
      socialAccount: { findMany: vi.fn().mockResolvedValue([{ id: 's1', name: 'Meta', accessToken: 'secret-token' }]) },
      target: { findMany: vi.fn().mockResolvedValue([{ id: 't1', accessToken: 'page-secret', name: 'Page' }]) },
      adAccount: { findMany: vi.fn().mockResolvedValue([]) },
      post: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const { exportWorkspaceData } = await import('../src/server/data-control');
    const data = await exportWorkspaceData({ userId: 'u1', workspaceId: 'w1' });
    expect(data.socialAccounts[0]).not.toHaveProperty('accessToken');
    expect(data.targets[0]).not.toHaveProperty('accessToken');
    expect(JSON.stringify(data)).not.toContain('secret-token');
    expect(data.security).toMatchObject({ credentialsExcluded: true, auditLogExcluded: true });
  });

  it('requires explicit typed confirmation before opening a deletion transaction', async () => {
    const transaction = vi.fn();
    Object.assign(mocks.prisma, { $transaction: transaction });
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'delete')).rejects.toThrow(/Type DELETE/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('previews counts for every mapped dependent table without opening a deletion transaction', async () => {
    const transaction = vi.fn();
    Object.assign(mocks.prisma, {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'admin' }) },
      workspace: { findUnique: vi.fn().mockResolvedValue({ id: 'w1' }) },
      target: { findMany: vi.fn().mockResolvedValue([{ id: 't1' }]) },
      adAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
      post: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
      postTarget: { findMany: vi.fn().mockResolvedValue([{ id: 'pt1' }]) },
      conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]) },
      postComment: { count: vi.fn().mockResolvedValue(2) },
      conversationMessage: { count: vi.fn().mockResolvedValue(3) },
      pageInsight: { count: vi.fn().mockResolvedValue(4) },
      adInsight: { count: vi.fn().mockResolvedValue(5) },
      socialAccount: { count: vi.fn().mockResolvedValue(1) },
      $transaction: transaction,
    });
    const { previewWorkspaceDataDeletion } = await import('../src/server/data-control');
    await expect(previewWorkspaceDataDeletion({ userId: 'u1', workspaceId: 'w1' })).resolves.toEqual({
      posts: 1, postTargets: 1, comments: 2, targets: 1, conversations: 1,
      conversationMessages: 3, pageInsights: 4, adAccounts: 1, adInsights: 5, socialAccounts: 1,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rechecks manager access and deletes dependent rows transactionally before auditing', async () => {
    const order: string[] = [];
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) },
      workspace: { findUnique: vi.fn().mockResolvedValue({ id: 'w1' }) },
      target: { findMany: vi.fn().mockResolvedValue([{ id: 't1' }]), deleteMany: vi.fn(async () => { order.push('targets'); return { count: 1 }; }) },
      adAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]), deleteMany: vi.fn(async () => { order.push('adAccounts'); return { count: 1 }; }) },
      post: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]), deleteMany: vi.fn(async () => { order.push('posts'); return { count: 1 }; }) },
      postTarget: { findMany: vi.fn().mockResolvedValue([{ id: 'pt1', postId: 'p1' }]), deleteMany: vi.fn(async () => { order.push('postTargets'); return { count: 1 }; }) },
      postComment: { deleteMany: vi.fn(async () => { order.push('comments'); return { count: 1 }; }) },
      conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]), deleteMany: vi.fn(async () => { order.push('conversations'); return { count: 1 }; }) },
      conversationMessage: { deleteMany: vi.fn(async () => { order.push('messages'); return { count: 1 }; }) },
      pageInsight: { deleteMany: vi.fn(async () => { order.push('pageInsights'); return { count: 1 }; }) },
      adInsight: { deleteMany: vi.fn(async () => { order.push('adInsights'); return { count: 1 }; }) },
      socialAccount: { deleteMany: vi.fn(async () => { order.push('socialAccounts'); return { count: 1 }; }) },
      $executeRaw: vi.fn(async () => { order.push('audit'); return 1; }),
    };
    const transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    Object.assign(mocks.prisma, { $transaction: transaction });
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    const result = await deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE');
    expect(result).toMatchObject({ posts: 1, postTargets: 1, comments: 1, targets: 1, adAccounts: 1, socialAccounts: 1 });
    expect(order.indexOf('comments')).toBeLessThan(order.indexOf('postTargets'));
    expect(order.indexOf('postTargets')).toBeLessThan(order.indexOf('posts'));
    expect(order.at(-1)).toBe('audit');
    expect(transaction).toHaveBeenCalledOnce();
  });
});
