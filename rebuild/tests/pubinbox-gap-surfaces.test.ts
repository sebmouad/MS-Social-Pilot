import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpViewer } from '../src/server/mcp/types';
const h = vi.hoisted(() => ({ viewer: vi.fn(), inboxAccess: vi.fn(), publishingAccess: vi.fn(), reply: vi.fn(), reschedule: vi.fn(), item: vi.fn(), workspace: vi.fn(), audit: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: h.viewer }));
vi.mock('@/server/data', () => ({ prisma: { postComment: { findFirst: h.item }, workspace: { findUnique: h.workspace }, $executeRaw: h.audit } }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_id: string, work: () => Promise<unknown>) => work() }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: h.inboxAccess }));
vi.mock('@/server/platforms/registry', () => ({ platformInbox: async () => ({ reply: h.reply }), inboxPlatformIds: async () => [] }));
vi.mock('@/modules/inbox/server/deletion', () => ({ deleteInboxCommentDurably: vi.fn(), finishInboxDeletion: vi.fn(), getInboxDeletion: vi.fn() }));
vi.mock('@/modules/inbox/server/read', () => ({ readInboxList: vi.fn(), readInboxThread: vi.fn() }));
vi.mock('@/modules/inbox/productivity-mcp', () => ({ inboxProductivityToolDefinitions: [], executeInboxProductivityTool: vi.fn() }));
vi.mock('@/modules/inbox/moderation-mcp', () => ({ inboxModerationToolDefinitions: [], executeInboxModerationTool: vi.fn() }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.publishingAccess }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ reschedulePost: h.reschedule, deletePost: vi.fn(), publishPost: vi.fn() }));
vi.mock('@/modules/publishing/server/duplicate', () => ({ duplicatePost: vi.fn() }));
import { POST as inboxPost } from '../src/app/api/inbox/actions/route';
import { POST as publishingPost } from '../src/app/api/publishing/posts/bulk/route';
import { INBOX_MCP } from '../src/modules/inbox/mcp';
import { executeBulkTool } from '../src/modules/publishing/bulk-mcp';
import { OperationError } from '../src/lib/operation-error';
const actor = { userId: 'user', workspaceId: 'workspace' };
const viewer = { ...actor, scope: 'workspace', role: 'owner', workspace: { id: 'workspace', name: 'Synthetic workspace', timezone: 'Europe/Paris' }, entitlements: {} as McpViewer['entitlements'], permissions: { pageScope: { all: false, ids: ['channel'] } } } as McpViewer;
const request = (path: string, body: unknown) => new Request(`https://app.example/api/${path}`, { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); h.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace' });
  h.item.mockResolvedValue({ postTarget: { target: { id: 'channel', socialAccount: { provider: 'synthetic' } } } });
  h.reply.mockResolvedValue({ ok: true }); h.inboxAccess.mockImplementation(async (_actor, constraints) => ({ channelIds: constraints.allowedChannelIds }));
  h.publishingAccess.mockImplementation(async current => ({ actor: current })); h.workspace.mockResolvedValue({ timezone: 'Europe/Paris' }); h.reschedule.mockResolvedValue({ scheduledAt: new Date('2035-01-02T10:30:00Z') });
});
describe('existing shared services for the new Queue and nested-reply controls', () => {
  it('routes nested HTTP and MCP replies through current channel authorization', async () => {
    const input = { kind: 'comment', id: 'nested-visitor', text: 'Thanks' };
    expect((await inboxPost(request('inbox/actions', { action: 'reply', ...input }))).status).toBe(200);
    await INBOX_MCP[0].execute(viewer, 'reply_to_inbox', { ...input, confirmation: 'REPLY comment nested-visitor' }, 50);
    expect(h.reply).toHaveBeenCalledTimes(2);
    expect(h.reply).toHaveBeenLastCalledWith({ ...actor, allowedChannelIds: ['channel'] }, input);
    expect(h.inboxAccess).toHaveBeenLastCalledWith({ ...actor, allowedChannelIds: ['channel'] }, { allowedChannelIds: ['channel'] }, 'write');
    expect(h.item).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'nested-visitor', postTarget: { post: { workspaceId: 'workspace' }, target: { workspaceId: 'workspace' } } }) }));
  });
  it('rejects revoked current authority and wrong MCP confirmation before provider writes', async () => {
    h.inboxAccess.mockResolvedValue({ channelIds: [] });
    const input = { kind: 'comment', id: 'nested-visitor', text: 'Thanks' };
    expect((await inboxPost(request('inbox/actions', { action: 'reply', ...input }))).status).toBe(404);
    await expect(INBOX_MCP[0].execute(viewer, 'reply_to_inbox', { ...input, confirmation: 'REPLY comment opening' }, 50)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(INBOX_MCP[0].execute(viewer, 'reply_to_inbox', { ...input, confirmation: 'REPLY comment nested-visitor' }, 50)).rejects.toMatchObject({ code: 'not_found' });
    expect(h.reply).not.toHaveBeenCalled();
  });
  const move = { action: 'reschedule', postIds: ['p1'], requestId: '123e4567-e89b-42d3-a456-426614174000', confirmation: 'RESCHEDULE 1 POSTS', date: '2035-01-02', time: '11:30' };
  it('routes HTTP and MCP queue moves through the same service using the stored workspace zone', async () => {
    const http = await publishingPost(request('publishing/posts/bulk', move)); expect(http.status).toBe(200); expect(await http.json()).toMatchObject({ done: 1 });
    await expect(executeBulkTool({ ...actor, allowedTargetIds: ['channel'] }, 'bulk_post_action', move)).resolves.toMatchObject({ done: 1 });
    expect(h.reschedule).toHaveBeenNthCalledWith(1, actor, { postId: 'p1', date: '2035-01-02', time: '11:30', timeZone: 'Europe/Paris' });
    expect(h.reschedule).toHaveBeenNthCalledWith(2, { ...actor, allowedTargetIds: ['channel'] }, { postId: 'p1', date: '2035-01-02', time: '11:30', timeZone: 'Europe/Paris' });
  });
  it('reports a post claimed by a worker as skipped through both transports', async () => {
    h.reschedule.mockRejectedValue(new OperationError('conflict', 'Only posts that are still waiting to publish can be rescheduled.'));
    const http = await publishingPost(request('publishing/posts/bulk', move)); expect(await http.json()).toMatchObject({ done: 0, skipped: 1 });
    await expect(executeBulkTool(actor, 'bulk_post_action', move)).resolves.toMatchObject({ done: 0, skipped: 1 });
  });
});
