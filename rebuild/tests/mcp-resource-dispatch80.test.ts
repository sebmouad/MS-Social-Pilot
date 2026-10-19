import { beforeEach, describe, expect, it, vi } from 'vitest';
const purgeGuard = vi.hoisted(() => vi.fn());
const workspaceGuard = vi.hoisted(() => vi.fn());
vi.mock('../src/server/platforms/registry', () => ({ inboxPlatformIds: async () => ['facebook'], enabledSocialAccountWhere: async (allowedProviders?: readonly string[]) => ({ provider: { in: allowedProviders === undefined ? ['facebook'] : ['facebook'].filter(id => allowedProviders.includes(id)) } }), platformAds: vi.fn(async () => ({ ui: { campaign: { options: [{ value: 'OUTCOME_TRAFFIC', label: 'Traffic' }], defaultOption: 'OUTCOME_TRAFFIC', confirmationTemplate: 'CREATE PAUSED FACEBOOK CAMPAIGN {nameJson} IN ACCOUNT {adAccountId} WITH OBJECTIVE {objective}' }, adSet: { options: [{ value: 'LINK_CLICKS', label: 'Link clicks' }, { value: 'IMPRESSIONS', label: 'Impressions' }], defaultOption: 'LINK_CLICKS', confirmationTemplate: 'CREATE PAUSED FACEBOOK AD SET {nameJson} UNDER CAMPAIGN {campaignId} IN ACCOUNT {adAccountId} WITH DAILY BUDGET {dailyBudgetMinor} MINOR UNITS TARGETING {countryCode} OPTIMIZED FOR {optimizationGoal}' } }, adSetConfirmation: (input: { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) => `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(input.name)} UNDER CAMPAIGN ${input.campaignId} IN ACCOUNT ${input.adAccountId} WITH DAILY BUDGET ${input.dailyBudgetMinor} MINOR UNITS TARGETING ${input.countryCode} OPTIMIZED FOR ${input.optimizationGoal}` })) }));
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
const rootConfig = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), adsPolicy: { presets: [{ id: '14d', days: 14, label: 'Last fortnight' }], defaultPreset: '14d', maxRangeDays: 14, maxFilterCharacters: 200 } }));
const rootWorkspaces = vi.hoisted(() => ({ list: vi.fn(), change: vi.fn() }));
const rootActivity = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/server/root/activity', () => ({ listRootActivity: rootActivity.list }));
vi.mock('../src/server/root/directory', () => ({ listRootWorkspaces: rootWorkspaces.list }));
vi.mock('../src/server/root/workspace-access', () => ({ setRootWorkspaceAccess: rootWorkspaces.change }));
vi.mock('../src/server/config/store', () => ({ readConfig: rootConfig.read, saveConfig: rootConfig.save, runtimeConfig: vi.fn(async (key: string) => key === 'ads.reportingFilters' ? rootConfig.adsPolicy : key === 'mcp.maxResultItems' ? 100 : key === 'root.directoryPageSize' ? 25 : 366) }));
const notificationService = vi.hoisted(() => ({
  readNotificationPreferences: vi.fn(), updateNotificationPreferences: vi.fn(), listNotifications: vi.fn(),
  markNotificationRead: vi.fn(), deleteNotification: vi.fn(),
}));
vi.mock('../src/modules/settings/notifications/server', () => notificationService);
const analytics = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('../src/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: analytics.snapshot }));
const adsQueries = vi.hoisted(() => ({ accounts: vi.fn(), dataset: vi.fn() }));
const adsReports = vi.hoisted(() => ({ rows: vi.fn(), export: vi.fn() }));
vi.mock('../src/modules/ads/server/report-read', () => ({ readAdsDailyRows: adsReports.rows }));
vi.mock('../src/modules/ads/server/export', () => ({ exportAdsReport: adsReports.export }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: adsQueries.accounts, getAdsDataset: adsQueries.dataset, getAdsAccountWhere: async (workspaceId: string, allowedTargetIds?: string[]) => ({ workspaceId, enabled: true, socialAccount: { is: { workspaceId, invalidatedAt: null, provider: { in: ['facebook'] } } }, ...(allowedTargetIds === undefined ? {} : { socialAccountId: { in: ['social-a'] } }) }) }));
const dataControls = vi.hoisted(() => ({ preview: vi.fn(), export: vi.fn(), remove: vi.fn() }));
vi.mock('../src/server/data-control', () => ({ previewWorkspaceDataDeletion: dataControls.preview, exportWorkspaceData: dataControls.export, deleteWorkspaceData: dataControls.remove }));
const inboxReads = vi.hoisted(() => ({ list: vi.fn(), thread: vi.fn() }));
vi.mock('../src/modules/inbox/server/read', () => ({ readInboxList: inboxReads.list, readInboxThread: inboxReads.thread }));
const publishingReads = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/modules/publishing/server/read', () => ({ readPublishingPostList: publishingReads.list }));
const postExport = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/publishing/server/export', () => ({ exportPublishingPosts: postExport }));
const inboxMutations = vi.hoisted(() => ({ reply: vi.fn(), resolve: vi.fn(), moderate: vi.fn() }));
vi.mock('@/modules/inbox/server/actions', () => ({ replyToInbox: inboxMutations.reply, setInboxResolved: inboxMutations.resolve, moderateInboxComment: inboxMutations.moderate }));
const inboxDeletions = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn(), finish: vi.fn() }));
vi.mock('../src/modules/inbox/server/deletion', () => ({ getInboxDeletion: inboxDeletions.get, deleteInboxCommentDurably: inboxDeletions.remove, finishInboxDeletion: inboxDeletions.finish }));
const adsMutations = vi.hoisted(() => ({ create: vi.fn(), createAdSet: vi.fn(), update: vi.fn(), read: vi.fn() }));
vi.mock('@/modules/ads/server/actions', () => ({
  createWorkspaceAdCampaign: adsMutations.create,
  createWorkspaceAdSet: adsMutations.createAdSet,
  updateWorkspaceAd: adsMutations.update,
  readWorkspaceAdObject: adsMutations.read,
  canManageWorkspaceAds: vi.fn().mockResolvedValue(true),
  campaignCreationConfirmation: (_workspaceId: string, adAccountId: string, name: string, objective: string) => `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(name.trim())} IN ACCOUNT ${adAccountId} WITH OBJECTIVE ${objective}`,
}));
const destinationReadiness = vi.hoisted(() => vi.fn());
vi.mock('@/modules/publishing/server/destinations', () => ({ publishingTargetChoices: destinationReadiness }));
const publishingMutations = vi.hoisted(() => ({ publish: vi.fn(), sync: vi.fn(), remove: vi.fn(), create: vi.fn(), update: vi.fn(), submit: vi.fn(), review: vi.fn(), schedule: vi.fn(), cancel: vi.fn() }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ publishPost: publishingMutations.publish, syncPostStatus: publishingMutations.sync, deletePost: publishingMutations.remove, createPost: publishingMutations.create, updatePost: publishingMutations.update, submitPostForApproval: publishingMutations.submit, reviewPost: publishingMutations.review, schedulePost: publishingMutations.schedule, cancelScheduledPost: publishingMutations.cancel }));
const postDuplicate = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/publishing/server/duplicate', () => ({ duplicatePost: postDuplicate }));
const firstCommentMutations = vi.hoisted(() => ({ send: vi.fn(), record: vi.fn() }));
vi.mock('../src/modules/publishing/server/first-comment', () => ({ sendFirstComment: firstCommentMutations.send, recordFirstCommentOutcome: firstCommentMutations.record }));
const postDeletions = vi.hoisted(() => ({ get: vi.fn(), finish: vi.fn(), record: vi.fn() }));
vi.mock('../src/modules/publishing/server/deletion', () => ({ getPostDeletion: postDeletions.get, finishPostDeletion: postDeletions.finish, recordPostDeletionOutcome: postDeletions.record }));
const publicationRecovery = vi.hoisted(() => ({ get: vi.fn(), record: vi.fn(), finish: vi.fn(), adopt: vi.fn() }));
vi.mock('../src/modules/publishing/server/publication', () => ({ getPublicationStatus: publicationRecovery.get, recordPublicationOutcome: publicationRecovery.record, finishPublicationProjection: publicationRecovery.finish, adoptLegacyPublication: publicationRecovery.adopt }));
const media = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), remove: vi.fn(), upload: vi.fn() }));
vi.mock('@/modules/publishing/server/media/storage', () => ({ listWorkspaceImages: media.list, getWorkspaceImageMetadata: media.get, deleteUnusedWorkspaceImage: media.remove, uploadWorkspaceImage: media.upload }));

