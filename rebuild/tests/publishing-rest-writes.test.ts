import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), lifecycle: {
  createPost: vi.fn(), updatePost: vi.fn(), deletePost: vi.fn(), publishPost: vi.fn(), schedulePost: vi.fn(), reschedulePostToInstant: vi.fn(),
  cancelScheduledPost: vi.fn(), submitPostForApproval: vi.fn(), reviewPost: vi.fn(), syncPostStatus: vi.fn(), importPostsCsv: vi.fn(),
}, comment: { sendFirstComment: vi.fn(), recordFirstCommentOutcome: vi.fn() }, deletion: { getPostDeletion: vi.fn(), finishPostDeletion: vi.fn(), recordPostDeletionOutcome: vi.fn() } }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../src/modules/publishing/server/lifecycle', () => mocks.lifecycle);
vi.mock('../src/modules/publishing/server/first-comment', () => mocks.comment);
vi.mock('../src/modules/publishing/server/deletion', () => mocks.deletion);

import { POST as createRoute } from '../src/app/api/publishing/posts/route';
import { PATCH as updateRoute, DELETE as deleteRoute } from '../src/app/api/publishing/posts/[id]/route';
import { POST as actionRoute } from '../src/app/api/publishing/posts/[id]/[action]/route';
import { GET as deletionGet, POST as deletionPost } from '../src/app/api/publishing/posts/[id]/deletion/route';
import { POST as importRoute } from '../src/app/api/publishing/posts/import/route';
import { POST as commentRoute } from '../src/app/api/publishing/first-comments/[action]/route';
import { OperationError } from '../src/lib/operation-error';

const actor = { userId: 'user', workspaceId: 'workspace', allowedTargetIds: ['channel'] };
const post = (path: string, body: unknown, origin = 'https://local.test', method = 'POST') => new Request(`https://local.test${path}`, { method, headers: { origin }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const ctx = (id: string, action?: string) => ({ params: Promise.resolve({ id, action: action ?? '' }) });
const AT = '2030-01-01T10:00:00.000Z';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace', membership: { workspace: { timezone: 'UTC' } }, permissions: { pageScope: { all: false, ids: ['channel'] } } });
});

