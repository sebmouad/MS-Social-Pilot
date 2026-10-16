import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';

const mocks = vi.hoisted(() => ({
  requireViewer: vi.fn(),
  withWorkspaceOperation: vi.fn(),
  getDeletion: vi.fn(),
  finishDeletion: vi.fn(),
  deleteComment: vi.fn(),
}));

vi.mock('../src/server/context', () => ({ requireViewer: mocks.requireViewer }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: mocks.withWorkspaceOperation }));
vi.mock('../src/modules/inbox/server/deletion', () => ({
  getInboxDeletion: mocks.getDeletion,
  finishInboxDeletion: mocks.finishDeletion,
}));
vi.mock('../src/server/inbox/actions', () => ({
  syncInbox: vi.fn(), replyToInbox: vi.fn(), deleteInboxComment: mocks.deleteComment,
  moderateInboxComment: vi.fn(), setInboxResolved: vi.fn(),
}));

import { GET } from '../src/app/api/inbox/deletions/route';
import { POST } from '../src/app/api/inbox/actions/route';

const viewer = { user: { id: 'user-a' }, workspaceId: 'workspace-a' };
const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const makeGet = (query: string) => new Request(`https://app.example/api/inbox/deletions${query}`);
const makePost = (input: unknown, headers: Record<string, string> = {}) => new Request('https://app.example/api/inbox/actions', {
  method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', ...headers }, body: JSON.stringify(input),
});
const noStore = (response: Response) => expect(response.headers.get('cache-control')).toBe('no-store');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireViewer.mockResolvedValue(viewer);
  mocks.withWorkspaceOperation.mockImplementation(async (_workspaceId: string, operation: () => Promise<unknown>) => operation());
  mocks.getDeletion.mockResolvedValue({ operation: null });
  mocks.deleteComment.mockResolvedValue({ ok: true, operationId: 'opaque_operation_1', itemId: 'comment_1', state: 'uncertain', remoteConfirmed: false, localConfirmed: false });
  mocks.finishDeletion.mockResolvedValue({ ok: true, operationId: 'opaque_operation_1', itemId: 'comment_1', state: 'remote_confirmed', remoteConfirmed: true, localConfirmed: false });
});

describe('Inbox deletion HTTP transport', () => {
  it('reads one authorized item status with a scoped actor and no-store response', async () => {
    mocks.getDeletion.mockResolvedValueOnce({ operation: { operationId: 'opaque_operation_1', state: 'uncertain', remoteConfirmed: false, localConfirmed: false } });
    const response = await GET(makeGet('?itemId=comment_1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ operation: { operationId: 'opaque_operation_1', state: 'uncertain', remoteConfirmed: false, localConfirmed: false } });
    expect(mocks.requireViewer).toHaveBeenCalledWith({ feature: 'inbox/conversations', channelScoped: true });
    expect(mocks.getDeletion).toHaveBeenCalledWith(actor, { itemId: 'comment_1' });
    noStore(response);
  });

  it.each(['', '?itemId=first&itemId=second', '?itemId=one&extra=x'])('rejects missing, repeated, or extra query fields: %s', async query => {
    const response = await GET(makeGet(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
    expect(mocks.getDeletion).not.toHaveBeenCalled();
    noStore(response);
  });

  it('returns an uncached authorization failure without exposing auth details', async () => {
    mocks.requireViewer.mockRejectedValueOnce(new Error('session token=private-value'));
    const response = await GET(makeGet('?itemId=comment_1'));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' });
    expect(JSON.stringify(body)).not.toContain('private-value');
    expect(mocks.getDeletion).not.toHaveBeenCalled();
    noStore(response);
  });

  it('masks unexpected status lookup failures while preserving typed service failures', async () => {
    mocks.getDeletion.mockRejectedValueOnce(new Error('postgres://private-password@db')); 
    const unexpected = await GET(makeGet('?itemId=comment_1'));
    expect(unexpected.status).toBe(502);
    const body = await unexpected.json();
    expect(body).toMatchObject({ code: 'upstream_failure' });
    expect(JSON.stringify(body)).not.toContain('private-password');
    noStore(unexpected);

    mocks.getDeletion.mockRejectedValueOnce(new OperationError('not_found', 'This comment or deletion is unavailable in the current workspace.'));
    const typed = await GET(makeGet('?itemId=foreign_item'));
    expect(typed.status).toBe(404);
    expect(await typed.json()).toMatchObject({ code: 'not_found' });
    noStore(typed);
  });

  it('requires deletion confirmation and returns the service uncertainty receipt without claiming completion', async () => {
    const missing = await POST(makePost({ action: 'delete', id: 'comment_1' }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: 'invalid_request' });
    expect(mocks.deleteComment).not.toHaveBeenCalled();
    noStore(missing);

    const response = await POST(makePost({ action: 'delete', id: 'comment_1', confirmation: 'DELETE COMMENT comment_1' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, operationId: 'opaque_operation_1', itemId: 'comment_1', state: 'uncertain', remoteConfirmed: false, localConfirmed: false });
    expect(body).not.toHaveProperty('completed');
    expect(body).not.toHaveProperty('deleted');
    expect(mocks.deleteComment).toHaveBeenCalledTimes(1);
    expect(mocks.deleteComment).toHaveBeenCalledWith(actor, { action: 'delete', id: 'comment_1', confirmation: 'DELETE COMMENT comment_1' });
    expect(mocks.withWorkspaceOperation).not.toHaveBeenCalled();
    noStore(response);
  });

  it('routes local recovery once through its service-owned guard with exact operation confirmation', async () => {
    const response = await POST(makePost({ action: 'finish_delete', operationId: 'opaque_operation_1', confirmation: 'FINISH DELETION opaque_operation_1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'remote_confirmed', remoteConfirmed: true, localConfirmed: false });
    expect(mocks.finishDeletion).toHaveBeenCalledTimes(1);
    expect(mocks.finishDeletion).toHaveBeenCalledWith(actor, { action: 'finish_delete', operationId: 'opaque_operation_1', confirmation: 'FINISH DELETION opaque_operation_1' });
    expect(mocks.withWorkspaceOperation).not.toHaveBeenCalled();
    noStore(response);
  });

  it('masks unexpected write-service failures and retains typed errors', async () => {
    mocks.deleteComment.mockRejectedValueOnce(new Error('provider access_token=private-value'));
    const unexpected = await POST(makePost({ action: 'delete', id: 'comment_1', confirmation: 'DELETE COMMENT comment_1' }));
    expect(unexpected.status).toBe(502);
    const body = await unexpected.json();
    expect(body).toMatchObject({ code: 'upstream_failure' });
    expect(JSON.stringify(body)).not.toContain('private-value');
    noStore(unexpected);

    mocks.finishDeletion.mockRejectedValueOnce(new OperationError('conflict', 'Another comment action is running.'));
    const typed = await POST(makePost({ action: 'finish_delete', operationId: 'opaque_operation_1', confirmation: 'FINISH DELETION opaque_operation_1' }));
    expect(typed.status).toBe(409);
    expect(await typed.json()).toMatchObject({ code: 'conflict', error: 'Another comment action is running.' });
    noStore(typed);
  });
});
