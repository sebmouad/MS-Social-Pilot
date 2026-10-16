import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ actor: { id: 'root-1', isInstanceOwner: true } as null | { id: string; isInstanceOwner: boolean }, list: vi.fn(), acknowledge: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: async () => deps.actor }));
vi.mock('../src/server/root/inbox-deletions', () => ({ listRootInboxDeletions: deps.list, confirmRootInboxDeletion: deps.acknowledge }));
import { GET, POST } from '../src/app/api/root/inbox-deletions/route';

describe('Root Inbox deletion route', () => {
  beforeEach(() => { deps.actor = { id: 'root-1', isInstanceOwner: true }; deps.list.mockReset(); deps.acknowledge.mockReset(); });

  it('returns a private no-store list for the current Root actor', async () => {
    deps.list.mockResolvedValue({ timeZone: 'UTC', items: [] });
    const response = await GET(new Request('https://app.example.test/api/root/inbox-deletions'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ timeZone: 'UTC', items: [] });
    expect(deps.list).toHaveBeenCalledWith('root-1');
  });

  it('rejects unauthenticated/non-Root access and unexpected filters', async () => {
    deps.actor = null;
    const denied = await GET(new Request('https://app.example.test/api/root/inbox-deletions'));
    expect(denied.status).toBe(401);
    deps.actor = { id: 'user-1', isInstanceOwner: false };
    expect((await GET(new Request('https://app.example.test/api/root/inbox-deletions'))).status).toBe(403);
    deps.actor = { id: 'root-1', isInstanceOwner: true };
    expect((await GET(new Request('https://app.example.test/api/root/inbox-deletions?workspaceId=other'))).status).toBe(400);
    expect(deps.list).not.toHaveBeenCalled();
  });

  it('requires same origin and passes explicit attestation data to the service', async () => {
    const crossOrigin = await POST(new Request('https://app.example.test/api/root/inbox-deletions', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: '{}' }));
    expect(crossOrigin.status).toBe(403); expect(deps.acknowledge).not.toHaveBeenCalled();
    deps.acknowledge.mockResolvedValue({ ok: true, operationId: 'op-1', state: 'remote_confirmed' });
    const response = await POST(new Request('https://app.example.test/api/root/inbox-deletions', { method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'op-1', confirmation: 'CONFIRM REMOTE DELETION op-1', verifiedOnPlatform: true }) }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: true, operationId: 'op-1' });
    expect(deps.acknowledge).toHaveBeenCalledWith('root-1', { operationId: 'op-1', confirmation: 'CONFIRM REMOTE DELETION op-1', verifiedOnPlatform: true });
  });

  it('rejects malformed request bodies without exposing parser details', async () => {
    const response = await POST(new Request('https://app.example.test/api/root/inbox-deletions', { method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' }, body: '{' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request', error: 'Enter a valid deletion confirmation.' });
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });
});
