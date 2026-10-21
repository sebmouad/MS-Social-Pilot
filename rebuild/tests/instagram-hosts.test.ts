import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';
const m = vi.hoisted(() => ({ target: { findFirst: vi.fn(), findMany: vi.fn() }, instagramAccount: { findMany: vi.fn() }, instagramInsight: { findMany: vi.fn() }, instagramMedia: { findMany: vi.fn() }, postComment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() }, postTarget: { findMany: vi.fn(), findFirst: vi.fn() }, audit: vi.fn(), source: vi.fn(), authorize: vi.fn(), suppressed: vi.fn(), config: vi.fn(), policy: vi.fn(), adapter: { replyToInbox: vi.fn(), hideInboxItem: vi.fn(), deleteInboxItem: vi.fn(), listComments: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: { ...m, $executeRaw: m.audit, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(m) } }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_workspace: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/platforms/instagram/locale', () => ({ instagramLocale: async () => 'fr' }));
vi.mock('@/platforms/instagram/source-binding', () => ({ assertInstagramSource: m.source }));
vi.mock('@/server/secret-crypto', () => ({ decryptSecret: () => 'decrypted' }));
vi.mock('@/modules/analytics/server/error-copy', () => ({ analyticsLanguage: async () => 'fr' }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: m.authorize }));
vi.mock('@/modules/inbox/server/service-copy', () => ({ inboxServiceText: async (key: string) => key }));
vi.mock('@/modules/inbox/server/comment-guard', () => ({ withInboxChannelOperation: async (_w: string, _t: string, fn: (signal: AbortSignal) => Promise<unknown>) => fn(new AbortController().signal), inboxCommentSuppressed: m.suppressed, orderInboxCommentBatch: (items: unknown[]) => items }));
vi.mock('@/platforms/instagram/runtime', () => ({ configuredInstagramPolicy: m.policy, configuredInstagramAdapter: async () => m.adapter }));
import { instagramAnalyticsHost, storedInstagramInsight } from '@/platforms/instagram/analytics-host';
import { instagramInboxHost } from '@/platforms/instagram/inbox-host';
const actor = { userId: 'owner', workspaceId: 'workspace' };
const target = { id: 'channel', providerId: 'remote-account', name: 'Studio', type: 'instagram', accessToken: 'encrypted', socialAccount: { scopes: INSTAGRAM_POLICY_DEFAULTS.commentScopes.join(','), tokenExpiresAt: null } };
const storedComment = { id: 'comment', remoteId: 'remote-comment', parentRemoteId: null, postTargetId: 'destination', postTarget: { targetId: 'channel' } };
const from = new Date('2026-10-01'), to = new Date('2026-10-21');
beforeEach(() => {
  vi.resetAllMocks(); m.policy.mockResolvedValue(INSTAGRAM_POLICY_DEFAULTS); m.config.mockResolvedValue(true);
  m.authorize.mockImplementation(async (user: typeof actor, constraints: { allowedChannelIds?: string[] }, mode: string) => {
    if (mode === 'write' && user.userId === 'viewer') throw new Error('forbidden');
    return { channelIds: constraints.allowedChannelIds ?? ['channel'] };
  });
  m.target.findFirst.mockResolvedValue(target); m.target.findMany.mockResolvedValue([target]);
  m.postComment.findFirst.mockResolvedValue(storedComment); m.suppressed.mockResolvedValue(false);
  m.adapter.replyToInbox.mockResolvedValue({ remoteId: 'reply' });
  m.postTarget.findFirst.mockResolvedValue({ id: 'destination' });
  m.instagramAccount.findMany.mockResolvedValue([]); m.instagramMedia.findMany.mockResolvedValue([]);
});
describe('Instagram Inbox host', () => {
  it.each(['owner', 'member'])('rechecks %s write permission, persists and audits replies', async userId => {
    await expect(instagramInboxHost.reply({ ...actor, userId }, { kind: 'comment', id: 'comment', text: ' Thanks ' })).resolves.toEqual({ ok: true });
    expect(m.authorize).toHaveBeenCalledWith({ ...actor, userId }, {}, 'write');
    expect(m.adapter.replyToInbox).toHaveBeenCalledWith(expect.objectContaining({ credential: { accessToken: 'decrypted', grantedScopes: INSTAGRAM_POLICY_DEFAULTS.commentScopes }, targetId: 'remote-account', text: 'Thanks' }));
    expect(m.postComment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ remoteId: 'reply', sentById: userId }) }));
    expect(m.audit).toHaveBeenCalled();
  });
  it('refuses viewer mutations before provider dispatch', async () => {
    await expect(instagramInboxHost.moderate({ ...actor, userId: 'viewer' }, { id: 'comment', hidden: true })).rejects.toThrow('forbidden');
    expect(m.adapter.hideInboxItem).not.toHaveBeenCalled();
  });
  it('preserves independent credential channel ceilings', async () => {
    await expect(instagramInboxHost.reply({ ...actor, allowedChannelIds: [] }, { kind: 'comment', id: 'comment', text: 'Hello' })).rejects.toThrow('service7');
    expect(m.adapter.replyToInbox).not.toHaveBeenCalled();
  });
  it('scopes lookup to workspace and Instagram provider', async () => {
    m.postComment.findFirst.mockResolvedValue(null);
    await expect(instagramInboxHost.moderate({ ...actor, workspaceId: 'other' }, { id: 'comment', hidden: true })).rejects.toThrow('service6');
    expect(m.postComment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ postTarget: expect.objectContaining({ post: { workspaceId: 'other' }, target: expect.objectContaining({ workspaceId: 'other', socialAccount: { is: { workspaceId: 'other', provider: 'instagram', invalidatedAt: null } } }) }) }) }));
    expect(m.adapter.hideInboxItem).not.toHaveBeenCalled();
  });
  it('requires comment grants and unexpired credentials', async () => {
    m.target.findFirst.mockResolvedValue({ ...target, socialAccount: { scopes: 'instagram_basic', tokenExpiresAt: null } });
    await expect(instagramInboxHost.canManage(actor, 'channel')).resolves.toBe(false);
    m.target.findFirst.mockResolvedValue({ ...target, socialAccount: { ...target.socialAccount, tokenExpiresAt: from } });
    await expect(instagramInboxHost.canManage(actor, 'channel')).resolves.toBe(false);
  });
  it('refuses moderation of pending deletions', async () => {
    m.suppressed.mockResolvedValue(true);
    await expect(instagramInboxHost.moderate(actor, { id: 'comment', hidden: true })).rejects.toThrow('service16');
    expect(m.adapter.hideInboxItem).not.toHaveBeenCalled();
  });
  it('rechecks selection when prepared deletion executes', async () => {
    const prepared = await instagramInboxHost.prepareDeleteComment(actor, { targetId: 'channel', remoteId: 'remote-comment' });
    m.authorize.mockResolvedValue({ channelIds: [] });
    await expect(prepared(new AbortController().signal)).rejects.toThrow('service7');
    expect(m.adapter.deleteInboxItem).not.toHaveBeenCalled();
  });
  it('sync preserves existing moderation state', async () => {
    m.postTarget.findMany.mockResolvedValue([{ id: 'destination', remotePostId: 'remote-post' }]);
    m.adapter.listComments.mockResolvedValue([{ id: 'incoming', text: 'Question', createdAt: from, parentId: null }]);
    await expect(instagramInboxHost.sync(actor, 'channel')).resolves.toEqual(expect.objectContaining({ targetCount: 1, commentCount: 1 }));
    expect(m.postComment.upsert.mock.calls[0][0].update).not.toHaveProperty('isHidden');
  });
  it('fails honestly when the configured publication history bound clips sync', async () => {
    m.policy.mockResolvedValue({ ...INSTAGRAM_POLICY_DEFAULTS, pageSize: 1, maxPages: 1 });
    m.postTarget.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(instagramInboxHost.sync(actor)).rejects.toThrow();
    expect(m.postComment.upsert).not.toHaveBeenCalled();
  });
});
it('discards Inbox fetches after token rotation', async () => {
  m.postTarget.findMany.mockResolvedValue([{ id: 'destination', remotePostId: 'remote-post' }]);
  m.adapter.listComments.mockImplementation(async () => {
    m.target.findFirst.mockResolvedValue({ ...target, accessToken: 'rotated' });
    return [{ id: 'incoming', text: 'Question', createdAt: from }];
  });
  await expect(instagramInboxHost.sync(actor, 'channel')).rejects.toThrow();
  expect(m.postComment.upsert).not.toHaveBeenCalled();
});
it('discards Inbox fetches after publication ownership changes', async () => {
  m.postTarget.findMany.mockResolvedValue([{ id: 'destination', remotePostId: 'remote-post' }]);
  m.adapter.listComments.mockResolvedValue([{ id: 'incoming', text: 'Question', createdAt: from }]);
  m.postTarget.findFirst.mockResolvedValue(null);
  await expect(instagramInboxHost.sync(actor, 'channel')).rejects.toThrow();
  expect(m.postComment.upsert).not.toHaveBeenCalled();
});
it('uses French reply-policy copy', async () => {
  expect(await instagramInboxHost.replyPolicy({ kind: 'comment', channelRemoteId: 'remote', lastInbound: null, timeZone: 'UTC' })).toEqual({ allowed: true, headline: INSTAGRAM_POLICY_DEFAULTS.copy.publicReply.fr });
});
describe('Instagram Analytics host', () => {
  it('keeps ambiguous historical rows non-additive', () => {
    expect(storedInstagramInsight({ metric: 'views', period: 'day', endTime: from, value: 10 }).rangeTotal).toBe(true);
    expect(storedInstagramInsight({ metric: 'views', period: 'day', endTime: from, value: { instagramHostVersion: 1, value: 10, rangeTotal: false } }).rangeTotal).toBe(false);
  });
  it('preserves normalized French labels, period semantics and uncovered channels', async () => {
    m.target.findMany.mockResolvedValue([target, { ...target, id: 'missing', providerId: 'uncovered' }]);
    m.instagramAccount.findMany.mockResolvedValue([{ id: 'account', targetId: 'channel', igUserId: 'remote-account', followersCount: null, lastSyncedAt: from }]);
    m.instagramInsight.findMany.mockResolvedValue([
      { metric: 'views', period: 'day', endTime: from, fetchedAt: to, value: { instagramHostVersion: 1, value: 12, rangeTotal: false } },
      { metric: 'reach', period: 'day', endTime: from, fetchedAt: to, value: { instagramHostVersion: 1, value: 9, rangeTotal: false } },
    ]);
    const result = await instagramAnalyticsHost.load({ workspaceId: 'workspace', selectedTargetIds: ['channel', 'missing'], allowedTargetIds: ['channel', 'missing'], range: { from, to } });
    expect(result.metrics.find(metric => metric.label === 'Vues')).toEqual(expect.objectContaining({ rollup: 'sum', available: 2, covered: 1, coveredResourceIds: ['channel'] }));
    expect(result.metrics.find(metric => metric.label === 'Personnes touchées')?.rollup).toBe('latest-per-channel');
    expect(result.audienceSelected).toBe(2); expect(result.audienceEntries).toEqual([]);
    expect(result.targets[0].providerId).toBe('instagram');
  });
  it('never queries accounts outside an empty authorized selection', async () => {
    m.target.findMany.mockResolvedValue([]);
    const result = await instagramAnalyticsHost.load({ workspaceId: 'other', selectedTargetIds: ['channel'], allowedTargetIds: [], range: { from, to } });
    expect(result.metrics).toEqual([]); expect(m.instagramAccount.findMany).not.toHaveBeenCalled();
    expect(m.target.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'other', id: { in: [] } }) }));
  });
  it('does not query storage when disabled', async () => {
    m.config.mockResolvedValue(false);
    expect((await instagramAnalyticsHost.load({ workspaceId: 'workspace', selectedTargetIds: ['channel'], range: { from, to } })).targets).toEqual([]);
    expect(m.target.findMany).not.toHaveBeenCalled();
  });
});

