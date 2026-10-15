import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: {} as Record<string, unknown> }));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => 120000 }));

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
      $queryRaw: vi.fn().mockResolvedValue([{ tableName: 'media' }, { tableName: 'posts' }]),
      $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => [{ count: BigInt(sql.includes('"media"') ? 2 : 1) }]),
      $transaction: transaction,
    });
    const { previewWorkspaceDataDeletion } = await import('../src/server/data-control');
    await expect(previewWorkspaceDataDeletion({ userId: 'u1', workspaceId: 'w1' })).resolves.toEqual({
      posts: 1, postTargets: 1, comments: 2, targets: 1, conversations: 1,
      conversationMessages: 3, pageInsights: 4, adAccounts: 1, adInsights: 5, socialAccounts: 1,
      'other:media': 2,
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
      postComment: { count: vi.fn().mockResolvedValue(1) },
      conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]), deleteMany: vi.fn(async () => { order.push('conversations'); return { count: 1 }; }) },
      conversationMessage: { count: vi.fn().mockResolvedValue(1) },
      pageInsight: { count: vi.fn().mockResolvedValue(1) },
      adInsight: { count: vi.fn().mockResolvedValue(1) },
      socialAccount: { count: vi.fn().mockResolvedValue(1) },
      $queryRaw: vi.fn().mockResolvedValue([{ tableName: 'media' }, { tableName: 'posts' }, { tableName: 'targets' }]),
      $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => [{ count: BigInt(sql.includes('"media"') ? 0 : 1) }]),
      $executeRawUnsafe: vi.fn(async (sql: string) => { order.push(sql); return 1; }),
      $executeRaw: vi.fn(async () => { order.push('audit'); return 1; }),
    };
    const transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    Object.assign(mocks.prisma, { $transaction: transaction });
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    const result = await deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE');
    expect(result).toMatchObject({ posts: 1, postTargets: 1, comments: 1, targets: 1, adAccounts: 1, socialAccounts: 1 });
    expect(order.filter(item => item.startsWith('DELETE FROM'))).toEqual([
      'DELETE FROM "public"."media" WHERE "workspaceId" = $1',
      'DELETE FROM "public"."posts" WHERE "workspaceId" = $1',
      'DELETE FROM "public"."targets" WHERE "workspaceId" = $1',
    ]);
    expect(result).not.toHaveProperty('other:media');
    expect(order.at(-1)).toBe('audit');
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('blocks database deletion when media records need verified file cleanup', async () => {
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) },
      workspace: { findUnique: vi.fn().mockResolvedValue({ id: 'w1' }) },
      target: { findMany: vi.fn().mockResolvedValue([]) },
      adAccount: { findMany: vi.fn().mockResolvedValue([]) },
      post: { findMany: vi.fn().mockResolvedValue([]) },
      socialAccount: { count: vi.fn().mockResolvedValue(0) },
      $queryRaw: vi.fn().mockResolvedValue([{ tableName: 'media' }]),
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: BigInt(1) }]),
      $executeRawUnsafe: vi.fn(),
    };
    Object.assign(mocks.prisma, { $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) });
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toThrow(/Stored files/);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