import { handleMcpMessage, type McpViewer } from '../src/server/mcp/server';
import { resolvePermissions } from '../src/server/permissions';
import { classifyTool } from '../src/modules/settings/mcp-access/tool-policy';
import { rootTools } from '../src/server/mcp/root-tools';

const features = Object.fromEntries(['publishing/posts', 'publishing/collaboration', 'publishing/labels', 'publishing/templates', 'publishing/calendar', 'publishing/queue', 'publishing/approvals', 'publishing/media', 'inbox/conversations', 'analytics/explorer', 'analytics/overview', 'analytics/demographics', 'analytics/pins', 'analytics/compare', 'ads/compare', 'ads/objects', 'ads/campaigns', 'tasks/board', 'settings/connections', 'settings/team', 'settings/workspace', 'settings/sharing', 'settings/bio', 'settings/notifications', 'settings/data'].map(id => [id, true]));
const entitlements = { workspaceId: 'workspace-a', modules: { publishing: true, inbox: true, analytics: true, ads: true, tasks: true, settings: true }, features, platformCapabilities: { facebook: true } };
const permissionsFor = (allPages: boolean) => resolvePermissions({ role: 'admin', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages, pageAccess: allPages ? [] : [{ targetId: 'page-allowed' }] });
const base = { scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role: 'admin', workspace: { id: 'workspace-a', name: 'Alpha', timezone: 'UTC' }, entitlements } as unknown as McpViewer;
const restricted: McpViewer = { ...base, apiKeyId: 'key-a', permissions: { ...permissionsFor(false), pageScope: { all: false, ids: ['page-allowed'] } } };
const unrestricted: McpViewer = { ...base, apiKeyId: 'key-b', permissions: permissionsFor(true) };
const rpc = async (who: McpViewer, method: string, params: Record<string, unknown> = {}) => (await handleMcpMessage(who, { jsonrpc: '2.0', id: 1, method, params })).json();
const listed = async (who: McpViewer) => ((await rpc(who, 'tools/list')).result.tools as Array<{ name: string }>).map(tool => tool.name);
const failure = (response: { result?: { isError?: boolean; structuredContent?: { code?: string } } }) => response.result?.isError ? response.result.structuredContent?.code : undefined;

