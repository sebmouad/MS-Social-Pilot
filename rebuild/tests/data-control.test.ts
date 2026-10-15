import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, any>,
  runtimeConfig: vi.fn(async (key: string) => key === 'storage.mediaRoot' ? '/tmp/media' : key === 'data.deleteTransactionTimeoutMs' ? 120000 : undefined),
  canonicalMediaRoot: vi.fn(async (root: string) => root),
  removeWorkspaceStorage: vi.fn(async () => ({ files: 2, bytes: 17 })),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock('../src/server/data-control/storage', () => ({
  canonicalMediaRoot: mocks.canonicalMediaRoot,
  removeWorkspaceStorage: mocks.removeWorkspaceStorage,
  validateWorkspaceId: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.runtimeConfig.mockImplementation(async (key: string) => key === 'storage.mediaRoot' ? '/tmp/media' : key === 'data.deleteTransactionTimeoutMs' ? 120000 : undefined);
  mocks.canonicalMediaRoot.mockImplementation(async (root: string) => root);
  mocks.removeWorkspaceStorage.mockResolvedValue({ files: 2, bytes: 17 });
  for (const key of Object.keys(mocks.prisma)) delete mocks.prisma[key];
});

function makePurgeClient(role: string = 'owner') {
  const events: string[] = [];
  const job: Record<string, any> = { status: 'requested', mediaRoot: '/tmp/media', counts: null };
  const tx = {
    membership: { findUnique: vi.fn().mockResolvedValue({ role }) },
    workspace: { findUnique: vi.fn().mockResolvedValue({ id: 'w1' }) },
    workspaceDataPurge: {
      findUnique: vi.fn(async () => job.status === 'requested' && !job.created ? null : job),
      create: vi.fn(async ({ data }: any) => { Object.assign(job, data, { created: true }); events.push('queue'); return job; }),
      update: vi.fn(async ({ data }: any) => { Object.assign(job, data); events.push(`state:${data.status ?? 'error'}`); return job; }),
    },
    target: { findMany: vi.fn().mockResolvedValue([{ id: 't1' }]) },
    adAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
    post: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
    postTarget: { findMany: vi.fn().mockResolvedValue([{ id: 'pt1', postId: 'p1' }]) },
    conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]) },
    postComment: { count: vi.fn().mockResolvedValue(2) },
    conversationMessage: { count: vi.fn().mockResolvedValue(3) },
    pageInsight: { count: vi.fn().mockResolvedValue(4) },
    adInsight: { count: vi.fn().mockResolvedValue(5) },
    socialAccount: { count: vi.fn().mockResolvedValue(1) },
    $queryRaw: vi.fn().mockResolvedValue([{ tableName: 'posts' }, { tableName: 'targets' }, { tableName: 'ad_accounts' }, { tableName: 'social_accounts' }, { tableName: 'media' }]),
    $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => [{ count: BigInt(sql.includes('"media"') ? 2 : 1) }]),
    $executeRawUnsafe: vi.fn(async (sql: string) => { events.push(sql); return 1; }),
    $executeRaw: vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => { events.push('audit'); return { parts, values }; }),
  };
  const transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
  const workspaceDataPurge = {
    findUnique: tx.workspaceDataPurge.findUnique,
    update: tx.workspaceDataPurge.update,
    create: tx.workspaceDataPurge.create,
  };
  Object.assign(mocks.prisma, {
    ...tx,
    workspaceDataPurge,
    $transaction: transaction,
  });
  return { tx, job, events, transaction };
}

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

  it('previews counts for mapped and FK-owned tables without deleting', async () => {
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
      $transaction: vi.fn(),
    });
    const { previewWorkspaceDataDeletion } = await import('../src/server/data-control');
    await expect(previewWorkspaceDataDeletion({ userId: 'u1', workspaceId: 'w1' })).resolves.toEqual({
      posts: 1, postTargets: 1, comments: 2, targets: 1, conversations: 1,
      conversationMessages: 3, pageInsights: 4, adAccounts: 1, adInsights: 5, socialAccounts: 1,
      'other:media': 2,
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires exact typed confirmation before starting the purge', async () => {
    const transaction = vi.fn();
    Object.assign(mocks.prisma, { $transaction: transaction });
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'delete')).rejects.toThrow(/Type DELETE/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('rechecks %s access and runs the three purge phases transactionally', async role => {
    const { tx, job, events, transaction } = makePurgeClient(role);
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    const result = await deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1', apiKeyId: 'key-a' }, 'DELETE');

    expect(tx.membership.findUnique).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(3);
    expect((transaction as any).mock.calls.map((call: unknown[]) => call[1])).toEqual([{ timeout: 120000 }, { timeout: 120000 }, { timeout: 120000 }]);
    expect(job.status).toBe('completed');
    expect(result).toMatchObject({ posts: 1, postTargets: 1, comments: 2, targets: 1, adAccounts: 1, socialAccounts: 1, 'other:media': 2, storedFiles: 2, storedBytes: 17 });
    expect(events.filter(item => typeof item === 'string' && item.startsWith('DELETE FROM'))).toEqual([
      'DELETE FROM "public"."posts" WHERE "workspaceId" = $1',
      'DELETE FROM "public"."targets" WHERE "workspaceId" = $1',
      'DELETE FROM "public"."ad_accounts" WHERE "workspaceId" = $1',
      'DELETE FROM "public"."social_accounts" WHERE "workspaceId" = $1',
      'DELETE FROM "public"."media" WHERE "workspaceId" = $1',
    ]);
    expect(events.filter(item => item === 'audit')).toHaveLength(2);
    const auditValues = tx.$executeRaw.mock.calls.flat().filter((value: unknown): value is string => typeof value === 'string');
    expect(auditValues.some(value => value.includes('"apiKeyId":"key-a"'))).toBe(true);
    expect(auditValues.some(value => value.includes('"workspaceId":"w1"'))).toBe(true);
    expect(mocks.removeWorkspaceStorage).toHaveBeenCalledWith('/tmp/media', 'w1');
  });

  it('refuses manager-less deletion before creating a purge job', async () => {
    const { tx, transaction } = makePurgeClient('member');
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toThrow(/owners and admins/);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.workspaceDataPurge.create).not.toHaveBeenCalled();
    expect(mocks.removeWorkspaceStorage).not.toHaveBeenCalled();
  });

  it('resumes file cleanup after failure without deleting database rows twice', async () => {
    const { tx, job, transaction } = makePurgeClient();
    mocks.removeWorkspaceStorage.mockRejectedValueOnce(new Error('disk busy'));
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    const actor = { userId: 'u1', workspaceId: 'w1' };
    await expect(deleteWorkspaceData(actor, 'DELETE')).rejects.toThrow('disk busy');
    expect(job.status).toBe('db_deleted');
    const deleteCallsAfterFailure = tx.$executeRawUnsafe.mock.calls.length;

    const result = await deleteWorkspaceData(actor, 'DELETE');
    expect(result).toMatchObject({ storedFiles: 2, storedBytes: 17 });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(deleteCallsAfterFailure);
    expect(transaction).toHaveBeenCalledTimes(5);
    expect(mocks.removeWorkspaceStorage).toHaveBeenCalledTimes(2);
    expect(job.status).toBe('completed');
  });

  it('does not delete data when the storage root is unset', async () => {
    mocks.runtimeConfig.mockImplementation(async key => key === 'data.deleteTransactionTimeoutMs' ? 120000 : undefined);
    const { tx, transaction } = makePurgeClient();
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toThrow(/Set the media storage root/);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.workspaceDataPurge.create).not.toHaveBeenCalled();
    expect(mocks.canonicalMediaRoot).not.toHaveBeenCalled();
    expect(mocks.removeWorkspaceStorage).not.toHaveBeenCalled();
  });

  it('resumes from the captured storage root after Root configuration changes', async () => {
    const { tx, job } = makePurgeClient();
    job.created = true;
    job.status = 'db_deleted';
    job.mediaRoot = '/tmp/original-media';
    job.counts = { posts: 3 };
    mocks.runtimeConfig.mockImplementation(async key => key === 'data.deleteTransactionTimeoutMs' ? 120000 : undefined);
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).resolves.toMatchObject({ posts: 3, storedFiles: 2 });
    expect(tx.workspaceDataPurge.create).not.toHaveBeenCalled();
    expect(mocks.canonicalMediaRoot).toHaveBeenCalledWith('/tmp/original-media');
    expect(mocks.removeWorkspaceStorage).toHaveBeenCalledWith('/tmp/original-media', 'w1');
  });
});
