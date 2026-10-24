import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';

const mocks = vi.hoisted(() => ({
  requireViewer: vi.fn(), withWorkspaceOperation: vi.fn(), syncInbox: vi.fn(), replyToInbox: vi.fn(), setInboxResolved: vi.fn(), deleteInboxComment: vi.fn(), moderateInboxComment: vi.fn(),
}));

vi.mock('../src/server/context', () => ({ requireViewer: mocks.requireViewer }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: mocks.withWorkspaceOperation }));
vi.mock('@/modules/inbox/server/actions', () => ({
  syncInbox: mocks.syncInbox, replyToInbox: mocks.replyToInbox, setInboxResolved: mocks.setInboxResolved,
  deleteInboxComment: mocks.deleteInboxComment, moderateInboxComment: mocks.moderateInboxComment,
}));

import { POST } from '../src/app/api/inbox/actions/route';

const viewer = { user: { id: 'user-1' }, workspaceId: 'workspace-1' };
const makeRequest = (body: string, headers: Record<string, string> = { origin: 'https://app.example' }) => new Request('https://app.example/api/inbox/actions', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireViewer.mockResolvedValue(viewer);
  mocks.withWorkspaceOperation.mockImplementation(async (_workspaceId, operation) => operation());
  mocks.syncInbox.mockResolvedValue({ syncedAt: '2026-10-16T00:00:00.000Z' });
  mocks.replyToInbox.mockResolvedValue({ ok: true });
});

async function body(response: Response) { return response.json(); }
function expectNoStore(response: Response) { expect(response.headers.get('cache-control')).toBe('no-store'); }

describe('Inbox action HTTP boundary', () => {
  it('leaves resolve/reopen locking to its domain service without nesting another workspace guard', async () => {
    mocks.setInboxResolved.mockImplementation(async () => mocks.withWorkspaceOperation('workspace-1', async () => ({ ok: true, resolved: true })));
    const response = await POST(makeRequest(JSON.stringify({ action: 'resolve', kind: 'message', id: 'message-1', resolved: true })));
    expect(response.status).toBe(200); expect(mocks.withWorkspaceOperation).toHaveBeenCalledTimes(1);
  });
  it('returns deliberately typed failures with their safe message and status', async () => {
    mocks.replyToInbox.mockRejectedValue(new OperationError('reconnect_required', 'Reconnect this channel before replying.'));
    const response = await POST(makeRequest(JSON.stringify({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' })));
    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: 'Reconnect this channel before replying.', code: 'reconnect_required' });
    expectNoStore(response);
  });

  it('masks unexpected database or provider text even when it contains formerly whitelisted phrases', async () => {
    mocks.replyToInbox.mockRejectedValue(new Error('provider unavailable: reply window closed; no longer a member; Reconnect this source'));
    const response = await POST(makeRequest(JSON.stringify({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' })));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: 'The inbox action outcome is unconfirmed. Inspect the current Inbox item and platform before repeating this action.', code: 'upstream_failure' });
    expectNoStore(response);
  });

  it('uses the scoped viewer actor and workspace guard for service calls', async () => {
    const response = await POST(makeRequest(JSON.stringify({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' })));
    expect(response.status).toBe(200);
    expect(mocks.requireViewer).toHaveBeenCalledWith({ feature: 'inbox/conversations', channelScoped: true });
    expect(mocks.withWorkspaceOperation).toHaveBeenCalledWith('workspace-1', expect.any(Function));
    expect(mocks.replyToInbox).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1' }, { action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' });
    expectNoStore(response);
  });

  it.each([false, undefined])('does not report a write without an explicit successful receipt (%s)', async result => {
    mocks.replyToInbox.mockResolvedValue(result);
    const response = await POST(makeRequest(JSON.stringify({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello' })));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: 'The inbox action outcome is unconfirmed. Inspect the current Inbox item and platform before repeating this action.', code: 'upstream_failure' });
    expectNoStore(response);
  });

  it.each([
    ['invalid JSON', '{'],
    ['invalid action fields', JSON.stringify({ action: 'reply', kind: 'message', id: 'message-1', text: 'Hello', extra: true })],
    ['invalid field values', JSON.stringify({ action: 'resolve', kind: 'message', id: 'bad id', resolved: true })],
  ])('rejects %s and disables caching', async (_label, payload) => {
    const response = await POST(makeRequest(payload));
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: 'Invalid inbox action.', code: 'invalid_request' });
    expectNoStore(response);
    expect(mocks.withWorkspaceOperation).not.toHaveBeenCalled();
  });

  it('rejects missing or cross-origin Origin and keeps the denial no-store', async () => {
    const cases: Array<Record<string, string>> = [{}, { origin: 'https://attacker.example' }];
    for (const headers of cases) {
      const response = await POST(makeRequest(JSON.stringify({ action: 'sync' }), headers));
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({ error: 'Cross-origin request denied.', code: 'forbidden' });
      expectNoStore(response);
    }
  });

  it('rejects repeated URL fields and keeps the response no-store', async () => {
    const request = new Request('https://app.example/api/inbox/actions?action=sync&action=reply', {
      method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sync' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: 'Inbox actions do not accept URL filters.', code: 'invalid_request' });
    expectNoStore(response);
    expect(mocks.withWorkspaceOperation).not.toHaveBeenCalled();
  });

  it('returns a no-store typed authorization response', async () => {
    mocks.requireViewer.mockRejectedValue(new Error('private auth detail'));
    const response = await POST(makeRequest(JSON.stringify({ action: 'sync' })));
    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({ error: 'Not authorized.', code: 'unauthorized' });
    expectNoStore(response);
  });
});