beforeEach(() => {
  vi.clearAllMocks();
  workspaceGuard.mockImplementation((_id: string, run: () => Promise<unknown>) => run());
  db.$executeRaw.mockResolvedValue(1);
  destinationReadiness.mockResolvedValue([]);
  publishingReads.list.mockResolvedValue([]);
  inboxReads.list.mockResolvedValue({ channels: [], items: [], total: 0, olderCursor: null, newerCursor: null });
  for (const mock of Object.values(publishingMutations)) mock.mockResolvedValue({ id: 'post-a' });
  inboxMutations.reply.mockResolvedValue({ ok: true });
  inboxMutations.moderate.mockResolvedValue({ ok: true });
  firstCommentMutations.send.mockResolvedValue({ state: 'sent' });
  firstCommentMutations.record.mockResolvedValue({ state: 'ready' });
  postDeletions.get.mockResolvedValue({ state: 'completed' });
  postDeletions.finish.mockResolvedValue({ state: 'completed' });
  postDeletions.record.mockResolvedValue({ state: 'completed' });
  publicationRecovery.get.mockResolvedValue({ state: 'ok' });
  publicationRecovery.record.mockResolvedValue({ state: 'ok' });
  publicationRecovery.finish.mockResolvedValue({ state: 'ok' });
  publicationRecovery.adopt.mockResolvedValue({ state: 'ok' });
  postDuplicate.mockResolvedValue({ sourcePostId: 'post-a', postId: 'post-b', replayed: false });
  mutations.create.mockResolvedValue({ id: 'draft' });
});

