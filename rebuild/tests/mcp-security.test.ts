import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  target: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  adAccount: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  socialAccount: { findFirst: vi.fn() },
  post: { findMany: vi.fn() },
  pageInsight: { findMany: vi.fn() },
  conversation: { findMany: vi.fn() },
  postComment: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  membership: { findUnique: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: db }));
const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), select: vi.fn() }));
vi.mock('../src/server/post-mutations', () => ({ createLocalDraft: mutations.create, updateLocalDraft: mutations.update, deleteLocalDraft: mutations.remove }));
vi.mock('../src/server/connection-mutations', () => ({ setConnectionSelections: mutations.select }));
const inboxMutations = vi.hoisted(() => ({ reply: vi.fn(), resolve: vi.fn(), moderate: vi.fn() }));
vi.mock('../src/server/inbox/actions', () => ({ replyToFacebookInbox: inboxMutations.reply, setFacebookInboxResolved: inboxMutations.resolve, moderateFacebookComment: inboxMutations.moderate }));
const publishingMutations = vi.hoisted(() => ({ publish: vi.fn(), sync: vi.fn(), remove: vi.fn() }));
vi.mock('../src/server/publishing/lifecycle', () => ({ publishPost: publishingMutations.publish, syncPostStatus: publishingMutations.sync, deletePost: publishingMutations.remove }));

import { handleMcpMessage, type McpViewer } from '../src/server/mcp/server';
import { resolvePermissions } from '../src/server/permissions';

const viewer: McpViewer = {
  userId: 'user-a', workspaceId: 'workspace-a', role: 'owner',
  workspace: { id: 'workspace-a', name: 'Alpha', timezone: 'UTC' },
  entitlements: {
    workspaceId: 'workspace-a',
    modules: { home: true, publishing: true, inbox: true, analytics: true, ads: true, settings: true },
    features: { 'home/overview': true, 'publishing/posts': true, 'publishing/calendar': true, 'publishing/queue': true, 'publishing/approvals': true, 'inbox/conversations': true, 'analytics/overview': true, 'ads/overview': true, 'ads/campaigns': true, 'settings/connections': true, 'settings/team': true, 'settings/mcp': true, 'settings/account': true, 'settings/appearance': true, 'settings/data': true },
    platformCapabilities: {},
  },
  permissions: resolvePermissions({ role: 'owner', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }),
};
const call = (name: string, args: Record<string, unknown> = {}) => handleMcpMessage(viewer, {
  jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$executeRaw.mockResolvedValue(1);
  mutations.create.mockResolvedValue({ id: 'new-post' });
  mutations.update.mockResolvedValue(undefined);
  mutations.remove.mockResolvedValue(undefined);
  mutations.select.mockResolvedValue(undefined);
  inboxMutations.reply.mockResolvedValue({ ok: true });
  inboxMutations.resolve.mockResolvedValue({ ok: true });
  inboxMutations.moderate.mockResolvedValue({ ok: true });
  publishingMutations.publish.mockResolvedValue({ published: 1, failed: 0, needsReconciliation: 0 });
  publishingMutations.sync.mockResolvedValue({ synced: 1 });
  publishingMutations.remove.mockResolvedValue(undefined);
});