it('discards Inbox data when the linked source loses selection during fetch', async () => {
  m.postTarget.findMany.mockResolvedValue([{ id: 'destination', remotePostId: 'remote-post' }]);
  m.adapter.listComments.mockResolvedValue([{ id: 'incoming', text: 'Question', createdAt: from }]);
  m.source.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('source deselected'));
  await expect(instagramInboxHost.sync(actor, 'channel')).rejects.toThrow('source deselected');
  expect(m.postComment.upsert).not.toHaveBeenCalled();
});
it('preserves unknown media measures and sorts them after known values', async () => {
  m.instagramMedia.findMany.mockResolvedValue([
    { id: 'unknown', caption: null, timestamp: from, permalink: null, insights: { views: null }, insightsSyncedAt: null },
    { id: 'known', caption: 'Post', timestamp: from, permalink: 'https://example.test/post', insights: { views: 5 }, insightsSyncedAt: to },
  ]);
  const rows = await instagramAnalyticsHost.postPerformance!({ workspaceId: 'workspace', targetId: 'channel', from, to, limit: 10, sort: 'views', direction: 'asc' });
  expect(rows.map(row => row.postId)).toEqual(['known', 'unknown']);
  expect(rows[1].measures[0].value).toBeNull();
});
it('refuses clipped stored analytics instead of claiming complete coverage', async () => {
  m.policy.mockResolvedValue({ ...INSTAGRAM_POLICY_DEFAULTS, analyticsReadMaxRows: 1 });
  m.instagramMedia.findMany.mockResolvedValue([{}, {}]);
  await expect(instagramAnalyticsHost.postPerformance!({ workspaceId: 'workspace', targetId: 'channel', from, to, limit: 10 })).rejects.toThrow(INSTAGRAM_POLICY_DEFAULTS.copy.unavailable.fr);
});
