import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), record: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: deps.actor }));
vi.mock('../src/server/root/post-deletions', () => ({ listRootPostDeletions: deps.list, recordRootPostDeletionOutcome: deps.record }));
import { GET, POST } from '../src/app/api/root/post-deletions/route';

const request = (method: string, body?: unknown, origin = 'https://app.example.test', url = 'https://app.example.test/api/root/post-deletions') => new Request(url, {
  method, headers: { ...(origin ? { origin } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(() => {
  vi.clearAllMocks();
  deps.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true });
  deps.list.mockResolvedValue({ items: [] });
  deps.record.mockResolvedValue({ ok: true, operationId: 'op1', state: 'rejected' });
});

describe('private Root post deletion API', () => {
  it('rejects cross-origin writes before actor or mutation lookup', async () => {
    const response = await POST(request('POST', { operationId: 'op1' }, 'https://evil.example'));
    expect(response.status).toBe(403);
    expect(deps.actor).not.toHaveBeenCalled(); expect(deps.record).not.toHaveBeenCalled();
  });
  it('rejects non-Root access and marks responses private from caches', async () => {
    deps.actor.mockResolvedValue({ id: 'member', isInstanceOwner: false });
    expect((await GET(request('GET'))).status).toBe(403);
    expect(deps.list).not.toHaveBeenCalled();
    deps.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true });
    const response = await GET(request('GET'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('forwards only the authenticated Root identity and body, and returns no-store', async () => {
    const body = { operationId: 'op1', outcome: 'not_deleted', verifiedOnPlatform: true, confirmation: 'ROOT RECORD POST DELETION op1 NOT DELETED' };
    const response = await POST(request('POST', body));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(deps.record).toHaveBeenCalledWith('root', body);
  });
});
