import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {} as Record<string, any>,
  runtimeConfig: vi.fn(async (key: string): Promise<string | number | undefined> => key === 'storage.mediaRoot' ? '/tmp/media' : key === 'data.deleteTransactionTimeoutMs' ? 120000 : key === 'data.maxArchiveBytes' ? 268435456 : undefined),
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
  mocks.runtimeConfig.mockImplementation(async (key: string) => key === 'storage.mediaRoot' ? '/tmp/media' : key === 'data.deleteTransactionTimeoutMs' ? 120000 : key === 'data.maxArchiveBytes' ? 268435456 : undefined);
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
    instagramAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'ig1' }]) },
    post: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
    postTarget: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([{ id: 'pt1', postId: 'p1' }]) },
    conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]) },
    postComment: { count: vi.fn().mockResolvedValue(2) },
    conversationMessage: { count: vi.fn().mockResolvedValue(3) },
    pageInsight: { count: vi.fn().mockResolvedValue(4) },
    adInsight: { count: vi.fn().mockResolvedValue(5) },
    instagramInsight: { count: vi.fn().mockResolvedValue(6) },
    socialAccount: { count: vi.fn().mockResolvedValue(1) },
    $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => /rebuild_(post_deletions|publication_attempts|facebook_media_steps)/.test(String(strings[0])) || /SELECT\s+id\s+FROM rebuild_facebook_media_deletions/.test(String(strings[0])) ? [] : [{ tableName: 'bio_pages' }, { tableName: 'custom_fields' }, { tableName: 'feed_sources' }, { tableName: 'labels' }, { tableName: 'page_groups' }, { tableName: 'posts' }, { tableName: 'share_links' }, { tableName: 'short_links' }, { tableName: 'targets' }, { tableName: 'ad_accounts' }, { tableName: 'social_accounts' }, { tableName: 'instagram_accounts' }, { tableName: 'media' }]),
    $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => [{ count: BigInt(sql.includes('"media"') ? 2 : 1) }]),
    $executeRawUnsafe: vi.fn(async (sql: string) => { events.push(sql); return 1; }),
    $executeRaw: vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => { events.push('audit'); return { parts, values }; }),
  };
  const transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
  const workspaceDataPurge = {
    findUnique: tx.workspaceDataPurge.findUnique,
    findMany: vi.fn(async () => job.created && ['requested', 'db_deleted'].includes(job.status) ? [{ workspaceId: 'w1', requestedById: 'u1', apiKeyId: null }] : []),
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
      target: { findMany: vi.fn().mockResolvedValue([{ id: 't1', accessToken: 'page-secret', name: 'Page', insights: [], conversations: [], postTargets: [] }]) },
      adAccount: { findMany: vi.fn().mockResolvedValue([]) },
      instagramAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'ig1', workspaceId: 'w1', socialAccountId: 's1', targetId: 't1', igUserId: 'ig-user', username: 'studio', name: 'Studio IG', profilePictureUrl: 'https://cdn.test/profile.jpg', followersCount: 8, followsCount: 4, mediaCount: 2, enabled: true, lastSyncedAt: new Date('2026-01-01'), createdAt: new Date('2025-01-01'), updatedAt: new Date('2026-01-01'), insights: [{ id: 'ii1', metric: 'followers', value: { count: 8, access_token: 'must-redact' } }], media: [{ id: 'im1', remoteId: 'remote1', caption: 'A post', mediaUrl: 'https://cdn.test/media.jpg', insights: { reach: 20 }, timestamp: new Date('2026-01-01') }] }]) },
      post: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ tableName: 'media' }, { tableName: 'rebuild_inbox_deletions' }]),
      $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT COUNT')) return [{ count: BigInt(0) }];
        if (sql.includes('"rebuild_inbox_deletions"')) return [{ id: 'deletion1', workspaceId: 'w1', state: 'completed', remoteId: 'opaque_remote' }];
        if (sql.includes('"media"')) return [{ id: 'm1', workspaceId: 'w1', ordinal: BigInt(5), accessToken: 'legacy-secret', settings: { client_secret: 'nested-secret', label: 'ok' } }];
        if (sql.includes('"external_posts"')) return [{ id: 'ep1', message: 'outside post', insights: { reach: 5, api_key: 'nested-legacy-secret' } }];
        return [];
      }),
    });
    const { exportWorkspaceData } = await import('../src/server/data-control');
    const data = await exportWorkspaceData({ userId: 'u1', workspaceId: 'w1' });
    expect(data.socialAccounts[0]).not.toHaveProperty('accessToken');
    expect(data.targets[0]).not.toHaveProperty('accessToken');
    expect(data.instagramAccounts[0]).toMatchObject({ socialAccountId: 's1', targetId: 't1', igUserId: 'ig-user', name: 'Studio IG', profilePictureUrl: 'https://cdn.test/profile.jpg', followsCount: 4, mediaCount: 2 });
    expect(data.instagramMedia).toHaveLength(1);
    expect(data.indirectTables.external_posts[0]).toMatchObject({ id: 'ep1', message: 'outside post', insights: { reach: 5, api_key: '[REDACTED]' } });
    expect(data.instagramAccounts[0].insights[0].value.access_token).toBe('[REDACTED]');
    expect(data.coverage.includedIndirectTables).toContain('instagram_insights');
    expect(JSON.stringify(data)).not.toContain('secret-token');
    expect(data.legacyTables.media[0]).toMatchObject({ id: 'm1', ordinal: '5', accessToken: '[REDACTED]', settings: { client_secret: '[REDACTED]', label: 'ok' } });
    expect(JSON.stringify(data)).not.toContain('legacy-secret');
    expect(JSON.stringify(data)).not.toContain('nested-secret');
    expect(JSON.stringify(data)).not.toContain('nested-legacy-secret');
    expect(data.coverage).toMatchObject({ directlyOwnedLegacyTables: ['media', 'rebuild_inbox_deletions'], directlyOwnedLegacyRowCounts: { media: 1, rebuild_inbox_deletions: 1 }, directlyOwnedLegacyTablesComplete: true, complete: false });
    expect(mocks.prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT * FROM "public"."media" WHERE "workspaceId" = $1', 'w1');
    expect(data.legacyTables.rebuild_inbox_deletions).toEqual([{ id: 'deletion1', workspaceId: 'w1', state: 'completed', remoteId: 'opaque_remote' }]);
    expect(data.security).toMatchObject({ credentialsExcluded: true, auditLogExcluded: true });
    mocks.runtimeConfig.mockImplementation(async (key: string) => key === 'data.maxArchiveBytes' ? 100 : undefined);
    await expect(exportWorkspaceData({ userId: 'u1', workspaceId: 'w1' })).rejects.toThrow('exceeds the configured archive size limit');
  });

  it('previews counts for mapped and FK-owned tables without deleting', async () => {
    Object.assign(mocks.prisma, {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'admin' }) },
      workspace: { findUnique: vi.fn().mockResolvedValue({ id: 'w1' }) },
      target: { findMany: vi.fn().mockResolvedValue([{ id: 't1' }]) },
      adAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
      instagramAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'ig1' }]) },
      post: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
      postTarget: { findMany: vi.fn().mockResolvedValue([{ id: 'pt1' }]) },
      conversation: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]) },
      postComment: { count: vi.fn().mockResolvedValue(2) },
      conversationMessage: { count: vi.fn().mockResolvedValue(3) },
      pageInsight: { count: vi.fn().mockResolvedValue(4) },
      adInsight: { count: vi.fn().mockResolvedValue(5) },
      instagramInsight: { count: vi.fn().mockResolvedValue(6) },
      socialAccount: { count: vi.fn().mockResolvedValue(1) },
      $queryRaw: vi.fn().mockResolvedValue([{ tableName: 'instagram_accounts' }, { tableName: 'media' }, { tableName: 'posts' }]),
      $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => [{ count: BigInt(sql.includes('"link_clicks"') ? 9 : sql.includes('"instagram_media"') ? 3 : sql.includes('"media"') ? 2 : 0) }]),
      $transaction: vi.fn(),
    });
    const { previewWorkspaceDataDeletion } = await import('../src/server/data-control');
    await expect(previewWorkspaceDataDeletion({ userId: 'u1', workspaceId: 'w1' })).resolves.toMatchObject({
      posts: 1, postTargets: 1, comments: 2, targets: 1, conversations: 1,
      conversationMessages: 3, pageInsights: 4, adAccounts: 1, adInsights: 5, instagramAccounts: 1, instagramInsights: 6, socialAccounts: 1,
      'other:media': 2,
      'indirect:instagram_media': 3,
      'indirect:link_clicks': 9,
      'indirect:bio_links': 0,
      'indirect:external_posts': 0,
      'indirect:feed_items': 0,
      'indirect:member_page_access': 0,
      'indirect:metric_availability': 0,
      'indirect:notification_mutes': 0,
      'indirect:page_group_targets': 0,
      'indirect:page_reviews': 0,
      'indirect:page_videos': 0,
      'indirect:post_field_values': 0,
      'indirect:post_labels': 0,
      'indirect:post_notes': 0,
      'indirect:post_versions': 0,
      'indirect:review_decisions': 0,
    });
    expect(mocks.prisma.postTarget.findMany).toHaveBeenCalledWith({ where: { OR: [{ postId: { in: ['p1'] } }, { targetId: { in: ['t1'] } }] }, select: { id: true } });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires exact typed confirmation before starting the purge', async () => {
    const transaction = vi.fn();
    Object.assign(mocks.prisma, { $transaction: transaction });
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'delete')).rejects.toThrow(/Type DELETE/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not erase unresolved publishing claims', async () => {
    const { tx } = makePurgeClient();
    tx.postTarget.findFirst.mockResolvedValue({ id: 'processing-target' } as never);
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toMatchObject({ code: 'conflict' });
    expect(tx.workspaceDataPurge.create).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('does not queue erasure while remote comment deletion needs recovery', async () => {
    const { tx } = makePurgeClient();
    tx.$queryRaw.mockResolvedValue([{ pending: true }] as never);
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toThrow(/needs recovery|needs review/);
    expect(tx.workspaceDataPurge.create).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('rechecks %s access and runs the three purge phases transactionally', async role => {
    const { tx, job, events, transaction } = makePurgeClient(role);
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    const result = await deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1', apiKeyId: 'key-a' }, 'DELETE');

    expect(tx.membership.findUnique).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(3);
    expect((transaction as any).mock.calls.map((call: unknown[]) => call[1])).toEqual([{ timeout: 120000 }, { timeout: 120000 }, { timeout: 120000 }]);
    expect(job.status).toBe('completed');
    expect(result).toMatchObject({ posts: 1, postTargets: 1, comments: 2, targets: 1, adAccounts: 1, adInsights: 5, instagramAccounts: 1, instagramInsights: 6, socialAccounts: 1, 'other:media': 2, storedFiles: 2, storedBytes: 17 });
    const deleteCalls = tx.$executeRawUnsafe.mock.calls.filter((call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).startsWith('DELETE FROM'));
    const deleteSql = deleteCalls.map((call: unknown[]) => call[0] as string);
    for (const table of ['bio_links', 'external_posts', 'feed_items', 'instagram_media', 'link_clicks', 'member_page_access', 'metric_availability', 'notification_mutes', 'page_group_targets', 'page_reviews', 'page_videos', 'post_field_values', 'post_labels', 'post_notes', 'post_versions', 'review_decisions']) {
      expect(deleteSql.some(sql => sql.startsWith(`DELETE FROM "public"."${table}"`))).toBe(true);
    }
    expect(deleteCalls.every((call: unknown[]) => call[1] === 'w1')).toBe(true);
    expect(deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."post_versions"'))).toBeLessThan(deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."posts" WHERE')));
    expect(deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."instagram_media"'))).toBeLessThan(deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."instagram_accounts" WHERE')));
    expect(deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."link_clicks"'))).toBeLessThan(deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."short_links" WHERE')));
    // No pre-delete rewrite of posts: the feed-item link is removed by deleting posts first, then feed items.
    expect(tx.$executeRawUnsafe.mock.calls.some((call: unknown[]) => /^UPDATE/.test(String(call[0])))).toBe(false);
    const postsAt = deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."posts" WHERE'));
    const feedItemsAt = deleteSql.findIndex(sql => sql.startsWith('DELETE FROM "public"."feed_items"'));
    expect(feedItemsAt).toBeGreaterThan(postsAt);
    expect(deleteSql.filter(sql => sql.startsWith('DELETE FROM "public"."feed_items"'))).toHaveLength(1);
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
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toThrow('disk busy');
    expect(job.status).toBe('db_deleted');
    const deleteCallsAfterFailure = tx.$executeRawUnsafe.mock.calls.length;

    const result = await deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE');
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

  it('worker recovery completes a previously confirmed purge after a crash', async () => {
    const { job, tx } = makePurgeClient();
    job.created = true;
    job.status = 'db_deleted';
    job.counts = { posts: 3 };
    const { resumePendingWorkspaceDataPurges } = await import('../src/server/data-control');
    await expect(resumePendingWorkspaceDataPurges()).resolves.toEqual({ examined: 1, completed: 1, failed: 0 });
    expect(job.status).toBe('completed');
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mocks.removeWorkspaceStorage).toHaveBeenCalledWith('/tmp/media', 'w1');
  });

  it('keeps a resumed purge pending when remote post deletion evidence remains unresolved', async () => {
    const { job, tx } = makePurgeClient();
    job.created = true;
    job.status = 'requested';
    tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => String(strings[0]).includes('rebuild_post_deletions') ? [{ id: 'pending-delete' }] : []);
    const { resumePendingWorkspaceDataPurges } = await import('../src/server/data-control');
    await expect(resumePendingWorkspaceDataPurges()).resolves.toEqual({ examined: 1, completed: 0, failed: 1 });
    expect(job.status).toBe('requested');
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mocks.removeWorkspaceStorage).not.toHaveBeenCalled();
  });

  it('worker recovery keeps a failed cleanup pending for the next run', async () => {
    const { job } = makePurgeClient();
    job.created = true;
    job.status = 'db_deleted';
    job.counts = { posts: 3 };
    mocks.removeWorkspaceStorage.mockRejectedValueOnce(new Error('disk busy'));
    const { resumePendingWorkspaceDataPurges } = await import('../src/server/data-control');
    await expect(resumePendingWorkspaceDataPurges()).resolves.toEqual({ examined: 1, completed: 0, failed: 1 });
    expect(job.status).toBe('db_deleted');
    expect(job.error).toBe('disk busy');
    await expect(resumePendingWorkspaceDataPurges()).resolves.toEqual({ examined: 1, completed: 1, failed: 0 });
    expect(job.status).toBe('completed');
  });
  it('refuses workspace erasure when a durable publication remains unresolved', async () => {
    const { tx } = makePurgeClient();
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => String(strings[0]).includes('rebuild_publication_attempts') ? [{ id: 'pending-publication' }] : []);
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toMatchObject({ code: 'conflict' });
    expect(tx.workspaceDataPurge.create).not.toHaveBeenCalled();
  });

  it('retains provider upload evidence even when the parent publication was resolved', async () => {
    const { tx } = makePurgeClient();
    const { deleteWorkspaceData } = await import('../src/server/data-control');
    tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => String(strings[0]).includes('rebuild_facebook_media_steps') ? [{ id: 'unattached-photo' }] : []);
    await expect(deleteWorkspaceData({ userId: 'u1', workspaceId: 'w1' }, 'DELETE')).rejects.toMatchObject({ code: 'conflict' });
    expect(tx.workspaceDataPurge.create).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

});
