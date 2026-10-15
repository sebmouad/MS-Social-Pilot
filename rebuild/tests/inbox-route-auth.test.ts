import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn() }));

const mocks = vi.hoisted(() => ({
  requireViewer: vi.fn(), sync: vi.fn(), reply: vi.fn(), resolve: vi.fn(), moderate: vi.fn(),
}));

vi.mock('../src/server/context', () => ({ requireViewer: mocks.requireViewer }));
vi.mock('../src/server/inbox/actions', () => ({
  syncFacebookInbox: mocks.sync, replyToFacebookInbox: mocks.reply,
  setFacebookInboxResolved: mocks.resolve, moderateFacebookComment: mocks.moderate,
}));

import { POST } from '../src/app/api/inbox/actions/route';

const request = (body: unknown) => new Request('http://localhost/api/inbox/actions', {
  method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireViewer.mockResolvedValue({ user: { id: 'user-1' }, workspaceId: 'workspace-1' });
  for (const action of [mocks.sync, mocks.reply, mocks.resolve, mocks.moderate]) action.mockResolvedValue({});
});

describe('inbox route scoped authorization', () => {
  it('opts into member access only for the channel-scoped inbox route', async () => {
    expect((await POST(request({ action: 'sync', targetId: 'page-1' }))).status).toBe(200);
    expect(mocks.requireViewer).toHaveBeenCalledWith({ feature: 'inbox/conversations', channelScoped: true });
    expect(mocks.sync).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1' }, 'page-1');
  });

  it('returns denial for an unassigned channel on read and write operations', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('You do not have access to this Facebook Page.'));
    const readDenied = await POST(request({ action: 'sync', targetId: 'page-other' }));
    expect(readDenied.status).toBe(403);

    mocks.reply.mockRejectedValueOnce(new Error('You do not have access to this Facebook Page.'));
    const writeDenied = await POST(request({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' }));
    expect(writeDenied.status).toBe(403);
  });

  it('returns unavailable for a record that belongs to another workspace', async () => {
    mocks.reply.mockRejectedValueOnce(new Error('This conversation is unavailable in the current workspace.'));
    const response = await POST(request({ action: 'reply', kind: 'message', id: 'foreign-message', text: 'Hello' }));
    expect(response.status).toBe(409);
    expect(mocks.reply).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      { action: 'reply', kind: 'message', id: 'foreign-message', text: 'Hello' },
    );
  });
});
