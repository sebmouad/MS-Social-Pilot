import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn(), act: vi.fn(), get: vi.fn(), choices: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/modules/tasks/server/tasks', () => ({ listTasks: mocks.list, performTaskAction: mocks.act, getTask: mocks.get, listTaskPostChoices: mocks.choices }));

import { GET, POST } from '../src/app/api/tasks/route';
import { GET as GET_ONE } from '../src/app/api/tasks/[id]/route';
import { GET as GET_POSTS } from '../src/app/api/tasks/posts/route';
import { OperationError } from '../src/lib/operation-error';

const url = 'http://app.test/api/tasks';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
  mocks.list.mockResolvedValue({ ok: true, tasks: [] }); mocks.act.mockResolvedValue({ ok: true });
});
const post = (body: unknown, headers: Record<string, string> = { origin: 'http://app.test' }) => POST(new Request(url, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));

describe('tasks API', () => {
  it('takes the workspace only from the session and rejects unknown or repeated parameters', async () => {
    expect((await GET(new Request(`${url}?status=todo&overdue=true`))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { status: 'todo', overdue: true });
    for (const bad of ['?workspaceId=w2', '?status=a&status=b', '?offset=-1', '?overdue=maybe']) expect((await GET(new Request(url + bad))).status).toBe(400);
  });
  it('denies cross-origin or origin-less writes and malformed bodies without calling the service', async () => {
    expect((await post({ action: 'task.create' }, { origin: 'http://evil.test' })).status).toBe(403);
    expect((await post({ action: 'task.create' }, {})).status).toBe(403);
    expect((await post('{not json')).status).toBe(400);
    expect(mocks.act).not.toHaveBeenCalled();
  });
  it('passes the session actor to writes and maps service failures to safe errors', async () => {
    expect((await post({ action: 'task.create', confirmation: 'CREATE TASK x', title: 'x' })).status).toBe(200);
    expect(mocks.act).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { action: 'task.create', confirmation: 'CREATE TASK x', title: 'x' });
    mocks.act.mockRejectedValue(new OperationError('forbidden', 'No.')); const denied = await post({ action: 'task.create', confirmation: 'CREATE TASK x', title: 'x' });
    expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ code: 'forbidden' });
    mocks.act.mockRejectedValue(new Error('SELECT secret FROM db')); const failed = await post({ action: 'task.create', confirmation: 'CREATE TASK x', title: 'x' });
    expect(JSON.stringify(await failed.json())).not.toContain('secret');
  });
  it('answers unauthenticated reads with the viewer failure and reads one task for the session workspace', async () => {
    mocks.viewer.mockRejectedValueOnce(new OperationError('unauthorized', 'Sign in.')); expect((await GET(new Request(url))).status).toBe(401);
    mocks.get.mockResolvedValue({ ok: true });
    await GET_ONE(new Request(`${url}/t1`), { params: Promise.resolve({ id: 't1' }) });
    expect(mocks.get).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, 't1', undefined);
  });
  it('gates every entry point on the Tasks module and feature before calling the service', async () => {
    mocks.get.mockResolvedValue({ ok: true }); mocks.choices.mockResolvedValue({ ok: true });
    await GET(new Request(url)); await post({ action: 'task.create', confirmation: 'CREATE TASK x', title: 'x' });
    await GET_ONE(new Request(`${url}/t1`), { params: Promise.resolve({ id: 't1' }) }); await GET_POSTS(new Request(`${url}/posts`));
    for (const [access] of mocks.viewer.mock.calls) expect(access).toMatchObject({ module: 'tasks', feature: 'tasks/board', channelScoped: true });
    expect(mocks.viewer.mock.calls.filter(([access]) => access.write === true)).toHaveLength(1);
    mocks.viewer.mockRejectedValue(new Error('redirect'));
    for (const response of [await GET(new Request(url)), await post({ action: 'task.create', confirmation: 'CREATE TASK x', title: 'x' }), await GET_ONE(new Request(`${url}/t1`), { params: Promise.resolve({ id: 't1' }) }), await GET_POSTS(new Request(`${url}/posts`))]) expect(response.status).toBe(401);
    expect(mocks.list).toHaveBeenCalledTimes(1); expect(mocks.act).toHaveBeenCalledTimes(1);
  });
  it('pages comments and post choices with strict parameters', async () => {
    mocks.get.mockResolvedValue({ ok: true }); mocks.choices.mockResolvedValue({ ok: true });
    await GET_ONE(new Request(`${url}/t1?commentOffset=40`), { params: Promise.resolve({ id: 't1' }) });
    expect(mocks.get).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, 't1', { commentOffset: 40 });
    for (const bad of ['?commentOffset=-1', '?commentOffset=1&commentOffset=2', '?workspaceId=w2']) expect((await GET_ONE(new Request(`${url}/t1${bad}`), { params: Promise.resolve({ id: 't1' }) })).status).toBe(400);
    expect((await GET_POSTS(new Request(`${url}/posts?q=launch&offset=5`))).status).toBe(200);
    expect(mocks.choices).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { q: 'launch', offset: 5 });
    for (const bad of ['?offset=x', '?q=a&q=b', '?workspaceId=w2']) expect((await GET_POSTS(new Request(`${url}/posts${bad}`))).status).toBe(400);
  });
});

