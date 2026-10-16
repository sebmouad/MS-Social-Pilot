import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  targets: vi.fn(), accounts: vi.fn(), settings: new Map<string, string>(),
  settingRead: vi.fn(), settingWrite: vi.fn(), postTargets: vi.fn(), accountUpdate: vi.fn(),
  observations: vi.fn(), adInsights: vi.fn(), remoteStatus: vi.fn(), targetUpdate: vi.fn(), targetGroup: vi.fn(), postUpdate: vi.fn(), transaction: vi.fn(), operationQuery: vi.fn(), inboxList: vi.fn(), postComments: vi.fn(), suppressed: vi.fn(), orderBatch: vi.fn(), suppressedOrder: [] as string[],
}));

vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_workspaceId: string, operation: () => Promise<unknown>) => operation() }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({
  withInboxChannelOperation: (_workspaceId: string, _targetId: string, operation: (signal: AbortSignal) => Promise<unknown>) => operation(new AbortController().signal),
  inboxCommentSuppressed: state.suppressed,
  orderInboxCommentBatch: state.orderBatch,
}));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => {
  if (key === 'platforms.facebook.enabled') return true;
  if (key === 'sync.maxItemsPerJob') return 1;
  if (key === 'meta.postReadScopes') return ['pages_read_engagement'];
  if (key === 'meta.inboxReadScopes') return ['pages_messaging'];
  if (key === 'publishing.maxTargetsPerOperation') return 100;
  if (key === 'publishing.identifierMaxCharacters') return 200;
  return [];
} }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: async () => ({
  getPageInsightObservations: state.observations, getAdInsights: state.adInsights,
  getStatus: state.remoteStatus,
  listInbox: state.inboxList, listComments: state.postComments,
}), configuredFacebookAdapter: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: {
  target: { findMany: state.targets }, adAccount: { findMany: state.accounts, updateMany: state.accountUpdate },
  appSetting: { findUnique: state.settingRead, upsert: state.settingWrite },
  pageInsight: { upsert: vi.fn() }, adInsight: { upsert: vi.fn() }, postTarget: { findMany: state.postTargets, updateMany: state.targetUpdate, groupBy: state.targetGroup }, post: { updateMany: state.postUpdate },
  conversation: { upsert: vi.fn() }, conversationMessage: { upsert: vi.fn() }, postComment: { upsert: vi.fn() },
  $transaction: state.transaction,
} }));

import { syncAdsAnalytics, syncInbox, syncPageAnalytics } from '../src/platforms/facebook/jobs';

function applyQuery(rows: Array<{ id: string }>, query: { where: { AND: Array<Record<string, unknown>> }; take: number }) {
  const cursorClause = query.where.AND.find(clause => 'id' in clause) as { id?: { gt?: string; lte?: string } } | undefined;
  const filtered = rows.filter(row => !cursorClause || (cursorClause.id?.gt ? row.id > cursorClause.id.gt : row.id <= cursorClause.id!.lte!));
  return filtered.sort((a, b) => a.id.localeCompare(b.id)).slice(0, query.take);
}

const targets = [
  { id: 'target-a', workspaceId: 'w', providerId: 'pa', accessToken: null, socialAccount: null },
  { id: 'target-b', workspaceId: 'w', providerId: 'pb', accessToken: null, socialAccount: null },
];
const accounts = [
  { id: 'account-a', workspaceId: 'w', actId: 'act-a', name: 'A', socialAccount: null },
  { id: 'account-b', workspaceId: 'w', actId: 'act-b', name: 'B', socialAccount: null },
];

