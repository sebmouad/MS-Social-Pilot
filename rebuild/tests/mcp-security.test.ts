import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  target: { findMany: vi.fn(), findFirst: vi.fn() },
  post: { findMany: vi.fn() },
  pageInsight: { findMany: vi.fn() },
  conversation: { findMany: vi.fn() },
  postComment: { findMany: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: db }));

import { handleMcpMessage, type McpViewer } from '../src/server/mcp/server';

const viewer: McpViewer = {
  userId: 'user-a', workspaceId: 'workspace-a',
  workspace: { id: 'workspace-a', name: 'Alpha', timezone: 'UTC' },
  entitlements: {
    workspaceId: 'workspace-a',
    modules: { home: true, publishing: true, inbox: true, analytics: true, ads: true, settings: true },
    features: { 'home/overview': true, 'publishing/posts': true, 'publishing/calendar': true, 'publishing/queue': true, 'publishing/approvals': true, 'inbox/conversations': true, 'analytics/overview': true, 'analytics/reports': true, 'ads/overview': true, 'ads/campaigns': true, 'settings/connections': true, 'settings/team': true, 'settings/account': true, 'settings/appearance': true },
    platformCapabilities: {},
  },
};
const call = (name: string, args: Record<string, unknown> = {}) => handleMcpMessage(viewer, {
  jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
});

beforeEach(() => vi.clearAllMocks());

describe('MCP workspace boundaries', () => {
  it('scopes destination and post queries to the authenticated workspace and clamps limits', async () => {
    db.target.findMany.mockResolvedValue([]);
    db.post.findMany.mockResolvedValue([]);
    await call('list_pages');
    await call('list_posts', { limit: 900 });
    expect(db.target.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'workspace-a', enabled: true });
    expect(db.post.findMany.mock.calls[0][0]).toMatchObject({ where: { workspaceId: 'workspace-a' }, take: 200 });
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
});
