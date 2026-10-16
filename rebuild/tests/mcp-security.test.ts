import { beforeEach, describe, expect, it, vi } from 'vitest';
const purgeGuard = vi.hoisted(() => vi.fn());
const workspaceGuard = vi.hoisted(() => vi.fn());
vi.mock('../src/server/platforms/registry', () => ({ inboxPlatformIds: async () => ['facebook'], enabledSocialAccountWhere: async () => ({ provider: { in: ['facebook'] } }), platformAds: vi.fn(async () => ({ ui: { campaign: { options: [{ value: 'OUTCOME_TRAFFIC', label: 'Traffic' }], defaultOption: 'OUTCOME_TRAFFIC', confirmationTemplate: 'CREATE PAUSED FACEBOOK CAMPAIGN {nameJson} IN ACCOUNT {adAccountId} WITH OBJECTIVE {objective}' }, adSet: { options: [{ value: 'LINK_CLICKS', label: 'Link clicks' }, { value: 'IMPRESSIONS', label: 'Impressions' }], defaultOption: 'LINK_CLICKS', confirmationTemplate: 'CREATE PAUSED FACEBOOK AD SET {nameJson} UNDER CAMPAIGN {campaignId} IN ACCOUNT {adAccountId} WITH DAILY BUDGET {dailyBudgetMinor} MINOR UNITS TARGETING {countryCode} OPTIMIZED FOR {optimizationGoal}' } }, adSetConfirmation: (input: { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) => `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(input.name)} UNDER CAMPAIGN ${input.campaignId} IN ACCOUNT ${input.adAccountId} WITH DAILY BUDGET ${input.dailyBudgetMinor} MINOR UNITS TARGETING ${input.countryCode} OPTIMIZED FOR ${input.optimizationGoal}` })) }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: purgeGuard, withWorkspaceOperation: workspaceGuard }));

const db = vi.hoisted(() => ({
  target: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  adAccount: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  socialAccount: { findFirst: vi.fn() },
  post: { findMany: vi.fn() },
  pageInsight: { findMany: vi.fn() },
  conversation: { findMany: vi.fn() },
  postComment: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  membership: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: db }));
const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), select: vi.fn() }));
vi.mock('../src/server/post-mutations', () => ({ createLocalDraft: mutations.create, updateLocalDraft: mutations.update, deleteLocalDraft: mutations.remove }));
vi.mock('../src/server/connection-mutations', () => ({ setConnectionSelections: mutations.select }));
const rootConfig = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
const rootWorkspaces = vi.hoisted(() => ({ list: vi.fn(), change: vi.fn() }));
const rootActivity = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/server/root/activity', () => ({ listRootActivity: rootActivity.list }));
vi.mock('../src/server/root/directory', () => ({ listRootWorkspaces: rootWorkspaces.list }));
vi.mock('../src/server/root/workspace-access', () => ({ setRootWorkspaceAccess: rootWorkspaces.change }));
vi.mock('../src/server/config/store', () => ({ readConfig: rootConfig.read, saveConfig: rootConfig.save, runtimeConfig: vi.fn(async (key: string) => key === 'mcp.maxResultItems' ? 100 : key === 'root.directoryPageSize' ? 25 : 366) }));
const analytics = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('../src/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: analytics.snapshot }));
const adsQueries = vi.hoisted(() => ({ accounts: vi.fn(), dataset: vi.fn() }));
vi.mock('../src/server/ads/queries', () => ({ getAdsAccounts: adsQueries.accounts, getAdsDataset: adsQueries.dataset, getAdsAccountWhere: async (workspaceId: string, allowedTargetIds?: string[]) => ({ workspaceId, enabled: true, socialAccount: { is: { workspaceId, invalidatedAt: null, provider: { in: ['facebook'] } } }, ...(allowedTargetIds === undefined ? {} : { socialAccountId: { in: ['social-a'] } }) }) }));
const dataControls = vi.hoisted(() => ({ preview: vi.fn(), export: vi.fn(), remove: vi.fn() }));
vi.mock('../src/server/data-control', () => ({ previewWorkspaceDataDeletion: dataControls.preview, exportWorkspaceData: dataControls.export, deleteWorkspaceData: dataControls.remove }));
const inboxReads = vi.hoisted(() => ({ list: vi.fn(), thread: vi.fn() }));
vi.mock('../src/modules/inbox/server/read', () => ({ readInboxList: inboxReads.list, readInboxThread: inboxReads.thread }));
const publishingReads = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/modules/publishing/server/read', () => ({ readPublishingPostList: publishingReads.list }));
const inboxMutations = vi.hoisted(() => ({ reply: vi.fn(), resolve: vi.fn(), moderate: vi.fn() }));
vi.mock('../src/server/inbox/actions', () => ({ replyToInbox: inboxMutations.reply, setInboxResolved: inboxMutations.resolve, moderateInboxComment: inboxMutations.moderate }));
const inboxDeletions = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn(), finish: vi.fn() }));
vi.mock('../src/modules/inbox/server/deletion', () => ({ getInboxDeletion: inboxDeletions.get, deleteInboxCommentDurably: inboxDeletions.remove, finishInboxDeletion: inboxDeletions.finish }));
const adsMutations = vi.hoisted(() => ({ create: vi.fn(), createAdSet: vi.fn(), update: vi.fn(), read: vi.fn() }));
vi.mock('../src/server/ads/actions', () => ({
  createWorkspaceAdCampaign: adsMutations.create,
  createWorkspaceAdSet: adsMutations.createAdSet,
  updateWorkspaceAd: adsMutations.update,
  readWorkspaceAdObject: adsMutations.read,
  canManageWorkspaceAds: vi.fn().mockResolvedValue(true),
  campaignCreationConfirmation: (_workspaceId: string, adAccountId: string, name: string, objective: string) => `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(name.trim())} IN ACCOUNT ${adAccountId} WITH OBJECTIVE ${objective}`,
}));
const publishingMutations = vi.hoisted(() => ({ publish: vi.fn(), sync: vi.fn(), remove: vi.fn(), create: vi.fn(), update: vi.fn(), submit: vi.fn(), review: vi.fn(), schedule: vi.fn(), cancel: vi.fn() }));
vi.mock('../src/server/publishing/lifecycle', () => ({ publishPost: publishingMutations.publish, syncPostStatus: publishingMutations.sync, deletePost: publishingMutations.remove, createPost: publishingMutations.create, updatePost: publishingMutations.update, submitPostForApproval: publishingMutations.submit, reviewPost: publishingMutations.review, schedulePost: publishingMutations.schedule, cancelScheduledPost: publishingMutations.cancel }));
const firstCommentMutations = vi.hoisted(() => ({ send: vi.fn(), record: vi.fn() }));
vi.mock('../src/modules/publishing/server/first-comment', () => ({ sendFirstComment: firstCommentMutations.send, recordFirstCommentOutcome: firstCommentMutations.record }));
const postDeletions = vi.hoisted(() => ({ get: vi.fn(), finish: vi.fn(), record: vi.fn() }));
vi.mock('../src/modules/publishing/server/deletion', () => ({ getPostDeletion: postDeletions.get, finishPostDeletion: postDeletions.finish, recordPostDeletionOutcome: postDeletions.record }));
const media = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), remove: vi.fn(), upload: vi.fn() }));
vi.mock('../src/server/media/storage', () => ({ listWorkspaceImages: media.list, getWorkspaceImageMetadata: media.get, deleteUnusedWorkspaceImage: media.remove, uploadWorkspaceImage: media.upload }));

import { handleMcpMessage, type McpViewer } from '../src/server/mcp/server';
import { resolvePermissions } from '../src/server/permissions';
import { OperationError } from '../src/lib/operation-error';
import { MediaStorageUnavailable, MediaValidationError } from '../src/server/media/errors';