describe('MCP resource-scope policy', () => {
  it('classifies every current workspace tool, so a new unreviewed tool cannot silently become scoped', async () => {
    const names = (await listed(unrestricted)).filter(name => !rootTools.has(name));
    expect(names.length).toBeGreaterThan(60);
    expect(names.filter(name => classifyTool(name) === 'unclassified')).toEqual([]);
  });

  it('lists only reviewed resource-safe tools to a restricted viewer', async () => {
    const names = await listed(restricted);
    expect(names).toEqual(expect.arrayContaining(['list_posts', 'publish_post', 'list_inbox', 'reply_to_inbox', 'get_analytics_overview', 'list_share_links', 'assign_inbox_item']));
    expect(names.filter(name => classifyTool(name) !== 'resource')).toEqual([]);
    for (const hidden of ['create_draft', 'upload_workspace_image', 'list_post_templates', 'list_post_labels', 'list_custom_fields', 'list_queue_times', 'get_content_mix', 'list_workspace_team', 'get_workspace_policies', 'list_notifications', 'list_inbox_saved_replies', 'export_workspace_data', 'set_connection_selection', 'get_bio_page', 'save_bio_page']) {
      expect(names).not.toContain(hidden);
    }
    const all = await listed(unrestricted);
    for (const present of ['create_draft', 'list_post_templates', 'get_bio_page', 'list_inbox_saved_replies']) expect(all).toContain(present);
  });

  it('refuses hidden workspace-wide tools on direct call before any service or write lock', async () => {
    const attempts: Array<[string, Record<string, unknown>]> = [
      ['create_draft', { message: 'x', confirmation: 'CREATE DRAFT' }],
      ['update_draft', { postId: 'p', message: 'x', confirmation: 'UPDATE DRAFT p' }],
      ['delete_draft', { postId: 'p', confirmation: 'DELETE DRAFT p' }],
      ['upload_workspace_image', { fileName: 'a.png', mimeType: 'image/png', base64: 'AAAA', confirmation: 'UPLOAD WORKSPACE IMAGE a.png' }],
      ['list_workspace_images', {}],
      ['list_tasks', {}],
      ['list_post_templates', {}],
      ['list_custom_fields', {}],
      ['list_notifications', {}],
      ['list_inbox_saved_replies', {}],
      ['create_inbox_saved_reply', { name: 'n', body: 'b', confirmation: 'CREATE SAVED REPLY n' }],
      ['export_workspace_data', {}],
      ['preview_workspace_data_deletion', {}],
      ['set_connection_selection', { kind: 'target', id: 'page-allowed', enabled: false, confirmation: 'SET CONNECTION target page-allowed DISABLED' }],
      ['get_bio_page', {}],
      ...[...rootTools].map((name): [string, Record<string, unknown>] => [name, {}]),
    ];
    for (const [name, args] of attempts) {
      const response = await rpc(restricted, 'tools/call', { name, arguments: args });
      expect(failure(response), name).toBe('forbidden');
    }
    expect(workspaceGuard).not.toHaveBeenCalled();
    expect(mutations.create).not.toHaveBeenCalled();
    expect(media.list).not.toHaveBeenCalled();
    expect(media.upload).not.toHaveBeenCalled();
    expect(dataControls.export).not.toHaveBeenCalled();
    expect(dataControls.preview).not.toHaveBeenCalled();
    expect(mutations.select).not.toHaveBeenCalled();
    expect(adsMutations.createAdSet).not.toHaveBeenCalled();
    expect(notificationService.listNotifications).not.toHaveBeenCalled();
  });

  it('applies the same policy to resources/list and resources/read', async () => {
    const uris = ((await rpc(restricted, 'resources/list')).result.resources as Array<{ uri: string }>).map(resource => resource.uri);
    expect(uris).toEqual(expect.arrayContaining(['msp://workspace', 'msp://posts', 'msp://targets', 'msp://inbox', 'msp://analytics/overview']));
    for (const denied of ['msp://media/images', 'msp://settings/bio', 'msp://publishing/templates', 'msp://publishing/fields', 'msp://publishing/labels', 'msp://settings/team', 'msp://settings/policies', 'msp://notifications', 'msp://data/deletion-preview', 'msp://settings/invitations']) {
      expect(uris).not.toContain(denied);
      const read = await rpc(restricted, 'resources/read', { uri: denied });
      expect(read.error?.message, denied).toBe('Resource unavailable.');
    }
    expect((await rpc(restricted, 'resources/read', { uri: 'msp://future/unreviewed' })).error?.message).toBe('Resource unavailable.');
    expect(media.list).not.toHaveBeenCalled();
    expect(dataControls.preview).not.toHaveBeenCalled();
    const allUris = ((await rpc(unrestricted, 'resources/list')).result.resources as Array<{ uri: string }>).map(resource => resource.uri);
    for (const present of ['msp://media/images', 'msp://settings/bio', 'msp://data/deletion-preview']) expect(allUris).toContain(present);
    expect((await rpc(unrestricted, 'resources/read', { uri: 'msp://future/unreviewed' })).error?.message).toMatch(/Unknown resource/);
  });

  it('serves scoped resources with the ceiling attached', async () => {
    const read = await rpc(restricted, 'resources/read', { uri: 'msp://posts' });
    expect(read.error).toBeUndefined();
    expect(publishingReads.list.mock.calls[0]![0]).toMatchObject({ allowedTargetIds: ['page-allowed'] });
    await rpc(restricted, 'resources/read', { uri: 'msp://inbox' });
    expect(inboxReads.list.mock.calls[0]![2]).toMatchObject({ allowedChannelIds: ['page-allowed'] });
  });
});