describe('Publishing REST writes share one entry contract', () => {
  it('rejects cross-origin and unauthenticated writes before any service call', async () => {
    expect((await createRoute(post('/api/publishing/posts', {}, 'https://other.test'))).status).toBe(403);
    mocks.viewer.mockRejectedValueOnce(new Error('denied'));
    expect((await actionRoute(post('/x', {}), ctx('p1', 'publish'))).status).toBe(401);
    expect(Object.values(mocks.lifecycle).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });

  it('creates a scheduled post with a schedule mode, with the same CREATE POST confirmation as MCP', async () => {
    mocks.lifecycle.createPost.mockResolvedValue({ id: 'p1', scheduleMode: 'remote', remoteHold: { held: 1, deferred: 0, reasons: [] } });
    expect((await createRoute(post('/api/publishing/posts', { targetIds: ['channel'], message: 'Hi', scheduledAt: AT, scheduleMode: 'remote' }))).status).toBe(400);
    const response = await createRoute(post('/api/publishing/posts', { targetIds: ['channel'], message: 'Hi', scheduledAt: AT, scheduleMode: 'remote', confirmation: 'CREATE POST' }));
    expect(response.status).toBe(201);
    expect(mocks.lifecycle.createPost).toHaveBeenCalledWith(actor, expect.objectContaining({ message: 'Hi', targetIds: ['channel'], scheduledAt: new Date(AT), scheduleMode: 'remote' }));
    expect(await response.json()).toMatchObject({ id: 'p1', status: 'scheduled', scheduleMode: 'remote', remoteHold: { held: 1 } });
  });

  it('refuses an unknown schedule mode', async () => {
    const response = await createRoute(post('/api/publishing/posts', { targetIds: ['channel'], message: 'Hi', scheduledAt: AT, scheduleMode: 'sometimes', confirmation: 'CREATE POST' }));
    expect(response.status).toBe(400); expect(mocks.lifecycle.createPost).not.toHaveBeenCalled();
  });

  it('updates and deletes through the shared services with exact confirmations', async () => {
    mocks.lifecycle.deletePost.mockResolvedValue({ ok: true, postId: 'p1', state: 'completed', operations: [], localConfirmed: true });
    expect((await updateRoute(post('/x', { targetIds: ['channel'], message: 'Edited', confirmation: 'UPDATE POST p2' }, undefined, 'PATCH'), ctx('p1'))).status).toBe(400);
    expect((await updateRoute(post('/x', { targetIds: ['channel'], message: 'Edited', confirmation: 'UPDATE POST p1' }, undefined, 'PATCH'), ctx('p1'))).status).toBe(200);
    expect(mocks.lifecycle.updatePost).toHaveBeenCalledWith(actor, expect.objectContaining({ postId: 'p1', message: 'Edited' }));
    expect((await deleteRoute(post('/x', { deleteRemote: true, confirmation: 'DELETE POST p1 LOCAL' }, undefined, 'DELETE'), ctx('p1'))).status).toBe(400);
    const done = await deleteRoute(post('/x', { deleteRemote: true, confirmation: 'DELETE POST p1 REMOTE' }, undefined, 'DELETE'), ctx('p1'));
    expect(done.status).toBe(200); expect(mocks.lifecycle.deletePost).toHaveBeenCalledWith(actor, 'p1', true);
  });

  it('publishes, schedules (with mode), reschedules, cancels, submits, reviews and syncs', async () => {
    mocks.lifecycle.publishPost.mockResolvedValue({ published: 1, failed: 0 });
    mocks.lifecycle.schedulePost.mockResolvedValue({ scheduleMode: 'remote', remoteHold: { held: 1, deferred: 0, reasons: [] } });
    mocks.lifecycle.reschedulePostToInstant.mockResolvedValue({ scheduledAt: new Date(AT) });
    mocks.lifecycle.syncPostStatus.mockResolvedValue({ synced: 1 });
    const call = (action: string, body: object) => actionRoute(post('/x', body), ctx('p1', action));

    expect((await call('publish', { confirmation: 'PUBLISH POST p1' })).status).toBe(200);
    expect(mocks.lifecycle.publishPost).toHaveBeenCalledWith(actor, 'p1', undefined, {});
    expect((await call('schedule', { scheduledAt: AT, scheduleMode: 'remote', confirmation: `SCHEDULE POST p1 ${AT}` })).status).toBe(200);
    expect(mocks.lifecycle.schedulePost).toHaveBeenCalledWith(actor, 'p1', new Date(AT), { scheduleMode: 'remote' });
    expect((await call('schedule', { scheduledAt: AT, destinationScheduleModes: { channel: 'remote' }, confirmation: `SCHEDULE POST p1 ${AT}` })).status).toBe(200);
    expect(mocks.lifecycle.schedulePost).toHaveBeenLastCalledWith(actor, 'p1', new Date(AT), { destinationScheduleModes: { channel: 'remote' } });
    expect((await call('schedule', { scheduledAt: AT, destinationScheduleModes: { channel: 'platform' }, confirmation: `SCHEDULE POST p1 ${AT}` })).status).toBe(400);
    expect((await call('schedule', { scheduledAt: AT, confirmation: 'wrong' })).status).toBe(400);
    expect((await call('reschedule', { scheduledAt: AT, confirmation: `RESCHEDULE POST p1 ${AT}` })).status).toBe(200);
    expect(mocks.lifecycle.reschedulePostToInstant).toHaveBeenCalledWith(actor, 'p1', new Date(AT));
    expect((await call('cancel-schedule', { confirmation: 'CANCEL SCHEDULE p1' })).status).toBe(200);
    expect(mocks.lifecycle.cancelScheduledPost).toHaveBeenCalledWith(actor, 'p1');
    expect((await call('submit', { confirmation: 'SUBMIT POST p1' })).status).toBe(200);
    expect(mocks.lifecycle.submitPostForApproval).toHaveBeenCalledWith(actor, 'p1');
    expect((await call('review', { decision: 'approve', confirmation: 'APPROVE POST p1' })).status).toBe(200);
    expect(mocks.lifecycle.reviewPost).toHaveBeenCalledWith(actor, 'p1', 'approve');
    expect((await call('review', { decision: 'maybe', confirmation: 'MAYBE POST p1' })).status).toBe(400);
    expect(await (await call('sync', { confirmation: 'SYNC POST STATUS p1' })).json()).toMatchObject({ synced: 1 });
    expect((await call('explode', {})).status).toBe(404);
  });

  it('maps a service conflict and masks unexpected errors', async () => {
    mocks.lifecycle.cancelScheduledPost.mockRejectedValueOnce(new OperationError('conflict', 'The platform did not confirm the removal.'));
    expect((await actionRoute(post('/x', { confirmation: 'CANCEL SCHEDULE p1' }), ctx('p1', 'cancel-schedule'))).status).toBe(409);
    mocks.lifecycle.cancelScheduledPost.mockRejectedValueOnce(new Error('private database detail'));
    const masked = await actionRoute(post('/x', { confirmation: 'CANCEL SCHEDULE p1' }), ctx('p1', 'cancel-schedule'));
    expect(JSON.stringify(await masked.json())).not.toContain('private');
  });

  it('imports CSV and recovers a deletion through the shared services', async () => {
    mocks.lifecycle.importPostsCsv.mockResolvedValue({ count: 2 });
    expect((await importRoute(post('/x', { csv: 'message,firstComment,channels\nA,,Page', confirmation: 'IMPORT' }))).status).toBe(400);
    const imported = await importRoute(post('/x', { csv: 'message,firstComment,channels\nA,,Page', confirmation: 'IMPORT POSTS' }));
    expect(imported.status).toBe(201); expect(await imported.json()).toEqual({ count: 2 });

    mocks.deletion.getPostDeletion.mockResolvedValue({ ok: true, postId: 'p1', state: 'none' });
    expect(await (await deletionGet(new Request('https://local.test/x'), ctx('p1'))).json()).toMatchObject({ state: 'none' });
    mocks.deletion.finishPostDeletion.mockResolvedValue({ ok: true, state: 'completed' });
    expect((await deletionPost(post('/x', { intent: 'finish', confirmation: 'FINISH POST DELETION p1' }), ctx('p1'))).status).toBe(200);
    mocks.deletion.recordPostDeletionOutcome.mockResolvedValue({ ok: true, state: 'local_pending' });
    expect((await deletionPost(post('/x', { intent: 'record', operationId: 'op', outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'RECORD POST DELETION op DELETED' }), ctx('p1'))).status).toBe(200);
    expect((await deletionPost(post('/x', { intent: 'record', operationId: 'op', outcome: 'deleted', confirmation: 'RECORD POST DELETION op DELETED' }), ctx('p1'))).status).toBe(400);
  });

  it('sends and records a first comment', async () => {
    mocks.comment.sendFirstComment.mockResolvedValue({ ok: true, state: 'sent' });
    mocks.comment.recordFirstCommentOutcome.mockResolvedValue({ ok: true, state: 'sent' });
    const send = await commentRoute(post('/x', { postId: 'p1', postTargetId: 't1', confirmation: 'SEND FIRST COMMENT t1' }), ctx('', 'send'));
    expect(send.status).toBe(200); expect(mocks.comment.sendFirstComment).toHaveBeenCalledWith(actor, { postId: 'p1', postTargetId: 't1' });
    expect((await commentRoute(post('/x', { postId: 'p1', postTargetId: 't1', outcome: 'sent', confirmation: 'RECORD FIRST COMMENT t1 SENT' }), ctx('', 'record'))).status).toBe(400);
    expect((await commentRoute(post('/x', { postId: 'p1', postTargetId: 't1', outcome: 'sent', remoteId: 'c1', confirmation: 'RECORD FIRST COMMENT t1 SENT' }), ctx('', 'record'))).status).toBe(200);
    expect((await commentRoute(post('/x', {}), ctx('', 'bogus'))).status).toBe(404);
  });
});
