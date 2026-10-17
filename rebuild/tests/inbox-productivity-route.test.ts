import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireViewer: vi.fn(), list: vi.fn(), read: vi.fn(), act: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.requireViewer }));
vi.mock('../src/modules/inbox/server/productivity', () => ({ listSavedReplies: mocks.list, readInboxProductivity: mocks.read, performInboxProductivityAction: mocks.act }));

import { GET, POST } from '../src/app/api/inbox/productivity/route';

const request = (url: string, init: RequestInit = {}) => new Request(`http://localhost:3200/api/inbox/productivity${url}`, init);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireViewer.mockResolvedValue({ user: { id: 'member-a' }, workspaceId: 'workspace-a' });
  mocks.list.mockResolvedValue({ ok: true, replies: [] });
  mocks.read.mockResolvedValue({ ok: true, notes: [] });
  mocks.act.mockResolvedValue({ ok: true });
});

describe('Inbox productivity HTTP boundary', () => {
  it('requires exactly one item kind/id pair and rejects ignored or repeated query parameters', async () => {
    for (const url of ['?kind=message&id=item&extra=1', '?kind=message&id=item&id=other', '?view=saved-replies&kind=message']) {
      const response = await GET(request(url));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('routes bounded saved-reply filters and item reads through their shared services', async () => {
    const listing = await GET(request('?view=saved-replies&offset=12&limit=5&q=hello'));
    expect(listing.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ userId: 'member-a', workspaceId: 'workspace-a' }, { offset: 12, limit: 5, q: 'hello' });
    const item = await GET(request('?kind=comment&id=comment-a'));
    expect(item.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith({ userId: 'member-a', workspaceId: 'workspace-a' }, { kind: 'comment', id: 'comment-a' });
  });

  it('denies cross-origin writes before parsing the body or invoking services', async () => {
    const response = await POST(request('', { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: '{' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
    expect(mocks.act).not.toHaveBeenCalled();
  });

  it('requires same-origin writes, an authenticated viewer, and no URL parameters', async () => {
    const noOrigin = await POST(request('', { method: 'POST', body: '{}' }));
    expect(noOrigin.status).toBe(403);
    const query = await POST(request('?ignored=1', { method: 'POST', headers: { origin: 'http://localhost:3200' }, body: '{}' }));
    expect(query.status).toBe(400);
    expect(mocks.act).not.toHaveBeenCalled();
  });

  it('masks malformed action bodies and unknown service failures with no-store responses', async () => {
    const malformed = await POST(request('', { method: 'POST', headers: { origin: 'http://localhost:3200' }, body: '{' }));
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get('cache-control')).toBe('no-store');
    mocks.act.mockRejectedValueOnce(new Error('database password leaked'));
    const failure = await POST(request('', { method: 'POST', headers: { origin: 'http://localhost:3200', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'note.add' }) }));
    const payload = await failure.json();
    expect(failure.status).toBe(502);
    expect(failure.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(payload)).not.toContain('database password leaked');
  });
});
