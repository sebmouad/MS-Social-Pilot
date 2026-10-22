import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), issue: vi.fn(), revoke: vi.fn() }));
vi.mock('@/server/config/access', () => ({ currentRootActor: mocks.actor }));
vi.mock('./server/client-invitations', () => ({ listClientInvitations: mocks.list, issueClientInvitation: mocks.issue, revokeClientInvitation: mocks.revoke }));
import { GET, POST, DELETE } from './server/client-invitations-http';
import { executeRootClientInvitationTool } from './root-mcp';
import { createClientInvitation, reloadClientInvitations, removeClientInvitation } from './ui/clients/invitation-actions';
const origin = 'https://pilot.example.test';
const request = (body: unknown, source = origin) => new Request(`${origin}/api/root/client-invitations`, { method: 'POST', headers: { origin: source, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor.mockResolvedValue({ id: 'root-a', isInstanceOwner: true });
  mocks.list.mockResolvedValue({ invitations: [{ id: 'invite-a' }, { id: 'invite-b' }], truncated: false });
  mocks.issue.mockResolvedValue({ created: true, id: 'invite-a', delivery: 'unavailable' });
  mocks.revoke.mockResolvedValue({ revoked: true, id: 'invite-a' });
});

describe('client invitation entry points', () => {
  it('calls the same service for browser actions, REST and installation MCP', async () => {
    const body = { email: 'client@example.test', confirmation: 'exact confirmation' };
    await createClientInvitation(body);
    expect((await POST(request(body), undefined)).status).toBe(200);
    await executeRootClientInvitationTool({ userId: 'root-a', isInstanceOwner: true }, 'invite_root_client', body);
    expect(mocks.issue.mock.calls).toEqual(Array.from({ length: 3 }, () => ['root-a', body]));
    await reloadClientInvitations();
    const response = await GET(new Request(`${origin}/api/root/client-invitations`), undefined);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await executeRootClientInvitationTool({ userId: 'root-a', isInstanceOwner: true }, 'list_root_client_invitations', {});
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });

  it('refuses anonymous and non-Root sessions and prevents cross-origin mutations', async () => {
    expect((await POST(request({}, 'https://other.example.test'), undefined)).status).toBe(403);
    mocks.actor.mockResolvedValueOnce(null);
    expect((await GET(new Request(origin), undefined)).status).toBe(401);
    mocks.actor.mockResolvedValue({ id: 'workspace-owner', isInstanceOwner: false });
    expect((await POST(request({}), undefined)).status).toBe(404);
    await expect(createClientInvitation({})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(removeClientInvitation({})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(reloadClientInvitations()).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.issue).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('uses the route id and rejects a competing body id or unexpected query filters', async () => {
    const ctx = { params: Promise.resolve({ id: 'invite-a' }) };
    expect((await DELETE(request({ id: 'other', confirmation: 'exact' }), ctx)).status).toBe(400);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect((await DELETE(request({ confirmation: 'exact' }), ctx)).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith('root-a', { id: 'invite-a', confirmation: 'exact' });
    expect((await GET(new Request(`${origin}/api/root/client-invitations?workspaceId=other`), undefined)).status).toBe(400);
  });

  it('refuses bearer principals, customer scope and extra MCP filters before service access', async () => {
    for (const actor of [{ userId: 'root-a', isInstanceOwner: true, apiKeyId: 'key' }, { userId: 'root-a', isInstanceOwner: true, personKeyId: 'key' }, { userId: 'root-a', isInstanceOwner: true, scope: 'workspace' }, { userId: 'owner-a', isInstanceOwner: false }]) {
      await expect(executeRootClientInvitationTool(actor, 'list_root_client_invitations', {})).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(executeRootClientInvitationTool({ userId: 'root-a', isInstanceOwner: true }, 'list_root_client_invitations', { workspaceId: 'other' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('honours the installation MCP result ceiling and safe HTTP errors', async () => {
    expect(await executeRootClientInvitationTool({ userId: 'root-a', isInstanceOwner: true, maxResultItems: 1 }, 'list_root_client_invitations', {})).toMatchObject({ invitations: [{ id: 'invite-a' }], truncated: true });
    mocks.issue.mockRejectedValueOnce(new Error('private database secret'));
    const response = await POST(request({}), undefined);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private database secret');
  });
});