describe('MCP workspace boundaries', () => {
  it('scopes destination and post queries to the authenticated workspace and clamps limits', async () => {
    db.target.findMany.mockResolvedValue([]);
    db.post.findMany.mockResolvedValue([]);
    await call('list_pages');
    await call('list_posts', { limit: 900 });
    expect(db.target.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'workspace-a', enabled: true });
    expect(db.post.findMany.mock.calls[0][0]).toMatchObject({ where: { workspaceId: 'workspace-a' }, take: 100 });
  });

  it('checks page ownership before reading analytics and constrains insight lookup to the requested page', async () => {
    db.target.findFirst.mockResolvedValue(null);
    const response = await call('get_page_analytics', { pageId: 'other-workspace-page' });
    const payload = await response.json();
    expect(payload.result.isError).toBe(true);
    expect(db.target.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-workspace-page', workspaceId: 'workspace-a', type: 'page' }, select: { id: true, name: true },
    });
    expect(db.pageInsight.findMany).not.toHaveBeenCalled();

    db.target.findFirst.mockResolvedValue({ id: 'page-a', name: 'Page A' });
    db.pageInsight.findMany.mockResolvedValue([]);
    await call('get_page_analytics', { pageId: 'page-a', days: 5 });
    expect(db.pageInsight.findMany.mock.calls[0][0].where.targetId).toBe('page-a');
  });

  it('applies feature grants and page scope to MCP discovery and reads', async () => {
    const limited = { ...viewer, role: 'viewer', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 'page-a' }] }) };
    const listed = await handleMcpMessage(limited, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list_posts');
    expect(names).not.toContain('create_draft');
    expect(names).not.toContain('list_ad_accounts');

    db.post.findMany.mockResolvedValue([]);
    await handleMcpMessage(limited, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_posts', arguments: {} } });
    expect(db.post.findMany.mock.calls.at(-1)?.[0].where).toMatchObject({ workspaceId: 'workspace-a', OR: [{ targets: { some: { targetId: { in: ['page-a'] } } } }, { authorId: 'user-a', targets: { none: {} } }] });
    expect(db.post.findMany.mock.calls.at(-1)?.[0].select.targets.where).toEqual({ targetId: { in: ['page-a'] } });
  });

  it('rejects unknown statuses and invalid dates before querying posts', async () => {
    const invalidStatus = await call('list_posts', { status: 'draft,owner' });
    expect((await invalidStatus.json()).result.isError).toBe(true);
    const invalidDate = await call('list_posts', { from: 'not-a-date' });
    expect((await invalidDate.json()).result.isError).toBe(true);
    expect(db.post.findMany).not.toHaveBeenCalled();
  });

  it('uses workspace filters for both inbox sources and excludes hidden comments', async () => {
    db.conversation.findMany.mockResolvedValue([]);
    db.postComment.findMany.mockResolvedValue([]);
    await call('list_inbox');
    expect(db.conversation.findMany.mock.calls[0][0].where.target.workspaceId).toBe('workspace-a');
    expect(db.postComment.findMany.mock.calls[0][0].where).toMatchObject({
      isHidden: false,
      postTarget: { post: { workspaceId: 'workspace-a' }, target: { workspaceId: 'workspace-a' } },
    });
  });

  it('requires explicit draft confirmations and audits successful writes', async () => {
    const missing = await call('create_draft', { message: 'hello' });
    expect((await missing.json()).result.isError).toBe(true);
    expect(mutations.create).not.toHaveBeenCalled();

    const created = await call('create_draft', { message: ' hello ', confirmation: 'CREATE DRAFT' });
    expect((await created.json()).result.structuredContent).toEqual({ id: 'new-post', status: 'draft' });
    expect(mutations.create).toHaveBeenCalledWith(viewer, 'hello');
    expect(db.$executeRaw).toHaveBeenCalled();

    const deleted = await call('delete_draft', { postId: 'post-a', confirmation: 'DELETE DRAFT post-a' });
    expect((await deleted.json()).result.structuredContent).toEqual({ id: 'post-a', deleted: true });
    expect(mutations.remove).toHaveBeenCalledWith(viewer, 'post-a');
  });

  it('uses the existing selection mutation and prevents non-admin selection changes', async () => {
    const response = await call('set_connection_selection', { kind: 'target', id: 'page-a', enabled: false, confirmation: 'SET CONNECTION target page-a DISABLED' });
    expect((await response.json()).result.structuredContent).toEqual({ kind: 'target', id: 'page-a', enabled: false });
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

    const remoteDelete = await call('delete_post', { postId: 'post-a', deleteRemote: true, confirmation: 'DELETE POST post-a REMOTE' });
    expect((await remoteDelete.json()).result.structuredContent).toMatchObject({ postId: 'post-a', deleted: true, remoteDeletionRequested: true });
    expect(publishingMutations.remove).toHaveBeenCalledWith(viewer, 'post-a', true);
    expect(db.$executeRaw).toHaveBeenCalled();
  });
});