beforeEach(() => {
  vi.clearAllMocks(); state.settings.clear(); state.suppressedOrder.length = 0;
  state.settingRead.mockImplementation(async ({ where }: { where: { key: string } }) => {
    const value = state.settings.get(where.key);
    return value === undefined ? null : { value };
  });
  state.settingWrite.mockImplementation(async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
    state.settings.set(where.key, update.value ?? create.value); return {};
  });
  state.targets.mockImplementation((query: { where: { AND: Array<Record<string, unknown>> }; take: number }) => applyQuery(targets, query));
  state.accounts.mockImplementation((query: { where: { AND: Array<Record<string, unknown>> }; take: number }) => applyQuery(accounts, query));
  state.postTargets.mockResolvedValue([]); state.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => callback({
    $queryRaw: state.operationQuery,
    postComment: { upsert: vi.fn().mockResolvedValue({}) },
    postTarget: { updateMany: state.targetUpdate, groupBy: state.targetGroup }, post: { updateMany: state.postUpdate },
  }));
  state.operationQuery.mockImplementation((strings: TemplateStringsArray) => String(strings[0]).includes('rebuild_post_deletions') ? [] : [{ acquired: true }]);
  state.remoteStatus.mockResolvedValue({ state: 'published', publishedAt: new Date('2026-10-15T00:00:00Z') });
  state.targetUpdate.mockResolvedValue({ count: 1 });
  state.targetGroup.mockResolvedValue([{ status: 'published', _count: 1 }]);
  state.postUpdate.mockResolvedValue({ count: 1 });
  state.inboxList.mockResolvedValue([]);
  state.postComments.mockResolvedValue([]);
  state.postTargets.mockResolvedValue([]);
  state.suppressed.mockResolvedValue(false);
  state.orderBatch.mockImplementation((items: Array<{ id: string; parentId?: string | null }>) => items);
});