const snapshot = (overrides: Record<string, unknown> = {}) => {
  const channel = { id: 'page-allowed', name: 'Allowed', type: 'page' };
  const reach = { key: 'reach', label: 'Reach', sourceLabel: 'Page performance', resourceKind: 'channel', aggregationLabel: 'Total over the selected period', unit: 'count', kind: 'flow', total: 12, latestAt: null, coverage: 1, available: 1, coveredResourceIds: ['page-allowed'], points: [], rows: [] };
  return {
    period: { start: '2026-10-01', end: '2026-10-15', range: { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-15T23:59:59.999Z') }, comparison: null },
    options: { channels: [channel], adAccounts: [], metrics: [{ key: 'reach', label: 'Reach', sourceLabel: 'Page performance' }] },
    selected: { channelIds: ['page-allowed'], adAccountIds: [] },
    audience: { total: 12, covered: 1, selected: 1, entries: [] },
    publishing: { published: 0, scheduled: 0, failed: 0 },
    comparisons: {}, query: '', chartPoints: 30, allMetrics: [reach],
    ...overrides,
  };
};

const viewer: McpViewer = {
  scope: 'workspace',
  userId: 'user-a', workspaceId: 'workspace-a', role: 'owner',
  workspace: { id: 'workspace-a', name: 'Alpha', timezone: 'UTC' },
  entitlements: {
    workspaceId: 'workspace-a',
    modules: { home: true, publishing: true, inbox: true, analytics: true, ads: true, settings: true },
    features: { 'home/overview': true, 'publishing/posts': true, 'publishing/calendar': true, 'publishing/queue': true, 'publishing/approvals': true, 'publishing/media': true, 'inbox/conversations': true, 'analytics/overview': true, 'analytics/reports': true, 'ads/overview': true, 'ads/campaigns': true, 'settings/connections': true, 'settings/team': true, 'settings/mcp': true, 'settings/account': true, 'settings/appearance': true, 'settings/data': true },
    platformCapabilities: {},
  },
  permissions: resolvePermissions({ role: 'owner', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }),
};
const call = (name: string, args: Record<string, unknown> = {}) => handleMcpMessage(viewer, {
  jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
});

beforeEach(() => {
  vi.clearAllMocks();
  workspaceGuard.mockImplementation((_id: string, run: () => Promise<unknown>) => run());
  db.$executeRaw.mockResolvedValue(1);
  db.user.findUnique.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  mutations.create.mockResolvedValue({ id: 'new-post' });
  mutations.update.mockResolvedValue(undefined);
  mutations.remove.mockResolvedValue(undefined);
  mutations.select.mockResolvedValue(undefined);
  inboxReads.list.mockResolvedValue({ channels: [], items: [], total: 0, olderCursor: null, newerCursor: null });
  inboxReads.thread.mockResolvedValue({ thread: { id: 'conv-a' }, history: {} });
  publishingReads.list.mockResolvedValue([]);
  inboxMutations.reply.mockResolvedValue({ ok: true });
  inboxMutations.resolve.mockResolvedValue({ ok: true });
  inboxMutations.moderate.mockResolvedValue({ ok: true });
  inboxDeletions.get.mockResolvedValue({ operation: null });
  inboxDeletions.remove.mockResolvedValue({ ok: true, operationId: 'opaque-operation-1', itemId: 'comment-a', state: 'uncertain', remoteConfirmed: false, localConfirmed: false });
  inboxDeletions.finish.mockResolvedValue({ ok: true, operationId: 'opaque-operation-1', itemId: 'comment-a', state: 'remote_confirmed', remoteConfirmed: true, localConfirmed: false });
  adsMutations.create.mockResolvedValue({ campaignId: 'campaign-1' });
  adsMutations.createAdSet.mockResolvedValue({ adSetId: 'adset-1', auditRecorded: true });
  adsMutations.update.mockResolvedValue(undefined);
  adsMutations.read.mockResolvedValue({ id: 'campaign-a', configuredStatus: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED' });
  publishingMutations.publish.mockResolvedValue({ published: 1, failed: 0, needsReconciliation: 0 });
  publishingMutations.sync.mockResolvedValue({ synced: 1 });
  publishingMutations.remove.mockResolvedValue({ ok: true, postId: 'post-a', localConfirmed: true, remoteDeletionRequested: false, state: 'completed', operations: [] });
  publishingMutations.create.mockResolvedValue({ id: 'new-post' });
  publishingMutations.update.mockResolvedValue(undefined);
  publishingMutations.submit.mockResolvedValue(undefined);
  publishingMutations.review.mockResolvedValue(undefined);
  publishingMutations.schedule.mockResolvedValue(undefined);
  publishingMutations.cancel.mockResolvedValue(undefined);
  firstCommentMutations.send.mockResolvedValue({ ok: true, postId: 'post-a', postTargetId: 'post-target-a', state: 'sent' });
  firstCommentMutations.record.mockResolvedValue({ ok: true, postId: 'post-a', postTargetId: 'post-target-a', state: 'ready' });
  postDeletions.get.mockResolvedValue({ ok: true, postId: 'post-a', localConfirmed: false, remoteDeletionRequested: true, state: 'needs_review', operations: [] });
  postDeletions.finish.mockResolvedValue({ ok: true, postId: 'post-a', localConfirmed: true, remoteDeletionRequested: true, state: 'completed', operations: [] });
  postDeletions.record.mockResolvedValue({ ok: true, postId: 'post-a', localConfirmed: false, remoteDeletionRequested: true, state: 'local_pending', operations: [] });
  media.list.mockResolvedValue({ items: [{ id: 'image-a', mimeType: 'image/png', size: 123, createdAt: '2026-10-14T00:00:00.000Z', inUse: false }], nextCursor: null });
  media.get.mockResolvedValue({ id: 'image-a', mimeType: 'image/png', size: 123, createdAt: '2026-10-14T00:00:00.000Z', inUse: false });
  media.remove.mockResolvedValue('deleted');
  media.upload.mockResolvedValue({ id: 'image-b', mimeType: 'image/png', fileName: 'new.png' });
  rootConfig.read.mockResolvedValue([{ key: 'meta.appSecret', value: '', isSet: true, source: 'database' }]);
  rootConfig.save.mockResolvedValue(undefined);
  rootWorkspaces.list.mockResolvedValue({ workspaces: [{ id: 'workspace-b', suspendedAt: null }], total: 1 });
  rootWorkspaces.change.mockResolvedValue({ changed: true, suspended: true });
  rootActivity.list.mockResolvedValue({ items: [{ id: 'audit-a', action: 'config.changed', metadata: [] }], olderCursor: null, newerCursor: null });
  dataControls.preview.mockResolvedValue({ posts: 2 });
  dataControls.export.mockResolvedValue({ format: 'ms-social-pilot-workspace-export', workspace: { id: 'workspace-a' } });
  dataControls.remove.mockResolvedValue({ posts: 2 });
  const targets = [{ id: 'page-allowed', type: 'page', name: 'Allowed' }];
  analytics.snapshot.mockResolvedValue(snapshot({ options: { channels: targets, adAccounts: [], metrics: [] }, allMetrics: [
    { ...snapshot().allMetrics[0], key: 'reach', points: [], rows: [] },
    { ...snapshot().allMetrics[0], key: 'clicks', points: [], rows: [] },
  ] }));
  adsQueries.accounts.mockResolvedValue([{ id: 'account-a', name: 'Account A', currency: 'USD' }]);
  adsQueries.dataset.mockResolvedValue({ insights: [
    { id: 'row-1', adAccountId: 'account-a', level: 'campaign', objectId: 'campaign-a', objectName: 'Campaign A', date: new Date('2026-10-14T00:00:00.000Z'), spend: 20, impressions: 1000, clicks: 20, reach: 900, cpc: 1, cpm: 20, cpp: null, ctr: 2, frequency: 1.1, actions: [], fields: {}, adAccount: { id: 'account-a', name: 'Account A', currency: 'USD' } },
    { id: 'row-2', adAccountId: 'account-a', level: 'ad', objectId: 'ad-a', objectName: 'Ad A', date: new Date('2026-10-14T00:00:00.000Z'), spend: 5, impressions: 500, clicks: 10, reach: 400, cpc: 0.5, cpm: 10, cpp: null, ctr: 2, frequency: 1.25, actions: [], fields: {}, adAccount: { id: 'account-a', name: 'Account A', currency: 'USD' } },
  ] });
});

describe('MCP workspace boundaries', () => {
  it.each([
    ['list_pages', () => db.target.findMany],
    ['list_posts', () => publishingReads.list],
    ['list_inbox', () => inboxReads.list],
    ['get_analytics_overview', () => analytics.snapshot],
    ['preview_workspace_data_deletion', () => dataControls.preview],
    ['export_workspace_data', () => dataControls.export],
  ] as const)('masks unexpected %s read failures with a stable public code', async (name, mock) => {
    mock().mockRejectedValueOnce(new Error('postgres://private-password@db access_token=private-token /srv/private'));
    const response = await call(name);
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.code).toBe('upstream_failure');
    expect(JSON.stringify(body)).not.toMatch(/private-password|private-token|\/srv\/private|postgres:/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('masks unknown write failures without claiming no change happened', async () => {
    inboxMutations.reply.mockRejectedValueOnce(new Error('access_token=private-token'));
    const result = (await (await call('reply_to_inbox', { kind: 'message', id: 'conversation-a', text: 'Hello', confirmation: 'REPLY message conversation-a' })).json()).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe('upstream_failure');
    expect(result.structuredContent.error).toMatch(/outcome.*not.*confirmed/i);
    expect(result.structuredContent.error).toMatch(/before.*repeat/i);
    expect(JSON.stringify(result)).not.toContain('private-token');
  });
  it('keeps typed shared-service recovery errors useful', async () => {
    inboxMutations.reply.mockRejectedValueOnce(new OperationError('reconnect_required', 'Reconnect this channel before replying.'));
    const result = (await (await call('reply_to_inbox', { kind: 'comment', id: 'comment-a', text: 'Hello', confirmation: 'REPLY comment comment-a' })).json()).result;
    expect(result.structuredContent).toEqual({ code: 'reconnect_required', error: 'Reconnect this channel before replying.' });
  });
  it('preserves resource error codes without exposing unexpected query failures', async () => {
    publishingReads.list.mockRejectedValueOnce(new Error('postgres://private-password@db'));
    const failed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'msp://posts' } });
    const failedBody = await failed.json();
    expect(failedBody.error.data.code).toBe('upstream_failure');
    expect(JSON.stringify(failedBody)).not.toContain('private-password');
    analytics.snapshot.mockRejectedValueOnce(new OperationError('unavailable', 'Analytics is temporarily unavailable.'));
    const unavailable = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'msp://analytics/overview' } });
    expect((await unavailable.json()).error).toMatchObject({ message: 'Analytics is temporarily unavailable.', data: { code: 'unavailable' } });
  });
  it.each(['2026-02-31', '2026-13-01', 'not-a-date'])('passes analytics date %s to shared validation', async start => {
    analytics.snapshot.mockRejectedValueOnce(new OperationError('invalid_request', 'Choose a valid analytics date range.'));
    const result = (await (await call('get_analytics_overview', { start })).json()).result;
    expect(result.structuredContent.code).toBe('invalid_request');
    expect(analytics.snapshot).toHaveBeenCalledWith(viewer, { start }, { allowedChannelIds: undefined });
    expect(db.pageInsight.findMany).not.toHaveBeenCalled();
  });
  it.each([{ id: {} }, { id: [] }, { id: true }, { params: [] }, { params: null }])('rejects invalid protocol fields before tool dispatch: %j', async fields => {
    const response = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_posts' }, ...fields });
    expect((await response.json()).error.code).toBe(-32600);
    expect(publishingReads.list).not.toHaveBeenCalled();
  });
  it.each([null, [], 'bad', 42, true])('rejects malformed workspace arguments before domain access: %j', async input => {
    const response = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_posts', arguments: input } });
    expect((await response.json()).result.structuredContent.code).toBe('invalid_request');
    expect(publishingReads.list).not.toHaveBeenCalled();
  });
  it.each([
    ['create_draft', { message: 'Hello', confirmation: 'CREATE DRAFT' }, () => mutations.create, { id: 'new-post', status: 'draft' }],
    ['reply_to_inbox', { kind: 'message', id: 'conversation-a', text: 'Hello', confirmation: 'REPLY message conversation-a' }, () => inboxMutations.reply, { ok: true, itemId: 'conversation-a' }],
    ['publish_post', { postId: 'post-a', confirmation: 'PUBLISH POST post-a' }, () => publishingMutations.publish, { postId: 'post-a', published: 1 }],
    ['delete_post', { postId: 'post-a', deleteRemote: false, confirmation: 'DELETE POST post-a LOCAL' }, () => publishingMutations.remove, { ok: true, postId: 'post-a', localConfirmed: true, remoteDeletionRequested: false, state: 'completed', operations: [] }],
    ['upload_workspace_image', { fileName: 'new.png', mimeType: 'image/png', base64: 'AQID', confirmation: 'UPLOAD WORKSPACE IMAGE new.png' }, () => media.upload, { id: 'image-b' }],
    ['set_connection_selection', { kind: 'target', id: 'target-a', enabled: true, confirmation: 'SET CONNECTION target target-a ENABLED' }, () => mutations.select, { id: 'target-a', enabled: true }],
    ['update_ad', { adAccountId: 'account-a', objectId: 'ad-a', objectType: 'ad', status: 'paused', confirmation: 'SET AD STATUS ad-a TO PAUSED' }, () => adsMutations.update, { objectId: 'ad-a', updated: true }],
  ] as const)('preserves the %s receipt when its secondary MCP audit fails', async (name, args, mutation, expected) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      db.$executeRaw.mockRejectedValueOnce(new Error('postgres://private-password@db'));
      const body = await (await call(name, args)).json();
      expect(body.result.isError).not.toBe(true);
      expect(body.result.structuredContent).toMatchObject({ ...expected, mcpAuditRecorded: false });
      expect(body.result.structuredContent.warning).toMatch(/completed/i);
      expect(body.result.structuredContent.warning).toMatch(/not.*repeat/i);
      expect(mutation()).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([body, log.mock.calls])).not.toContain('private-password');
    } finally { log.mockRestore(); }
  });
  it('protects audit tools/resources from non-Root users and every workspace API key', async () => {
    for (const actor of [viewer, { ...viewer, isInstanceOwner: true, apiKeyId: 'key-1' }]) {
      const invoke = (method: string, params = {}) => handleMcpMessage(actor, { jsonrpc: '2.0', id: 1, method, params });
      expect((await (await invoke('tools/list')).json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('list_root_activity');
      expect((await (await invoke('resources/list')).json()).result.resources.map((resource: { uri: string }) => resource.uri)).not.toContain('msp://root/activity');
      expect((await (await invoke('tools/call', { name: 'list_root_activity', arguments: {} })).json()).result.structuredContent.code).toBe('forbidden');
      expect((await (await invoke('resources/read', { uri: 'msp://root/activity' })).json()).error).toBeDefined();
    }
    expect(rootActivity.list).not.toHaveBeenCalled();
  });

  it('uses the authorized audit service and configured MCP cap for tools and resources', async () => {
    const root = { ...viewer, isInstanceOwner: true, maxResultItems: 10 };
    const input = { q: 'config', from: '2026-10-01', to: '2026-10-16', limit: 50 };
    await handleMcpMessage(root, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_root_activity', arguments: input } });
    expect(rootActivity.list).toHaveBeenLastCalledWith('user-a', input, 10);
    const response = await handleMcpMessage(root, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'msp://root/activity' } });
    expect(rootActivity.list).toHaveBeenLastCalledWith('user-a', {}, 10);
    expect(JSON.parse((await response.json()).result.contents[0].text).items[0].id).toBe('audit-a');
  });

  it('preserves typed audit validation errors and redacts database failures', async () => {
    const invoke = () => handleMcpMessage({ ...viewer, isInstanceOwner: true }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_root_activity', arguments: {} } });
    rootActivity.list.mockRejectedValueOnce(new OperationError('invalid_request', 'Choose valid activity filters.'));
    expect((await (await invoke()).json()).result.structuredContent.code).toBe('invalid_request');
    rootActivity.list.mockRejectedValueOnce(new Error('postgres://private-password@host'));
    const result = (await (await invoke()).json()).result;
    expect(result.structuredContent.code).toBe('upstream_failure');
    expect(JSON.stringify(result)).not.toContain('private-password');
  });
  it('keeps Root workspace tools and resources private to signed-in installation owners', async () => {
    for (const actor of [viewer, { ...viewer, isInstanceOwner: true, apiKeyId: 'key-1' }]) {
      const invoke = (method: string, params = {}) => handleMcpMessage(actor, { jsonrpc: '2.0', id: 1, method, params });
      const listing = await (await invoke('tools/list')).json();
      expect(listing.result.tools.map((tool: { name: string }) => tool.name)).not.toContain('set_root_workspace_access');
      const resources = await (await invoke('resources/list')).json();
      expect(resources.result.resources.map((resource: { uri: string }) => resource.uri)).not.toContain('msp://root/workspaces');
      const forced = await (await invoke('tools/call', { name: 'set_root_workspace_access', arguments: { workspaceId: 'workspace-b', suspended: true, confirmation: 'SUSPEND WORKSPACE workspace-b' } })).json();
      expect(forced.result.structuredContent.code).toBe('forbidden');
      expect((await (await invoke('resources/read', { uri: 'msp://root/workspaces' })).json()).error).toBeDefined();
    }
    expect(rootWorkspaces.list).not.toHaveBeenCalled();
    expect(rootWorkspaces.change).not.toHaveBeenCalled();
  });

  it('routes Root workspace operations through shared services with bounded reads and strict input types', async () => {
    const invoke = (name: string, args: Record<string, unknown>) => handleMcpMessage({ ...viewer, isInstanceOwner: true }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    await invoke('list_root_workspaces', { q: 'Studio', page: 2 });
    expect(rootWorkspaces.list).toHaveBeenCalledWith({ q: 'Studio', page: '2' }, 25);
    const invalid = await (await invoke('set_root_workspace_access', { workspaceId: 'workspace-b', suspended: 'true', confirmation: 'yes' })).json();
    expect(invalid.result.structuredContent.code).toBe('invalid_request');
    expect(rootWorkspaces.change).not.toHaveBeenCalled();
    await invoke('set_root_workspace_access', { workspaceId: 'workspace-b', suspended: true, confirmation: 'SUSPEND WORKSPACE workspace-b' });
    expect(rootWorkspaces.change).toHaveBeenCalledWith('user-a', 'workspace-b', true, 'SUSPEND WORKSPACE workspace-b');
    expect(purgeGuard).not.toHaveBeenCalled();
  });

  it('redacts unexpected Root directory and access failures while preserving public operation errors', async () => {
    const invoke = (name: string, args: Record<string, unknown>) => handleMcpMessage({ ...viewer, isInstanceOwner: true }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    rootWorkspaces.list.mockRejectedValueOnce(new Error('postgres://private-password@database'));
    const failure = await (await invoke('list_root_workspaces', {})).json();
    expect(failure.result.structuredContent.code).toBe('upstream_failure');
    expect(JSON.stringify(failure)).not.toContain('private-password');
    rootWorkspaces.change.mockRejectedValueOnce(new OperationError('conflict', 'Workspace data deletion is in progress.'));
    const conflict = await (await invoke('set_root_workspace_access', { workspaceId: 'workspace-b', suspended: true, confirmation: 'SUSPEND WORKSPACE workspace-b' })).json();
    expect(conflict.result.structuredContent).toEqual({ code: 'conflict', error: 'Workspace data deletion is in progress.' });
    const resource = await (await handleMcpMessage({ ...viewer, isInstanceOwner: true }, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'msp://root/workspaces' } })).json();
    expect(JSON.parse(resource.result.contents[0].text).workspaces[0].id).toBe('workspace-b');
  });
  it('does not expose provider exception details from live Ads reads', async () => {
    adsMutations.read.mockRejectedValueOnce(new Error('Provider unavailable: access_token=private-example'));
    const response = await call('get_live_ad_status', { adAccountId: 'account-a', objectId: 'campaign-a', objectType: 'campaign' });
    const result = (await response.json()).result;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/access_token|private-example|Provider/);
  });
  it('preserves actionable module errors through MCP with the same public code as HTTP', async () => {
    adsMutations.read.mockRejectedValueOnce(new OperationError('reconnect_required', 'Reconnect this advertising connection and allow advertising changes.'));
    const response = await call('get_live_ad_status', { adAccountId: 'account-a', objectId: 'campaign-a', objectType: 'campaign' });
    const result = (await response.json()).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: 'reconnect_required', error: 'Reconnect this advertising connection and allow advertising changes.' });
  });
  it('redacts unexpected storage exceptions from all workspace image tools', async () => {
    const cases: Array<[() => void, string, Record<string, unknown>]> = [
      [() => media.list.mockRejectedValueOnce(new Error('EACCES /srv/private/root/media/images')), 'list_workspace_images', { limit: 10 }],
      [() => media.get.mockRejectedValueOnce(new Error('ENOENT /srv/private/root/media/image-a')), 'get_workspace_image', { imageId: 'image-a' }],
      [() => media.remove.mockRejectedValueOnce(new Error('EIO /srv/private/root/media/image-a')), 'delete_workspace_image', { imageId: 'image-a', confirmation: 'DELETE WORKSPACE IMAGE image-a' }],
      [() => media.upload.mockRejectedValueOnce(new Error('EACCES /srv/private/root/media/images')), 'upload_workspace_image', { fileName: 'new.png', mimeType: 'image/png', base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'), confirmation: 'UPLOAD WORKSPACE IMAGE new.png' }],
    ];
    for (const [reject, name, args] of cases) {
      reject();
      const result = (await (await call(name, args)).json()).result;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: 'upstream_failure', error: 'The image operation could not be completed. Please try again.' });
      expect(JSON.stringify(result)).not.toMatch(/EACCES|ENOENT|EIO|private\/root/);
    }
  });
  it('maps typed media storage and validation failures to safe MCP codes', async () => {
    media.list.mockRejectedValueOnce(new MediaStorageUnavailable());
    const unavailable = (await (await call('list_workspace_images', { limit: 10 })).json()).result;
    expect(unavailable.structuredContent).toEqual({ code: 'unavailable', error: 'Image storage is temporarily unavailable. Try again later.' });

    media.get.mockRejectedValueOnce(new MediaValidationError('invalid_cursor'));
    const invalid = (await (await call('get_workspace_image', { imageId: 'image-a' })).json()).result;
    expect(invalid.structuredContent).toEqual({ code: 'invalid_request', error: 'Invalid media cursor.' });
  });
  it('rejects string budgets instead of coercing a different input shape than HTTP accepts', async () => {
    const response = await call('update_ad', { adAccountId: 'account-a', objectId: 'campaign-a', objectType: 'campaign', dailyBudgetMinor: '500', confirmation: 'SET AD BUDGET campaign-a TO 500 MINOR UNITS' });
    const result = (await response.json()).result;
    expect(result.isError).toBe(true);
    expect(adsMutations.update).not.toHaveBeenCalled();
  });
  it('sanitizes unexpected failures from Ads creation metadata as well as provider requests', async () => {
    db.adAccount.findFirst.mockResolvedValueOnce({ id: 'account-a', currency: 'USD', socialAccount: { provider: 'facebook' } });
    const { canManageWorkspaceAds } = await import('../src/server/ads/actions');
    vi.mocked(canManageWorkspaceAds).mockRejectedValueOnce(new Error('Root configuration unavailable: private-example'));
    const result = (await (await call('get_ad_creation_options', { adAccountId: 'account-a' })).json()).result;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Root|private-example/);
  });
  it('returns a safe JSON-RPC error when an Ads resource read fails', async () => {
    adsQueries.dataset.mockRejectedValueOnce(new Error('Private provider or database detail: private-example'));
    const response = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 90, method: 'resources/read', params: { uri: 'msp://ads/performance' } });
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(JSON.stringify(result)).not.toMatch(/Private|private-example/);
  });
  it('lists and reads image metadata only inside the authenticated workspace scope', async () => {
    const listed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 30, method: 'tools/list' });
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('list_workspace_images');
    const response = await call('list_workspace_images', { limit: 25, cursor: 'cursor-1' });
    expect((await response.json()).result.structuredContent.items[0]).toMatchObject({ id: 'image-a', size: 123, inUse: false });
    expect(media.list).toHaveBeenCalledWith('workspace-a', { limit: 25, cursor: 'cursor-1' });
    const got = await call('get_workspace_image', { imageId: 'image-a' });
    expect((await got.json()).result.structuredContent).toMatchObject({ id: 'image-a', mimeType: 'image/png' });
    expect(media.get).toHaveBeenCalledWith('workspace-a', 'image-a');

    const scoped = { ...viewer, permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-allowed' }] }) };
    const hidden = await handleMcpMessage({ ...scoped, permissions: { ...scoped.permissions!, features: { ...scoped.permissions!.features, 'publishing/media': { read: false, write: false } } } }, { jsonrpc: '2.0', id: 31, method: 'tools/list' });
    expect((await hidden.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('list_workspace_images');
    const readOnly = { ...viewer, permissions: { ...viewer.permissions!, features: { ...viewer.permissions!.features, 'publishing/media': { read: true, write: false } } } };
    const readTools = await handleMcpMessage(readOnly, { jsonrpc: '2.0', id: 32, method: 'tools/list' });
    const readNames = (await readTools.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(readNames).toContain('list_workspace_images');
    expect(readNames).not.toContain('delete_workspace_image');
    const deniedWrite = await handleMcpMessage(readOnly, { jsonrpc: '2.0', id: 33, method: 'tools/call', params: { name: 'delete_workspace_image', arguments: { imageId: 'image-a', confirmation: 'DELETE WORKSPACE IMAGE image-a' } } });
    expect((await deniedWrite.json()).result.isError).toBe(true);
    expect(media.remove).not.toHaveBeenCalled();
  });
  it('deletes only unused workspace images after exact confirmation and audits the write', async () => {
    const bad = await call('delete_workspace_image', { imageId: 'image-a', confirmation: 'DELETE IMAGE image-a' });
    expect((await bad.json()).result.isError).toBe(true);
    expect(media.remove).not.toHaveBeenCalled();
    const deleted = await call('delete_workspace_image', { imageId: 'image-a', confirmation: 'DELETE WORKSPACE IMAGE image-a' });
    expect((await deleted.json()).result.structuredContent).toEqual({ imageId: 'image-a', deleted: true, mcpAuditRecorded: true });
    expect(media.remove).toHaveBeenCalledWith('workspace-a', 'image-a');
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);

    media.remove.mockResolvedValueOnce('in_use');
    const inUse = await call('delete_workspace_image', { imageId: 'image-a', confirmation: 'DELETE WORKSPACE IMAGE image-a' });
    expect((await inUse.json()).result.isError).toBe(true);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('uploads validated base64 data with Root byte cap, storage signature checks, and audit', async () => {
    const confirmation = 'UPLOAD WORKSPACE IMAGE new.png';
    const bad = await call('upload_workspace_image', { fileName: 'new.png', mimeType: 'image/png', base64: 'not-base64', confirmation });
    expect((await bad.json()).result.isError).toBe(true);
    expect(media.upload).not.toHaveBeenCalled();
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const uploaded = await call('upload_workspace_image', { fileName: 'new.png', mimeType: 'image/png', base64: bytes.toString('base64'), confirmation });
    expect((await uploaded.json()).result.structuredContent).toMatchObject({ id: 'image-b', reference: 'media:image-b', size: 8 });
    expect(media.upload).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, expect.objectContaining({ name: 'new.png', type: 'image/png', size: 8 }));
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('reads paginated Ads performance through workspace and channel scoped services', async () => {
    const scoped = { ...viewer, role: 'viewer', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-allowed' }] }) };
    const listed = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 48, method: 'tools/list' });
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('get_ads_performance');
    const response = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 49, method: 'tools/call', params: { name: 'get_ads_performance', arguments: { accountId: 'account-a', start: '2026-10-14', end: '2026-10-14', limit: 1 } } });
    const result = (await response.json()).result.structuredContent;
    expect(result.performance).toHaveLength(1);
    expect(result.performance[0]).toMatchObject({ id: 'campaign-a', spend: 20, accountId: 'account-a' });
    expect(result.nextOffset).toBe(1);
    expect(adsQueries.accounts).toHaveBeenCalledWith('workspace-a', ['page-allowed']);
    expect(adsQueries.dataset).toHaveBeenCalledWith('workspace-a', expect.objectContaining({ accountId: 'account-a' }), ['page-allowed']);

    const denied = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 491, method: 'tools/call', params: { name: 'get_ads_performance', arguments: { accountId: 'other-workspace-account' } } });
    expect((await denied.json()).result.isError).toBe(true);
    expect(adsQueries.dataset).toHaveBeenCalledTimes(1);
  });
  it('exposes live Ads status only through the scoped read permission and shared status service', async () => {
    const scoped = { ...viewer, role: 'viewer', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-allowed' }] }) };
    const listed = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 491, method: 'tools/list' });
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('get_live_ad_status');
    const response = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 492, method: 'tools/call', params: { name: 'get_live_ad_status', arguments: { adAccountId: 'account-a', objectId: 'campaign-a', objectType: 'campaign' } } });
    expect((await response.json()).result.structuredContent).toMatchObject({ configuredStatus: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED' });
    expect(adsMutations.read).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { adAccountId: 'account-a', objectId: 'campaign-a', objectType: 'campaign' }, ['page-allowed']);
    expect(db.$executeRaw).not.toHaveBeenCalled();

    const deniedViewer = { ...scoped, permissions: { ...scoped.permissions!, features: { ...scoped.permissions!.features, 'ads/campaigns': { read: false, write: false } } } };
    const hidden = await handleMcpMessage(deniedViewer, { jsonrpc: '2.0', id: 493, method: 'tools/list' });
    expect((await hidden.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('get_live_ad_status');
    const denied = await handleMcpMessage(deniedViewer, { jsonrpc: '2.0', id: 494, method: 'tools/call', params: { name: 'get_live_ad_status', arguments: { adAccountId: 'account-a', objectId: 'campaign-a', objectType: 'campaign' } } });
    expect((await denied.json()).result.isError).toBe(true);
    const malformed = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 495, method: 'tools/call', params: { name: 'get_live_ad_status', arguments: { adAccountId: 'account/a', objectId: 'campaign-a', objectType: 'campaign' } } });
    expect((await malformed.json()).result.isError).toBe(true);
    expect(adsMutations.read).toHaveBeenCalledTimes(1);
  });
  it('passes selected channels and current page scope to the shared Analytics read service', async () => {
    const scoped = { ...viewer, permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-allowed' }] }) };
    const response = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'get_analytics_overview', arguments: { targetIds: ['page-allowed'], limit: 1 } } });
    const result = (await response.json()).result.structuredContent;
    expect(result.audience.total).toBe(12);
    expect(result.metrics.map((metric: { key: string }) => metric.key)).toEqual(['reach']);
    expect(analytics.snapshot).toHaveBeenCalledWith(scoped, { filter: '1', channel: ['page-allowed'] }, { allowedChannelIds: ['page-allowed'] });
  });
  it('maps explicit empty selections, ad account filters, search, and comparison into shared reads', async () => {
    const comparable = { previous: 8, delta: 4, percent: 50, status: 'comparable' };
    const base = snapshot({ period: { ...snapshot().period, comparison: { mode: 'year', start: '2025-10-01', end: '2025-10-15', range: { from: new Date('2025-10-01T00:00:00.000Z'), to: new Date('2025-10-15T23:59:59.999Z') } } }, comparisons: { reach: comparable } });
    analytics.snapshot.mockResolvedValue(base);
    const overview = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 52, method: 'tools/call', params: { name: 'get_analytics_overview', arguments: { targetIds: [], adAccountIds: [], compare: 'year', search: 'reach' } } });
    const overviewResult = (await overview.json()).result.structuredContent;
    expect(overviewResult.metrics[0].comparison).toEqual(comparable);
    expect(analytics.snapshot).toHaveBeenLastCalledWith(viewer, { compare: 'year', filter: '1', channel: [], adFilter: '1', adAccount: [], search: 'reach' }, { allowedChannelIds: undefined });

    await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 53, method: 'tools/call', params: { name: 'get_analytics_metric_details', arguments: { metricKey: 'reach', kind: 'points', adAccountIds: ['ad-a'], compare: 'previous', search: 'reach' } } });
    expect(analytics.snapshot).toHaveBeenLastCalledWith(viewer, { compare: 'previous', adFilter: '1', adAccount: ['ad-a'], search: 'reach', metric: 'reach' }, { allowedChannelIds: undefined });
  });
  it.each([
    { offset: -1 }, { limit: 201 }, { targetIds: ['a', 'b'] }, { adAccountIds: ['a', 'b'] },
  ])('validates MCP-specific page bounds and selection caps before shared reads: %j', async args => {
    const limited = { ...viewer, maxResultItems: 1 };
    const response = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 54, method: 'tools/call', params: { name: 'get_analytics_overview', arguments: args } });
    expect((await response.json()).result.structuredContent.code).toBe('invalid_request');
    expect(analytics.snapshot).not.toHaveBeenCalled();
  });
  it('passes analytics search and comparison values through to shared validation', async () => {
    const args = { compare: 'invalid-mode', search: 'x'.repeat(500), targetIds: [], adAccountIds: [] };
    analytics.snapshot.mockRejectedValueOnce(new OperationError('invalid_request', 'Choose valid analytics filters.'));
    const result = (await (await call('get_analytics_overview', args)).json()).result;
    expect(result.structuredContent.code).toBe('invalid_request');
    expect(analytics.snapshot).toHaveBeenCalledWith(viewer, { compare: args.compare, search: args.search, filter: '1', channel: [], adFilter: '1', adAccount: [] }, { allowedChannelIds: undefined });
    expect(db.pageInsight.findMany).not.toHaveBeenCalled();
  });
  it('publishes scoped Analytics and Ads resources using the same read tools', async () => {
    const resources = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 52, method: 'resources/list' });
    const uris = (await resources.json()).result.resources.map((resource: { uri: string }) => resource.uri);
    expect(uris).toContain('msp://analytics/overview');
    expect(uris).toContain('msp://ads/performance');

    const analyticsResource = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 53, method: 'resources/read', params: { uri: 'msp://analytics/overview' } });
    expect((await analyticsResource.json()).result.contents[0].text).toContain('"audience"');
    expect(analytics.snapshot).toHaveBeenCalledWith(viewer, {}, { allowedChannelIds: undefined });

    const adsResource = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 54, method: 'resources/read', params: { uri: 'msp://ads/performance' } });
    expect((await adsResource.json()).result.contents[0].text).toContain('"performance"');
    expect(adsQueries.accounts).toHaveBeenCalledWith('workspace-a', undefined);
  });
  it('caps nested Analytics result rows and reports truncation', async () => {
    const limited = { ...viewer, maxResultItems: 1 };
    const base = snapshot({ audience: { total: 30, covered: 2, selected: 2, entries: [{ id: 'page-a' }, { id: 'page-b' }] }, allMetrics: [{ ...snapshot().allMetrics[0], points: [{ date: '2026-10-14' }, { date: '2026-10-15' }], rows: [{ label: 'A' }, { label: 'B' }] }] });
    analytics.snapshot.mockResolvedValueOnce(base);
    const response = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 55, method: 'tools/call', params: { name: 'get_analytics_overview', arguments: { limit: 1 } } });
    const result = (await response.json()).result.structuredContent;
    expect(result.audience).toMatchObject({ total: 30, entries: [{ id: 'page-a' }], entriesTruncated: true });
    expect(result.metrics[0]).toMatchObject({ points: [{ date: '2026-10-14' }], rows: [{ label: 'A' }], pointsTruncated: true, rowsTruncated: true });
  });
  it('paginates audience entries and selected targets beyond the Root result cap', async () => {
    const limited = { ...viewer, maxResultItems: 1 };
    const targets = [{ id: 'page-a', type: 'page', name: 'Page A' }, { id: 'page-b', type: 'page', name: 'Page B' }];
    analytics.snapshot.mockResolvedValue(snapshot({ options: { channels: targets, adAccounts: [], metrics: [] }, selected: { channelIds: ['page-a', 'page-b'], adAccountIds: [] }, audience: { total: 30, covered: 2, selected: 2, entries: [{ id: 'page-a', value: 10 }, { id: 'page-b', value: 20 }] }, allMetrics: [] }));
    const first = (await (await handleMcpMessage(limited, { jsonrpc: '2.0', id: 57, method: 'tools/call', params: { name: 'get_analytics_overview', arguments: { limit: 1 } } })).json()).result.structuredContent;
    expect(first.audience.entries).toEqual([{ id: 'page-a', value: 10 }]);
    expect(first.audience.nextOffset).toBe(1);
    expect(first.selectedTargets.map((target: { id: string }) => target.id)).toEqual(['page-a']);
    expect(first.nextTargetOffset).toBe(1);

    const second = (await (await handleMcpMessage(limited, { jsonrpc: '2.0', id: 58, method: 'tools/call', params: { name: 'get_analytics_overview', arguments: { limit: 1, audienceOffset: 1, targetOffset: 1 } } })).json()).result.structuredContent;
    expect(second.audience.entries).toEqual([{ id: 'page-b', value: 20 }]);
    expect(second.audience.nextOffset).toBeNull();
    expect(second.selectedTargets.map((target: { id: string }) => target.id)).toEqual(['page-b']);
    expect(second.nextTargetOffset).toBeNull();
  });
  it('paginates accessible Ads accounts independently of performance rows', async () => {
    const limited = { ...viewer, maxResultItems: 1 };
    adsQueries.accounts.mockResolvedValue([{ id: 'account-a', name: 'Account A', currency: 'USD' }, { id: 'account-b', name: 'Account B', currency: 'EUR' }]);
    const response = (offset: number) => handleMcpMessage(limited, { jsonrpc: '2.0', id: 59 + offset, method: 'tools/call', params: { name: 'get_ads_performance', arguments: { accountOffset: offset, limit: 1 } } });
    const first = (await (await response(0)).json()).result.structuredContent;
    expect(first.accounts).toEqual([{ id: 'account-a', name: 'Account A', currency: 'USD' }]);
    expect(first.accountCount).toBe(2);
    expect(first.nextAccountOffset).toBe(1);
    const second = (await (await response(1)).json()).result.structuredContent;
    expect(second.accounts).toEqual([{ id: 'account-b', name: 'Account B', currency: 'EUR' }]);
    expect(second.nextAccountOffset).toBeNull();
  });
  it('paginates the manager-only ad account directory beyond the Root result cap', async () => {
    const limited = { ...viewer, maxResultItems: 1 };
    db.adAccount.findMany.mockResolvedValueOnce([{ id: 'account-a' }]).mockResolvedValueOnce([{ id: 'account-b' }]);
    db.adAccount.count.mockResolvedValue(2);
    const readPage = (offset: number) => handleMcpMessage(limited, { jsonrpc: '2.0', id: 61 + offset, method: 'tools/call', params: { name: 'list_ad_accounts', arguments: { offset, limit: 1 } } });
    const first = (await (await readPage(0)).json()).result.structuredContent;
    expect(first.accounts).toEqual([{ id: 'account-a' }]);
    expect(first.nextOffset).toBe(1);
    const second = (await (await readPage(1)).json()).result.structuredContent;
    expect(second.accounts).toEqual([{ id: 'account-b' }]);
    expect(second.nextOffset).toBeNull();
    expect(db.adAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace-a', enabled: true, socialAccount: { is: expect.objectContaining({ workspaceId: 'workspace-a', invalidatedAt: null, provider: { in: ['facebook'] } }) } }), skip: 1, take: 1 }));
  });
  it('paginates every point and row for an authorized Analytics metric', async () => {
    const limited = { ...viewer, maxResultItems: 1, role: 'viewer', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-allowed' }] }) };
    analytics.snapshot.mockResolvedValue(snapshot({ allMetrics: [{ ...snapshot().allMetrics[0], key: 'reach::day', label: 'Reach', aggregationLabel: 'Latest value per resource', aggregationNote: 'People may overlap', points: [{ date: '2026-10-14', value: 4 }, { date: '2026-10-15', value: 5 }], rows: [{ label: 'Page A', value: 4 }, { label: 'Page B', value: 5 }] }] }));
    const callMetric = (kind: 'points' | 'rows', offset: number) => handleMcpMessage(limited, { jsonrpc: '2.0', id: 56 + offset, method: 'tools/call', params: { name: 'get_analytics_metric_details', arguments: { metricKey: 'reach::day', kind, offset, limit: 1, targetIds: ['page-allowed'], start: '2026-10-14', end: '2026-10-15' } } });

    for (const kind of ['points', 'rows'] as const) {
      const first = (await (await callMetric(kind, 0)).json()).result.structuredContent;
      expect(first.items).toHaveLength(1);
      expect(first.metric.aggregationNote).toBe('People may overlap');
      expect(first.metric.aggregationLabel).toBe('Latest value per resource');
      expect(first.nextOffset).toBe(1);
      const second = (await (await callMetric(kind, 1)).json()).result.structuredContent;
      expect(second.items).toHaveLength(1);
      expect(second.nextOffset).toBeNull();
      expect(second.totalCount).toBe(2);
    }
    expect(analytics.snapshot).toHaveBeenCalledWith(limited, expect.objectContaining({ filter: '1', channel: ['page-allowed'], metric: 'reach::day' }), { allowedChannelIds: ['page-allowed'] });
  });
  it('applies ads write scope, manager role, and exact confirmations before shared ads services', async () => {
    const listed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 60, method: 'tools/list' });
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('create_ad_campaign');
    const limited = { ...viewer, role: 'viewer', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }) };
    const hidden = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 61, method: 'tools/list' });
    expect((await hidden.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('update_ad');
    const denied = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 62, method: 'tools/call', params: { name: 'update_ad', arguments: {} } });
    expect((await denied.json()).result.isError).toBe(true);
    expect(adsMutations.update).not.toHaveBeenCalled();

    const campaign = { adAccountId: 'account-1', name: 'Autumn launch', objective: 'OUTCOME_TRAFFIC' };
    const bad = await call('create_ad_campaign', { ...campaign, confirmation: 'CREATE CAMPAIGN' });
    expect((await bad.json()).result.isError).toBe(true);
    expect(adsMutations.create).not.toHaveBeenCalled();
    const confirmation = 'CREATE PAUSED FACEBOOK CAMPAIGN "Autumn launch" IN ACCOUNT account-1 WITH OBJECTIVE OUTCOME_TRAFFIC';
    const created = await call('create_ad_campaign', { ...campaign, confirmation });
    expect((await created.json()).result.structuredContent).toMatchObject({ campaignId: 'campaign-1', confirmedSuccess: true, mcpAuditRecorded: true });
    expect(adsMutations.create).toHaveBeenCalledWith(viewer, { ...campaign, confirmation });

    const change = { adAccountId: 'account-1', objectId: 'campaign-1', objectType: 'campaign', status: 'paused' };
    const updated = await call('update_ad', { ...change, confirmation: 'SET AD STATUS campaign-1 TO PAUSED' });
    expect((await updated.json()).result.structuredContent.updated).toBe(true);
    expect(adsMutations.update).toHaveBeenCalledWith(viewer, { ...change, dailyBudgetMinor: undefined, lifetimeBudgetMinor: undefined, confirmation: 'SET AD STATUS campaign-1 TO PAUSED' });
  });
  it('returns confirmed remote Ads receipts when MCP audit persistence fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    adsMutations.create.mockResolvedValueOnce({ created: true, campaignId: 'remote-campaign-9', status: 'paused', auditRecorded: true });
    db.$executeRaw.mockRejectedValueOnce(new Error('database unavailable'));
    const campaign = await call('create_ad_campaign', { adAccountId: 'account-1', name: 'Autumn launch', objective: 'OUTCOME_TRAFFIC', confirmation: 'CREATE PAUSED FACEBOOK CAMPAIGN "Autumn launch" IN ACCOUNT account-1 WITH OBJECTIVE OUTCOME_TRAFFIC' });
    const campaignResult = (await campaign.json()).result.structuredContent;
    expect(campaignResult).toMatchObject({ confirmedSuccess: true, campaignId: 'remote-campaign-9', status: 'paused', auditRecorded: true, mcpAuditRecorded: false });
    expect(campaignResult.warning).toContain('Do not submit this creation again.');
    expect(adsMutations.create).toHaveBeenCalledTimes(1);

    db.adAccount.findFirst.mockResolvedValue({ id: 'account-1', currency: 'USD', socialAccount: { provider: 'facebook' } });
    adsMutations.createAdSet.mockResolvedValueOnce({ created: true, adSetId: 'remote-adset-7', status: 'paused', auditRecorded: true });
    db.$executeRaw.mockRejectedValueOnce(new Error('database unavailable'));
    const adSet = await call('create_ad_set', { adAccountId: 'account-1', campaignId: 'campaign-1', name: 'Prospecting', dailyBudgetMinor: 5000, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS', confirmation: 'CREATE PAUSED FACEBOOK AD SET "Prospecting" UNDER CAMPAIGN campaign-1 IN ACCOUNT account-1 WITH DAILY BUDGET 5000 MINOR UNITS TARGETING MA OPTIMIZED FOR LINK_CLICKS' });
    const adSetResult = (await adSet.json()).result.structuredContent;
    expect(adSetResult).toMatchObject({ confirmedSuccess: true, adSetId: 'remote-adset-7', status: 'paused', auditRecorded: true, mcpAuditRecorded: false });
    expect(adSetResult.warning).toContain('Do not submit this creation again.');
    expect(adsMutations.createAdSet).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('MCP Ads creation succeeded but its audit record could not be saved.', expect.objectContaining({ tool: 'create_ad_set', adSetId: 'remote-adset-7' }));
    log.mockRestore();
  });
  it('discovers safe selected-account Ads options and creates ad sets only with all-page scope and exact confirmation', async () => {
    const listed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 70, method: 'tools/list' });
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('create_ad_set');
    db.adAccount.findFirst.mockResolvedValue({ id: 'account-1', currency: 'USD', socialAccount: { provider: 'facebook' } });
    const options = await call('get_ad_creation_options', { adAccountId: 'account-1' });
    const optionsResult = (await options.json()).result.structuredContent;
    expect(optionsResult.adSet.options).toEqual([{ value: 'LINK_CLICKS', label: 'Link clicks' }, { value: 'IMPRESSIONS', label: 'Impressions' }]);
    expect(JSON.stringify(optionsResult)).not.toContain('accessToken');
    const { canManageWorkspaceAds } = await import('../src/server/ads/actions');
    expect(canManageWorkspaceAds).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, 'account-1');

    const values = { adAccountId: 'account-1', campaignId: 'campaign-1', name: 'Autumn audience', dailyBudgetMinor: 2500, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' };
    const exact = 'CREATE PAUSED FACEBOOK AD SET "Autumn audience" UNDER CAMPAIGN campaign-1 IN ACCOUNT account-1 WITH DAILY BUDGET 2500 MINOR UNITS TARGETING MA OPTIMIZED FOR LINK_CLICKS';
    const bad = await call('create_ad_set', { ...values, confirmation: 'CREATE AD SET' });
    expect((await bad.json()).result.isError).toBe(true);
    expect(adsMutations.createAdSet).not.toHaveBeenCalled();
    const invalidBudget = await call('create_ad_set', { ...values, dailyBudgetMinor: '2500', confirmation: exact });
    expect((await invalidBudget.json()).result.isError).toBe(true);
    expect(adsMutations.createAdSet).not.toHaveBeenCalled();
    const created = await call('create_ad_set', { ...values, confirmation: exact });
    expect((await created.json()).result.structuredContent.adSetId).toBe('adset-1');
    expect(adsMutations.createAdSet).toHaveBeenCalledWith(viewer, { ...values, confirmation: exact }, true);

    const limited = { ...viewer, permissions: { ...viewer.permissions!, pageScope: { all: false, ids: ['page-a'] } } };
    const denied = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'create_ad_set', arguments: { ...values, confirmation: exact } } });
    expect((await denied.json()).result.isError).toBe(true);
    expect(adsMutations.createAdSet).toHaveBeenCalledTimes(1);
  });
  it('limits Ads creation metadata to resources in scope and hides it when management is unavailable', async () => {
    db.target.findMany.mockResolvedValue([{ socialAccountId: 'social-a' }]);
    db.adAccount.findFirst.mockResolvedValue({ id: 'account-1', currency: 'USD', socialAccount: { provider: 'facebook' } });
    const scopedViewer = { ...viewer, permissions: { ...viewer.permissions!, pageScope: { all: false, ids: ['page-a'] } } };
    const scoped = await handleMcpMessage(scopedViewer, { jsonrpc: '2.0', id: 72, method: 'tools/call', params: { name: 'get_ad_creation_options', arguments: { adAccountId: 'account-1' } } });
    const scopedResult = (await scoped.json()).result.structuredContent;
    expect(scopedResult.campaign.options).toBeDefined();
    expect(scopedResult.adSet).toBeNull();
    expect(db.adAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ socialAccountId: { in: ['social-a'] } }) }));

    const { canManageWorkspaceAds } = await import('../src/server/ads/actions');
    vi.mocked(canManageWorkspaceAds).mockResolvedValueOnce(false);
    const unavailable = await call('get_ad_creation_options', { adAccountId: 'account-1' });
    const unavailableResult = (await unavailable.json()).result;
    expect(unavailableResult.isError).toBe(true);
    expect(unavailableResult.structuredContent.error).toBe('The selected advertising account is unavailable.');
  });
  it('exposes workspace data controls only to managers and requires exact deletion confirmation', async () => {
    const listed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 40, method: 'tools/list' });
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('delete_workspace_data');
    const limited = { ...viewer, role: 'viewer', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }) };
    const hidden = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 41, method: 'tools/list' });
    expect((await hidden.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('export_workspace_data');
    const denied = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'export_workspace_data', arguments: {} } });
    expect((await denied.json()).result.isError).toBe(true);
    expect(dataControls.export).not.toHaveBeenCalled();
    const resources = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 43, method: 'resources/list' });
    expect((await resources.json()).result.resources.map((resource: { uri: string }) => resource.uri)).not.toContain('msp://data/deletion-preview');
    const deniedResource = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 44, method: 'resources/read', params: { uri: 'msp://data/deletion-preview' } });
    expect((await deniedResource.json()).error).toBeDefined();

    await call('preview_workspace_data_deletion');
    await call('export_workspace_data');
    const permittedResource = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 45, method: 'resources/read', params: { uri: 'msp://data/deletion-preview' } });
    expect((await permittedResource.json()).result.contents[0].text).toContain('"posts": 2');
    expect(dataControls.preview).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' });
    expect(dataControls.export).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' });
    const missing = await call('delete_workspace_data', { confirmation: 'DELETE' });
    expect((await missing.json()).result.isError).toBe(true);
    expect(dataControls.remove).not.toHaveBeenCalled();
    const deleted = await call('delete_workspace_data', { confirmation: 'DELETE WORKSPACE DATA workspace-a' });
    expect((await deleted.json()).result.structuredContent).toEqual({ deleted: true, counts: { posts: 2 } });
    expect(dataControls.remove).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, 'DELETE');
    expect(db.$executeRaw).not.toHaveBeenCalled();
    const bearer = await handleMcpMessage({ ...viewer, apiKeyId: 'key-a' }, { jsonrpc: '2.0', id: 46, method: 'tools/call', params: { name: 'delete_workspace_data', arguments: { confirmation: 'DELETE WORKSPACE DATA workspace-a' } } });
    expect((await bearer.json()).result.structuredContent.deleted).toBe(true);
    expect(dataControls.remove).toHaveBeenLastCalledWith({ userId: 'user-a', workspaceId: 'workspace-a', apiKeyId: 'key-a' }, 'DELETE');
  });
  it('scopes destination queries and delegates post reads with the MCP result cap', async () => {
    db.target.findMany.mockResolvedValue([]);
    await call('list_pages');
    await call('list_posts', { limit: 900 });
    expect(db.target.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'workspace-a', enabled: true, socialAccount: { is: { workspaceId: 'workspace-a', invalidatedAt: null, provider: { in: ['facebook'] } } } });
    expect(publishingReads.list).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { limit: 900 }, { maxItems: 100 });
  });

  it('does not advertise or dispatch the removed legacy page analytics tool', async () => {
    const listed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain('get_page_analytics');
    const response = await call('get_page_analytics', { pageId: 'page-a' });
    expect((await response.json()).error).toMatchObject({ code: -32602, message: 'Unknown tool: get_page_analytics' });
    expect(db.target.findFirst).not.toHaveBeenCalled();
    expect(db.pageInsight.findMany).not.toHaveBeenCalled();
  });

  it('applies feature grants and page scope to MCP discovery and reads', async () => {
    const limited = { ...viewer, role: 'viewer', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-a' }] }) };
    const listed = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list_posts');
    expect(names).not.toContain('create_draft');
    expect(names).not.toContain('list_ad_accounts');

    await handleMcpMessage(limited, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_posts', arguments: {} } });
    expect(publishingReads.list).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['page-a'] }, {}, { maxItems: 100 });
  });

  it('delegates post filter validation and preserves typed service errors', async () => {
    publishingReads.list.mockRejectedValueOnce(new OperationError('invalid_request', 'Choose a valid post status.'));
    const invalidStatus = await call('list_posts', { status: 'draft,owner' });
    expect((await invalidStatus.json()).result.isError).toBe(true);
    expect(publishingReads.list).toHaveBeenLastCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { status: 'draft,owner' }, { maxItems: 100 });
    publishingReads.list.mockRejectedValueOnce(new OperationError('invalid_request', 'Choose valid ISO date filters.'));
    const invalidDate = await call('list_posts', { from: 'not-a-date' });
    expect((await invalidDate.json()).result.isError).toBe(true);
    expect(publishingReads.list).toHaveBeenLastCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { from: 'not-a-date' }, { maxItems: 100 });
  });

  it('uses the same scoped Inbox services as UI and HTTP with a bounded projection', async () => {
    const result = await (await call('list_inbox', { hidden: 'all', q: 'literal_%' })).json();
    expect(inboxReads.list).toHaveBeenCalledWith({ userId: viewer.userId, workspaceId: viewer.workspaceId }, { hidden: 'all', q: 'literal_%' }, { allowedChannelIds: undefined, maxItems: 100 });
    expect(result.result.structuredContent).toMatchObject({ items: [], total: 0, channelCount: 0 });
    expect(result.result.structuredContent).not.toHaveProperty('channels');
    await call('get_inbox_thread', { key: 'message:conv-a' });
    expect(inboxReads.thread).toHaveBeenCalledWith({ userId: viewer.userId, workspaceId: viewer.workspaceId }, { key: 'message:conv-a' }, { allowedChannelIds: undefined, maxItems: 100 });
  });

  it('requires explicit draft confirmations and audits successful writes', async () => {
    const missing = await call('create_draft', { message: 'hello' });
    expect((await missing.json()).result.isError).toBe(true);
    expect(mutations.create).not.toHaveBeenCalled();

    const created = await call('create_draft', { message: ' hello ', confirmation: 'CREATE DRAFT' });
    expect((await created.json()).result.structuredContent).toEqual({ id: 'new-post', status: 'draft', mcpAuditRecorded: true });
    expect(mutations.create).toHaveBeenCalledWith(viewer, 'hello');
    expect(db.$executeRaw).toHaveBeenCalled();

    const deleted = await call('delete_draft', { postId: 'post-a', confirmation: 'DELETE DRAFT post-a' });
    expect((await deleted.json()).result.structuredContent).toEqual({ id: 'post-a', deleted: true, mcpAuditRecorded: true });
    expect(mutations.remove).toHaveBeenCalledWith(viewer, 'post-a');
  });

  it('blocks MCP writes before a mutation while workspace deletion is pending', async () => {
    purgeGuard.mockRejectedValueOnce(new OperationError('conflict', 'Workspace data deletion is in progress.'));
    const response = await call('publish_post', { postId: 'post-a', confirmation: 'PUBLISH POST post-a' });
    expect((await response.json()).result).toMatchObject({ isError: true, structuredContent: { error: 'Workspace data deletion is in progress.' } });
    expect(publishingMutations.publish).not.toHaveBeenCalled();
  });

  it('uses the existing selection mutation and prevents non-admin selection changes', async () => {
    const response = await call('set_connection_selection', { kind: 'target', id: 'page-a', enabled: false, confirmation: 'SET CONNECTION target page-a DISABLED' });
    expect((await response.json()).result.structuredContent).toEqual({ kind: 'target', id: 'page-a', enabled: false, mcpAuditRecorded: true });
    expect(mutations.select).toHaveBeenCalledWith(viewer, [{ kind: 'target', id: 'page-a', enabled: false }]);

    const editor = { ...viewer, role: 'editor' };
    const denied = await handleMcpMessage(editor, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'set_connection_selection', arguments: { kind: 'target', id: 'page-a', enabled: false, confirmation: 'SET CONNECTION target page-a DISABLED' } } });
    expect((await denied.json()).result.isError).toBe(true);
    expect(mutations.select).toHaveBeenCalledTimes(1);
  });

  it('requires item-specific confirmation for remote inbox replies and moderation', async () => {
    const denied = await call('reply_to_inbox', { kind: 'message', id: 'conv-a', text: 'hello' });
    expect((await denied.json()).result.isError).toBe(true);
    expect(inboxMutations.reply).not.toHaveBeenCalled();

    const sent = await call('reply_to_inbox', { kind: 'message', id: 'conv-a', text: 'hello', confirmation: 'REPLY message conv-a' });
    expect((await sent.json()).result.structuredContent).toMatchObject({ ok: true, kind: 'message', itemId: 'conv-a' });
    expect(inboxMutations.reply).toHaveBeenCalledWith(viewer, { kind: 'message', id: 'conv-a', text: 'hello' });
    expect(db.$executeRaw).toHaveBeenCalled();

    const moderate = await call('moderate_inbox_comment', { id: 'comment-a', hidden: true, confirmation: 'HIDE COMMENT comment-a' });
    expect((await moderate.json()).result.structuredContent).toMatchObject({ ok: true, itemId: 'comment-a', hidden: true });
    expect(inboxMutations.moderate).toHaveBeenCalledWith(viewer, { id: 'comment-a', hidden: true });
  });

  it('applies Inbox write permission to discovery and resolution calls', async () => {
    const client = { ...viewer, role: 'client', permissions: resolvePermissions({ role: 'client', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: ['inbox'], allPages: true, pageAccess: [] }) };
    const listed = await handleMcpMessage(client, { jsonrpc: '2.0', id: 8, method: 'tools/list' });
    const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list_inbox');
    expect(names).not.toContain('reply_to_inbox');
    expect(names).not.toContain('set_inbox_resolved');

    const denied = await handleMcpMessage(client, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'set_inbox_resolved', arguments: { kind: 'comment', id: 'comment-a', resolved: true, confirmation: 'RESOLVE comment comment-a' } } });
    expect((await denied.json()).result.isError).toBe(true);
    expect(inboxMutations.resolve).not.toHaveBeenCalled();
  });

  it('routes scoped deletion status through the read service and rejects extra arguments', async () => {
    const scoped = { ...viewer, role: 'editor', apiKeyId: 'narrow-key', permissions: resolvePermissions({ role: 'editor', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-a' }] }) };
    const read = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_inbox_deletion', arguments: { itemId: 'comment-a' } } });
    expect((await read.json()).result.structuredContent).toEqual({ operation: null });
    expect(inboxDeletions.get).toHaveBeenCalledWith(scoped, { itemId: 'comment-a' }, { allowedChannelIds: ['page-a'] });

    const invalid = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_inbox_deletion', arguments: { itemId: 'comment-a', remoteId: 'provider-private' } } });
    expect((await invalid.json()).result.structuredContent.code).toBe('invalid_request');
    expect(inboxDeletions.get).toHaveBeenCalledTimes(1);
  });

  it('requires exact deletion confirmation, forwards current channel scope, and preserves opaque uncertain receipts on audit failure', async () => {
    const scoped = { ...viewer, role: 'editor', apiKeyId: 'narrow-key', permissions: resolvePermissions({ role: 'editor', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-a' }] }) };
    const invalid = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_inbox_comment', arguments: { id: 'comment-a', confirmation: 'DELETE COMMENT another-item' } } });
    expect((await invalid.json()).result.structuredContent.code).toBe('invalid_request');
    expect(inboxDeletions.remove).not.toHaveBeenCalled();

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      db.$executeRaw.mockRejectedValueOnce(new Error('postgres://private-password@db'));
      const response = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delete_inbox_comment', arguments: { id: 'comment-a', confirmation: 'DELETE COMMENT comment-a' } } });
      const result = (await response.json()).result;
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ ok: true, operationId: 'opaque-operation-1', itemId: 'comment-a', state: 'uncertain', remoteConfirmed: false, localConfirmed: false, mcpAuditRecorded: false });
      expect(result.structuredContent.warning).toMatch(/Do not repeat/i);
      expect(JSON.stringify([result, log.mock.calls])).not.toContain('private-password');
      expect(JSON.stringify(result)).not.toMatch(/remoteId|provider|accessToken|message/);
      expect(inboxDeletions.remove).toHaveBeenCalledTimes(1);
      expect(inboxDeletions.remove).toHaveBeenCalledWith(scoped, { id: 'comment-a', confirmation: 'DELETE COMMENT comment-a' }, { allowedChannelIds: ['page-a'] });
      expect(workspaceGuard).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('denies read-only Inbox API keys and rejects unknown deletion arguments before service calls', async () => {
    const client = { ...viewer, role: 'client', apiKeyId: 'read-only-key', permissions: resolvePermissions({ role: 'client', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: ['inbox'], allPages: false, pageAccess: [{ targetId: 'page-a' }] }) };
    const denied = await handleMcpMessage(client, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_inbox_comment', arguments: { id: 'comment-a', confirmation: 'DELETE COMMENT comment-a' } } });
    expect((await denied.json()).result.structuredContent.code).toBe('forbidden');
    expect(inboxDeletions.remove).not.toHaveBeenCalled();

    const invalidDelete = await call('delete_inbox_comment', { id: 'comment-a', confirmation: 'DELETE COMMENT comment-a', extra: true });
    expect((await invalidDelete.json()).result.structuredContent.code).toBe('invalid_request');
    const invalidFinish = await call('finish_inbox_deletion', { operationId: 'opaque-operation-1', confirmation: 'FINISH DELETION opaque-operation-1', remoteId: 'x' });
    expect((await invalidFinish.json()).result.structuredContent.code).toBe('invalid_request');
    expect(inboxDeletions.remove).not.toHaveBeenCalled();
    expect(inboxDeletions.finish).not.toHaveBeenCalled();
  });

  it('routes exact deletion recovery once through the service without a generic workspace guard', async () => {
    const response = await call('finish_inbox_deletion', { operationId: 'opaque-operation-1', confirmation: 'FINISH DELETION opaque-operation-1' });
    const result = (await response.json()).result;
    expect(result.structuredContent).toMatchObject({ ok: true, operationId: 'opaque-operation-1', state: 'remote_confirmed', remoteConfirmed: true, localConfirmed: false, mcpAuditRecorded: true });
    expect(inboxDeletions.finish).toHaveBeenCalledTimes(1);
    expect(inboxDeletions.finish).toHaveBeenCalledWith(viewer, { operationId: 'opaque-operation-1', confirmation: 'FINISH DELETION opaque-operation-1' }, { allowedChannelIds: undefined });
    expect(workspaceGuard).not.toHaveBeenCalled();
  });

  it('passes narrowed channel scope to local workflow and leaves exactly one service-owned workspace guard', async () => {
    const scoped = { ...viewer, role: 'editor', apiKeyId: 'scoped-key', permissions: resolvePermissions({ role: 'editor', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-a' }] }) };
    inboxMutations.resolve.mockImplementation(async () => workspaceGuard('workspace-a', async () => ({ ok: true, resolved: true })));
    const response = await handleMcpMessage(scoped, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'set_inbox_resolved', arguments: { kind: 'comment', id: 'comment-a', resolved: true, confirmation: 'RESOLVE comment comment-a' } } });
    expect((await response.json()).result.structuredContent).toMatchObject({ ok: true, resolved: true });
    expect(inboxMutations.resolve).toHaveBeenCalledWith(scoped, { kind: 'comment', id: 'comment-a', resolved: true }, { allowedChannelIds: ['page-a'] });
    expect(workspaceGuard).toHaveBeenCalledTimes(1);
  });

  it('requires exact post-specific confirmations for publishing, status sync and deletion', async () => {
    const missing = await call('publish_post', { postId: 'post-a' });
    expect((await missing.json()).result.isError).toBe(true);
    expect(publishingMutations.publish).not.toHaveBeenCalled();

    const publish = await call('publish_post', { postId: 'post-a', confirmation: 'PUBLISH POST post-a' });
    expect((await publish.json()).result.structuredContent).toMatchObject({ postId: 'post-a', published: 1 });
    expect(publishingMutations.publish).toHaveBeenCalledWith(viewer, 'post-a');

    const status = await call('sync_post_status', { postId: 'post-a', confirmation: 'SYNC POST STATUS post-a' });
    expect((await status.json()).result.structuredContent).toMatchObject({ postId: 'post-a', synced: 1 });
    expect(publishingMutations.sync).toHaveBeenCalledWith(viewer, 'post-a');

    const badDelete = await call('delete_post', { postId: 'post-a', deleteRemote: true, confirmation: 'DELETE POST post-a LOCAL' });
    expect((await badDelete.json()).result.isError).toBe(true);
    expect(publishingMutations.remove).not.toHaveBeenCalled();

    publishingMutations.remove.mockResolvedValueOnce({ ok: true, postId: 'post-a', localConfirmed: false, remoteDeletionRequested: true, state: 'needs_review', operations: [{ operationId: 'operation-1', targetId: 'target-a', targetName: 'Studio', state: 'uncertain', remoteConfirmed: false, localConfirmed: false }] });
    const remoteDelete = await call('delete_post', { postId: 'post-a', deleteRemote: true, confirmation: 'DELETE POST post-a REMOTE' });
    expect((await remoteDelete.json()).result.structuredContent).toMatchObject({ postId: 'post-a', ok: true, localConfirmed: false, remoteDeletionRequested: true, state: 'needs_review', operations: [{ state: 'uncertain' }] });
    expect(publishingMutations.remove).toHaveBeenCalledWith(viewer, 'post-a', true);
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it('exposes durable post deletion status and recovery with explicit external confirmation', async () => {
    const listed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('get_post_deletion_status');
    expect(names).toContain('finish_post_deletion');
    expect(names).toContain('record_post_deletion_outcome');

    const status = await call('get_post_deletion_status', { postId: 'post-a' });
    expect((await status.json()).result.structuredContent).toMatchObject({ postId: 'post-a', state: 'needs_review' });
    expect(postDeletions.get).toHaveBeenCalledWith(viewer, { postId: 'post-a' });

    const bad = await call('record_post_deletion_outcome', { postId: 'post-a', operationId: 'operation-1', outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'RECORD POST DELETION operation-1 NOT DELETED' });
    expect((await bad.json()).result.isError).toBe(true);
    expect(postDeletions.record).not.toHaveBeenCalled();
    const recorded = await call('record_post_deletion_outcome', { postId: 'post-a', operationId: 'operation-1', outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'RECORD POST DELETION operation-1 DELETED' });
    expect((await recorded.json()).result.structuredContent).toMatchObject({ state: 'local_pending', localConfirmed: false });
    expect(postDeletions.record).toHaveBeenCalledWith(viewer, { postId: 'post-a', operationId: 'operation-1', outcome: 'deleted', confirmation: 'RECORD POST DELETION operation-1 DELETED', verifiedOnPlatform: true });

    const finished = await call('finish_post_deletion', { postId: 'post-a', confirmation: 'FINISH POST DELETION post-a' });
    expect((await finished.json()).result.structuredContent).toMatchObject({ state: 'completed', localConfirmed: true });
    expect(postDeletions.finish).toHaveBeenCalledWith(viewer, { postId: 'post-a', confirmation: 'FINISH POST DELETION post-a' });
  });

  it('exposes scoped first-comment send and manual outcome tools with exact confirmations', async () => {
    const listed = await handleMcpMessage(viewer, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('send_first_comment');
    expect(names).toContain('record_first_comment_outcome');

    const denied = await call('send_first_comment', { postId: 'post-a', postTargetId: 'post-target-a', confirmation: 'SEND FIRST COMMENT wrong' });
    expect((await denied.json()).result.isError).toBe(true);
    expect(firstCommentMutations.send).not.toHaveBeenCalled();

    const sent = await call('send_first_comment', { postId: 'post-a', postTargetId: 'post-target-a', confirmation: 'SEND FIRST COMMENT post-target-a' });
    expect((await sent.json()).result.structuredContent).toMatchObject({ ok: true, state: 'sent', mcpAuditRecorded: true });
    expect(firstCommentMutations.send).toHaveBeenCalledWith(viewer, { postId: 'post-a', postTargetId: 'post-target-a' });

    const notSent = await call('record_first_comment_outcome', { postId: 'post-a', postTargetId: 'post-target-a', outcome: 'not_sent', confirmation: 'RECORD FIRST COMMENT post-target-a NOT SENT' });
    expect((await notSent.json()).result.structuredContent).toMatchObject({ ok: true, state: 'ready' });
    expect(firstCommentMutations.record).toHaveBeenCalledWith(viewer, { postId: 'post-a', postTargetId: 'post-target-a', outcome: 'not_sent', confirmation: 'RECORD FIRST COMMENT post-target-a NOT SENT' });
    expect(workspaceGuard).not.toHaveBeenCalled();
  });

  it('normalizes first-comment state in list_posts and never returns stored error text', async () => {
    publishingReads.list.mockResolvedValueOnce([{ id: 'post-a', message: 'Saved post', firstComment: 'Details below', status: 'published', targets: [{ id: 'post-target-a', status: 'published', remotePostId: 'remote-post-a', remoteUrl: null, firstCommentId: null, firstCommentAt: new Date('2026-10-16T12:00:00.000Z'), firstCommentError: 'review_required', target: { id: 'target-a', type: 'page', name: 'Studio' } }] }]);
    const response = await call('list_posts');
    const post = (await response.json()).result.structuredContent.items[0];
    expect(post.targets[0]).toMatchObject({ id: 'post-target-a', firstComment: { state: 'needs_review', label: 'First comment needs review', errorPresent: true } });
    expect(JSON.stringify(post)).not.toContain('private provider error');
  });

  it('confirms configured post creation and scheduling, with workspace actor passed to lifecycle', async () => {
    const denied = await call('create_post', { message: 'hello', targetIds: ['page-a'] });
    expect((await denied.json()).result.isError).toBe(true);
    expect(publishingMutations.create).not.toHaveBeenCalled();

    const created = await call('create_post', { message: 'hello', firstComment: 'follow-up', targetIds: ['page-a'], imageUrl: 'https://example.com/photo.jpg', confirmation: 'CREATE POST' });
    expect((await created.json()).result.structuredContent).toEqual({ id: 'new-post', status: 'draft', mcpAuditRecorded: true });
    expect(publishingMutations.create).toHaveBeenCalledWith(viewer, expect.objectContaining({ targetIds: ['page-a'], firstComment: 'follow-up', media: [{ kind: 'image', url: 'https://example.com/photo.jpg' }] }));

    const time = '2030-01-02T12:00:00.000Z';
    const scheduled = await call('schedule_post', { postId: 'new-post', scheduledAt: time, confirmation: `SCHEDULE POST new-post ${time}` });
    expect((await scheduled.json()).result.structuredContent).toMatchObject({ postId: 'new-post', status: 'scheduled' });
    expect(publishingMutations.schedule).toHaveBeenCalledWith(viewer, 'new-post', new Date(time));
    const updated = await call('update_post', { postId: 'new-post', message: 'edited', targetIds: ['page-a'], confirmation: 'UPDATE POST new-post' });
    expect((await updated.json()).result.structuredContent).toEqual({ postId: 'new-post', updated: true, mcpAuditRecorded: true });
    expect(publishingMutations.update).toHaveBeenCalledWith(viewer, expect.objectContaining({ postId: 'new-post', targetIds: ['page-a'] }));
    expect(db.$executeRaw).toHaveBeenCalled();
  });

  it('offers Root configuration only to the signed-in instance owner and never returns secret values', async () => {
    const root = { ...viewer, isInstanceOwner: true };
    const listed = await handleMcpMessage(root, { jsonrpc: '2.0', id: 10, method: 'tools/list' });
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('set_root_config');
    const read = await handleMcpMessage(root, { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_root_config', arguments: {} } });
    expect((await read.json()).result.structuredContent.values).toEqual([{ key: 'meta.appSecret', value: '', isSet: true, source: 'database' }]);

    const denied = await handleMcpMessage({ ...viewer, role: 'admin' }, { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'get_root_config', arguments: {} } });
    expect((await denied.json()).result.isError).toBe(true);
    const bearer = await handleMcpMessage({ ...root, apiKeyId: 'key-1' }, { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'get_root_config', arguments: {} } });
    expect((await bearer.json()).result.isError).toBe(true);
  });

  it('requires an exact Root confirmation and reuses registry validation and audit', async () => {
    const root = { ...viewer, isInstanceOwner: true };
    const missing = await handleMcpMessage(root, { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'set_root_config', arguments: { key: 'mcp.enabled', value: false } } });
    expect((await missing.json()).result.isError).toBe(true);
    expect(rootConfig.save).not.toHaveBeenCalled();
    const saved = await handleMcpMessage(root, { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'set_root_config', arguments: { key: 'mcp.enabled', value: false, confirmation: 'SET ROOT CONFIG mcp.enabled' } } });
    expect((await saved.json()).result.structuredContent).toMatchObject({ key: 'mcp.enabled', saved: true });
    expect(rootConfig.save).toHaveBeenCalledWith({ key: 'mcp.enabled', value: false, clear: false }, 'user-a');
    expect(db.$executeRaw).not.toHaveBeenCalled(); // Domain service owns its atomic audit.
  });
});