describe('Publishing operations carry the key ceiling in an explicit actor', () => {
  const ceilingActor = { userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['page-allowed'] };
  const openActor = { userId: 'user-a', workspaceId: 'workspace-a' };
  const cases: Array<[string, Record<string, unknown>, () => ReturnType<typeof vi.fn>]> = [
    ['publish_post', { postId: 'post-a', confirmation: 'PUBLISH POST post-a' }, () => publishingMutations.publish],
    ['sync_post_status', { postId: 'post-a', confirmation: 'SYNC POST STATUS post-a' }, () => publishingMutations.sync],
    ['delete_post', { postId: 'post-a', deleteRemote: false, confirmation: 'DELETE POST post-a LOCAL' }, () => publishingMutations.remove],
    ['create_post', { message: 'hello', targetIds: ['page-allowed'], confirmation: 'CREATE POST' }, () => publishingMutations.create],
    ['update_post', { postId: 'post-a', message: 'hello', targetIds: ['page-allowed'], confirmation: 'UPDATE POST post-a' }, () => publishingMutations.update],
    ['submit_post_for_approval', { postId: 'post-a', confirmation: 'SUBMIT POST post-a' }, () => publishingMutations.submit],
    ['review_post', { postId: 'post-a', decision: 'approve', confirmation: 'APPROVE POST post-a' }, () => publishingMutations.review],
    ['schedule_post', { postId: 'post-a', scheduledAt: '2030-01-01T10:00:00.000Z', confirmation: 'SCHEDULE POST post-a 2030-01-01T10:00:00.000Z' }, () => publishingMutations.schedule],
    ['cancel_scheduled_post', { postId: 'post-a', confirmation: 'CANCEL SCHEDULE post-a' }, () => publishingMutations.cancel],
    ['duplicate_post', { postId: 'post-a', requestId: '5a985a8a-8234-494c-a2f7-a269ea50d111', confirmation: 'DUPLICATE POST post-a' }, () => postDuplicate],
    ['send_first_comment', { postId: 'post-a', postTargetId: 'pt-a', confirmation: 'SEND FIRST COMMENT pt-a' }, () => firstCommentMutations.send],
    ['record_first_comment_outcome', { postId: 'post-a', postTargetId: 'pt-a', outcome: 'not_sent', confirmation: 'RECORD FIRST COMMENT pt-a NOT SENT' }, () => firstCommentMutations.record],
    ['get_post_deletion_status', { postId: 'post-a' }, () => postDeletions.get],
    ['finish_post_deletion', { postId: 'post-a', confirmation: 'FINISH POST DELETION post-a' }, () => postDeletions.finish],
    ['record_post_deletion_outcome', { postId: 'post-a', operationId: 'op-a', outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'RECORD POST DELETION op-a DELETED' }, () => postDeletions.record],
    ['get_publication_status', { postId: 'post-a' }, () => publicationRecovery.get],
    ['record_publication_outcome', { postId: 'post-a', operationId: 'op-a', outcome: 'ABSENT', verifiedExternally: true, confirmation: 'RECORD PUBLICATION op-a ABSENT' }, () => publicationRecovery.record],
    ['finish_publication_projection', { postId: 'post-a', operationId: 'op-a', confirmation: 'FINISH PUBLICATION op-a' }, () => publicationRecovery.finish],
    ['adopt_legacy_publication', { postId: 'post-a', postTargetId: 'pt-a', confirmation: 'ADOPT PUBLICATION pt-a' }, () => publicationRecovery.adopt],
  ];
  it.each(cases)('%s passes allowedTargetIds for a restricted key and none for an unrestricted one', async (name, args, service) => {
    const restrictedResponse = await rpc(restricted, 'tools/call', { name, arguments: args });
    expect(failure(restrictedResponse), name).toBeUndefined();
    expect(service()).toHaveBeenCalledTimes(1);
    expect(service().mock.calls[0]![0]).toEqual(ceilingActor);
    service().mockClear();
    const openResponse = await rpc(unrestricted, 'tools/call', { name, arguments: args });
    expect(failure(openResponse), name).toBeUndefined();
    expect(service().mock.calls[0]![0]).toEqual(openActor);
  });
});

