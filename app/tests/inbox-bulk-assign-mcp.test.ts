import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpViewer } from '../src/server/mcp/types';

const h = vi.hoisted(() => ({ authorize: vi.fn(), assign: vi.fn(), audit: vi.fn(), resolved: vi.fn(), moderate: vi.fn(), remove: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $executeRaw: h.audit } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'inbox.bulkMaxItems': 5 })[key] }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: h.authorize }));
vi.mock('@/modules/inbox/server/actions', () => ({ setInboxResolved: h.resolved, moderateInboxComment: h.moderate, deleteInboxComment: h.remove }));
vi.mock('@/modules/inbox/server/productivity', () => ({ performInboxProductivityAction: h.assign }));
vi.mock('@/modules/inbox/server/read', () => ({ readInboxList: vi.fn(), readInboxThread: vi.fn() }));
vi.mock('@/modules/inbox/server/details', () => ({ readInboxContactDetails: vi.fn() }));
vi.mock('@/modules/inbox/server/deletion', () => ({ deleteInboxCommentDurably: vi.fn(), finishInboxDeletion: vi.fn(), getInboxDeletion: vi.fn() }));
vi.mock('@/modules/inbox/productivity-mcp', () => ({ inboxProductivityToolDefinitions: [], executeInboxProductivityTool: vi.fn() }));
vi.mock('@/modules/inbox/moderation-mcp', () => ({ inboxModerationToolDefinitions: [], executeInboxModerationTool: vi.fn() }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_id: string, work: () => Promise<unknown>) => work() }));
vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));

import { INBOX_MCP } from '../src/modules/inbox/mcp';

const actor = { userId: 'user', workspaceId: 'workspace' };
const viewer = { ...actor, scope: 'workspace', role: 'owner', workspace: { id: 'workspace', name: 'Synthetic workspace', timezone: 'Europe/Paris' }, entitlements: {} as unknown as McpViewer['entitlements'], permissions: { pageScope: { all: false, ids: ['channel'] } } } as unknown as McpViewer;
const bulkTool = INBOX_MCP[0].tools.find(tool => tool.name === 'bulk_inbox_action')!;
/** The MCP receipt audit stores its detail object as one interpolated JSON value of the insert. */
const auditDetail = () => JSON.parse(h.audit.mock.calls.flatMap(call => call).find(value => typeof value === 'string' && value.includes('"tool":"bulk_inbox_action"')));

beforeEach(() => {
  vi.resetAllMocks();
  h.authorize.mockImplementation(async (_actor: unknown, constraints: { allowedChannelIds?: readonly string[] } = {}) => ({ channelIds: [...(constraints.allowedChannelIds ?? ['channel'])], channels: [], timeZone: 'UTC' }));
  h.assign.mockResolvedValue({ ok: true, action: 'assign' });
  h.audit.mockResolvedValue(1);
});

describe('bulk_inbox_action assign parity', () => {
  it('advertises assign on the one bulk tool, with its assignee input and exact confirmation', () => {
    const names = INBOX_MCP[0].tools.map(tool => tool.name);
    expect(names.filter(name => name === 'bulk_inbox_action')).toHaveLength(1);
    expect(names).not.toContain('bulk_inbox_assign');
    const schema = bulkTool.inputSchema as { properties: { action: { enum: string[] }; assigneeId: object } };
    expect(schema.properties.action.enum).toContain('assign');
    expect(schema.properties.assigneeId).toBeDefined();
    expect(bulkTool.description).toContain('BULK ASSIGN');
    expect(bulkTool.description).toContain('UNASSIGNED');
  });

  it('assigns every item through the shared single-item action under the key ceiling', async () => {
    const result = await INBOX_MCP[0].execute(viewer, 'bulk_inbox_action', { action: 'assign', items: [{ kind: 'message', id: 'm1' }, { kind: 'comment', id: 'c1' }], assigneeId: 'member-1', confirmation: 'BULK ASSIGN 2 INBOX ITEMS TO member-1' }, 50);
    expect(result).toMatchObject({ ok: true, action: 'assign', requested: 2, succeeded: 2, failed: 0, mcpAuditRecorded: true });
    // One shared-service call per item, each carrying the exact single-item confirmation and the key's channel ceiling.
    expect(h.assign).toHaveBeenCalledTimes(2);
    expect(h.assign).toHaveBeenNthCalledWith(1, { ...actor, allowedChannelIds: ['channel'] }, { action: 'assign', kind: 'message', id: 'm1', assigneeId: 'member-1', confirmation: 'ASSIGN INBOX message m1 TO member-1' });
    expect(h.assign).toHaveBeenNthCalledWith(2, { ...actor, allowedChannelIds: ['channel'] }, { action: 'assign', kind: 'comment', id: 'c1', assigneeId: 'member-1', confirmation: 'ASSIGN INBOX comment c1 TO member-1' });
  });

  it('records the assignee in the MCP receipt audit beside the per-item service audits', async () => {
    await INBOX_MCP[0].execute(viewer, 'bulk_inbox_action', { action: 'assign', items: [{ kind: 'comment', id: 'c1' }], assigneeId: null, confirmation: 'BULK ASSIGN 1 INBOX ITEMS TO UNASSIGNED' }, 50);
    expect(auditDetail()).toMatchObject({ tool: 'bulk_inbox_action', action: 'assign', requested: 1, succeeded: 1, failed: 0, assigneeId: null });
  });

  it('refuses a wrong confirmation, a missing assignee and reviews before any assignment', async () => {
    await expect(INBOX_MCP[0].execute(viewer, 'bulk_inbox_action', { action: 'assign', items: [{ kind: 'comment', id: 'c1' }], assigneeId: 'member-1', confirmation: 'BULK ASSIGN 1 INBOX ITEMS TO member-2' }, 50)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(INBOX_MCP[0].execute(viewer, 'bulk_inbox_action', { action: 'assign', items: [{ kind: 'comment', id: 'c1' }], confirmation: 'BULK ASSIGN 1 INBOX ITEMS TO UNASSIGNED' }, 50)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(INBOX_MCP[0].execute(viewer, 'bulk_inbox_action', { action: 'assign', items: [{ kind: 'review', id: 'r1' }], assigneeId: null, confirmation: 'BULK ASSIGN 1 INBOX ITEMS TO UNASSIGNED' }, 50)).rejects.toThrow(/Only conversations and comments/);
    expect(h.assign).not.toHaveBeenCalled();
  });
});
