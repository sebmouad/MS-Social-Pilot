import { OperationError } from '../src/lib/operation-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn(), withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));

const mocks = vi.hoisted(() => ({
  requireViewer: vi.fn(), sync: vi.fn(), reply: vi.fn(), resolve: vi.fn(), moderate: vi.fn(), remove: vi.fn(),
}));

vi.mock('../src/server/context', () => ({ requireViewer: mocks.requireViewer }));
vi.mock('@/modules/inbox/server/actions', () => ({
  syncInbox: mocks.sync, replyToInbox: mocks.reply,
  setInboxResolved: mocks.resolve, moderateInboxComment: mocks.moderate, deleteInboxComment: mocks.remove,
}));

import { POST } from '../src/app/api/inbox/actions/route';

const request = (body: unknown) => new Request('http://localhost/api/inbox/actions', {
  method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireViewer.mockResolvedValue({ user: { id: 'user-1' }, workspaceId: 'workspace-1' });
  for (const action of [mocks.sync, mocks.reply, mocks.resolve, mocks.moderate, mocks.remove]) action.mockResolvedValue({ ok: true });
});

describe('inbox route scoped authorization', () => {
  it('opts into member access only for the channel-scoped inbox route', async () => {
    expect((await POST(request({ action: 'sync', targetId: 'page-1' }))).status).toBe(200);
    expect(mocks.requireViewer).toHaveBeenCalledWith({ feature: 'inbox/conversations', channelScoped: true });
    expect(mocks.sync).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1' }, 'page-1');
  });

  it('returns denial for an unassigned channel on read and write operations', async () => {
    mocks.sync.mockRejectedValueOnce(new OperationError('forbidden', 'You do not have access to this Facebook Page.'));
    const readDenied = await POST(request({ action: 'sync', targetId: 'page-other' }));
    expect(readDenied.status).toBe(403);

    mocks.reply.mockRejectedValueOnce(new OperationError('forbidden', 'You do not have access to this Facebook Page.'));
    const writeDenied = await POST(request({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' }));
    expect(writeDenied.status).toBe(403);
  });

  it('returns unavailable for a record that belongs to another workspace', async () => {
    mocks.reply.mockRejectedValueOnce(new OperationError('not_found', 'This conversation is unavailable in the current workspace.'));
    const response = await POST(request({ action: 'reply', kind: 'message', id: 'foreign-message', text: 'Hello' }));
    expect(response.status).toBe(404);
    expect(mocks.reply).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      { action: 'reply', kind: 'message', id: 'foreign-message', text: 'Hello' },
    );
  });

  it('returns a conflict when the stored Messenger thread is outside the reply window', async () => {
    mocks.reply.mockRejectedValueOnce(new OperationError('conflict', 'The Messenger reply window closed 24 hours after the visitor’s last message.'));
    const response = await POST(request({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('reply window closed') });
  });

  it('routes a delete to the delete action and validates its shape', async () => {
    expect((await POST(request({ action: 'delete', id: 'comment-1', confirmation: 'DELETE COMMENT comment-1' }))).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1' }, { action: 'delete', id: 'comment-1', confirmation: 'DELETE COMMENT comment-1' });
    expect((await POST(request({ action: 'delete', id: 'comment-1', kind: 'message' }))).status).toBe(400);
    expect((await POST(request({ action: 'delete', id: '../x' }))).status).toBe(400);
  });

  it('keeps a failed provider deletion generic and never claims it succeeded', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('upstream exploded with token abc'));
    const response = await POST(request({ action: 'delete', id: 'comment-1', confirmation: 'DELETE COMMENT comment-1' }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('abc');
  });
});