describe('fair sync batches', () => {
  it('advances Page analytics past a skipped first target across worker runs', async () => {
    expect((await syncPageAnalytics()).examined).toBe(1);
    expect(state.settings.get('sync.cursor.page-analytics')).toBe('target-a');
    expect((await syncPageAnalytics()).examined).toBe(1);
    expect(state.settings.get('sync.cursor.page-analytics')).toBe('target-b');
    expect(state.targets.mock.calls[1][0].where.AND).toContainEqual({ id: { gt: 'target-a' } });
  });

  it('advances Ads Analytics past a skipped first account across worker runs', async () => {
    expect((await syncAdsAnalytics()).examined).toBe(1);
    expect(state.settings.get('sync.cursor.ads-analytics')).toBe('account-a');
    expect((await syncAdsAnalytics()).examined).toBe(1);
    expect(state.settings.get('sync.cursor.ads-analytics')).toBe('account-b');
    expect(state.accounts.mock.calls[1][0].where.AND).toContainEqual({ id: { gt: 'account-a' } });
  });

  it('advances Inbox past a skipped first target across worker runs', async () => {
    expect((await syncInbox()).examined).toBe(1);
    expect(state.settings.get('sync.cursor.inbox')).toBe('target-a');
    expect((await syncInbox()).examined).toBe(1);
    expect(state.settings.get('sync.cursor.inbox')).toBe('target-b');
    expect(state.targets.mock.calls[1][0].where.AND).toContainEqual({ id: { gt: 'target-a' } });
  });

  it('does not report Inbox updates when the locked persistence transaction rolls back', async () => {
    state.targets.mockResolvedValueOnce([{ id: 'target-a', workspaceId: 'w', providerId: 'page-a', accessToken: 'encrypted', socialAccount: {
      workspaceId: 'w', accessToken: 'encrypted', scopes: 'pages_messaging', tokenExpiresAt: null, invalidatedAt: null,
    } }]);
    state.postTargets.mockResolvedValueOnce([]);
    state.inboxList.mockResolvedValueOnce([{ id: 'conversation-1', snippet: 'hello', unreadCount: 0, messageCount: 1, updatedAt: new Date(), messages: [] }]);
    state.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<void>) => {
      await callback({ conversation: { upsert: async () => ({ id: 'stored-conversation' }) }, conversationMessage: { upsert: vi.fn() }, postComment: { upsert: vi.fn() } });
      throw new Error('commit failed');
    });

    await expect(syncInbox()).resolves.toMatchObject({ examined: 1, updated: 0, skipped: 0, failed: 1 });
  });

  it('orders worker comment batches parent-first before tombstone checks', async () => {
    state.targets.mockResolvedValue([{ id: 'target-a', workspaceId: 'w', providerId: 'pa', accessToken: null, socialAccount: { workspaceId: 'w', accessToken: 'token', scopes: 'pages_messaging', tokenExpiresAt: null, invalidatedAt: null } }]);
    state.postTargets.mockResolvedValue([{ id: 'post-target-a', remotePostId: 'remote-post-a' }]);
    const comments = [
      { id: 'grandchild', parentId: 'child', message: 'g', fromName: null, fromId: null, likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() },
      { id: 'child', parentId: 'root', message: 'c', fromName: null, fromId: null, likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() },
      { id: 'root', parentId: null, message: 'r', fromName: null, fromId: null, likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() },
    ];
    state.postComments.mockResolvedValue(comments);
    state.orderBatch.mockImplementation((items: typeof comments) => {
      const byId = new Map(items.map(item => [item.id, item]));
      const ordered: typeof items = []; const done = new Set<string>();
      while (ordered.length < items.length) for (const item of items) {
        if (done.has(item.id) || (item.parentId && byId.has(item.parentId) && !done.has(item.parentId))) continue;
        ordered.push(item); done.add(item.id);
      }
      return ordered;
    });
    state.suppressed.mockImplementation(async (_tx, _workspaceId, _targetId, remoteId: string) => { state.suppressedOrder.push(remoteId); return false; });

    const result = await syncInbox();

    expect(result).toMatchObject({ examined: 1, updated: 3, failed: 0 });
    expect(state.orderBatch).toHaveBeenCalledWith(comments);
    expect(state.suppressedOrder).toEqual(['root', 'child', 'grandchild']);
  });

  it('skips scheduled post status refresh when the Page connection lacks the configured read grant', async () => {
    state.postTargets.mockResolvedValue([{ id: 'pt1', postId: 'post1', remotePostId: 'remote1', target: {
      id: 'target1',
      workspaceId: 'w', providerId: 'page1', accessToken: 'page-token',
      socialAccount: { workspaceId: 'w', accessToken: 'user-token', scopes: 'pages_show_list', tokenExpiresAt: null, invalidatedAt: null },
    } }]);
    const { syncScheduledPostStatus } = await import('../src/platforms/facebook/jobs');
    expect(await syncScheduledPostStatus()).toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
    expect(state.remoteStatus).not.toHaveBeenCalled();
  });

  it('refreshes scheduled post status after confirming the connection has the configured read grant', async () => {
    state.postTargets.mockResolvedValue([{ id: 'pt1', postId: 'post1', remotePostId: 'remote1', target: {
      id: 'target1',
      workspaceId: 'w', providerId: 'page1', accessToken: 'page-token',
      socialAccount: { workspaceId: 'w', accessToken: 'user-token', scopes: 'pages_show_list,pages_read_engagement', tokenExpiresAt: null, invalidatedAt: null },
    } }]);
    const { syncScheduledPostStatus } = await import('../src/platforms/facebook/jobs');
    expect(await syncScheduledPostStatus(new Date('2026-10-15T12:00:00Z'))).toEqual({ examined: 1, updated: 1, skipped: 0, failed: 0 });
    expect(state.remoteStatus).toHaveBeenCalledWith('page-token', 'remote1');
    expect(state.targetUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }));
    expect(state.operationQuery).toHaveBeenCalled();
  });

  it('does not resuscitate a remote post with any non-rejected deletion receipt', async () => {
    state.postTargets.mockResolvedValue([{ id: 'pt1', postId: 'post1', remotePostId: 'remote1', target: {
      id: 'target1', workspaceId: 'w', providerId: 'page1', accessToken: 'page-token',
      socialAccount: { workspaceId: 'w', accessToken: 'user-token', scopes: 'pages_read_engagement', tokenExpiresAt: null, invalidatedAt: null },
    } }]);
    state.operationQuery.mockImplementation((strings: TemplateStringsArray) => String(strings[0]).includes('state <> \'rejected\'') ? [{ id: 'deletion-1' }] : [{ acquired: true }]);
    const { syncScheduledPostStatus } = await import('../src/platforms/facebook/jobs');
    expect(await syncScheduledPostStatus()).toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
    expect(state.remoteStatus).not.toHaveBeenCalled();
    expect(state.targetUpdate).not.toHaveBeenCalled();
  });
});