describe('Inbox operations carry the key ceiling', () => {
  it('passes the channel ceiling to reply and moderation without widening an unrestricted key', async () => {
    await rpc(restricted, 'tools/call', { name: 'reply_to_inbox', arguments: { kind: 'comment', id: 'c1', text: 'Thanks', confirmation: 'REPLY comment c1' } });
    expect(inboxMutations.reply).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a', allowedChannelIds: ['page-allowed'] }, { kind: 'comment', id: 'c1', text: 'Thanks' }, { allowedChannelIds: ['page-allowed'] });
    await rpc(restricted, 'tools/call', { name: 'moderate_inbox_comment', arguments: { id: 'c1', hidden: true, confirmation: 'HIDE COMMENT c1' } });
    expect(inboxMutations.moderate).toHaveBeenCalledWith(expect.objectContaining({ allowedChannelIds: ['page-allowed'] }), { id: 'c1', hidden: true }, { allowedChannelIds: ['page-allowed'] });
    await rpc(unrestricted, 'tools/call', { name: 'reply_to_inbox', arguments: { kind: 'comment', id: 'c1', text: 'Thanks', confirmation: 'REPLY comment c1' } });
    expect(inboxMutations.reply.mock.calls[1]![0]).toEqual({ userId: 'user-a', workspaceId: 'workspace-a' });
    expect(inboxMutations.reply.mock.calls[1]![2]).toEqual({ allowedChannelIds: undefined });
  });
});
