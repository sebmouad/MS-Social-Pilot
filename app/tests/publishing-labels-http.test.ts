import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ viewer: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), read: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: h.viewer }));
vi.mock('@/modules/publishing/server/labels', () => ({ createLabel: h.create, updateLabel: h.update, deleteLabel: h.remove, readLabelPage: h.read }));

import { GET, POST } from '../src/app/api/publishing/labels/route';
import { DELETE, PUT } from '../src/app/api/publishing/labels/[id]/route';

const req = (url: string, init: RequestInit = {}) => new Request(url, init);
const base = 'https://app.test/api/publishing/labels';
beforeEach(() => { vi.clearAllMocks(); h.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' }); });

describe('label API', () => {
  it('rejects cross-origin and missing-origin writes before authentication', async () => {
    expect((await POST(req(base, { method: 'POST', body: '{}' }))).status).toBe(403);
    expect((await PUT(req(`${base}/a`, { method: 'PUT', headers: { origin: 'https://evil.test' }, body: '{}' }), { params: Promise.resolve({ id: 'a' }) })).status).toBe(403);
    expect(h.viewer).not.toHaveBeenCalled();
  });
  it('requires the posts feature with write access for mutations and 401s otherwise', async () => {
    h.viewer.mockRejectedValue(new Error('no'));
    expect((await GET(req(base))).status).toBe(401);
    expect((await DELETE(req(`${base}/a`, { method: 'DELETE', headers: { origin: 'https://app.test' }, body: '{}' }), { params: Promise.resolve({ id: 'a' }) })).status).toBe(401);
    h.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' });
    h.create.mockResolvedValue({ id: 'l' });
    const response = await POST(req(base, { method: 'POST', headers: { origin: 'https://app.test' }, body: '{"name":"A"}' }));
    expect(response.status).toBe(201);
    expect(h.viewer).toHaveBeenLastCalledWith({ feature: 'publishing/labels', channelScoped: true, write: true });
    expect(h.create).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { name: 'A' });
  });
  it('validates query parameters and rejects an id in the delete body', async () => {
    expect((await GET(req(`${base}?page=0`))).status).toBe(400);
    expect((await GET(req(`${base}?x=1`))).status).toBe(400);
    const response = await DELETE(req(`${base}/a`, { method: 'DELETE', headers: { origin: 'https://app.test' }, body: '{"id":"b","confirmation":"x"}' }), { params: Promise.resolve({ id: 'a' }) });
    expect(response.status).toBe(400);
    expect(h.remove).not.toHaveBeenCalled();
    const put = await PUT(req(`${base}/a`, { method: 'PUT', headers: { origin: 'https://app.test' }, body: '{"id":"b","name":"Other"}' }), { params: Promise.resolve({ id: 'a' }) });
    expect(put.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
});
