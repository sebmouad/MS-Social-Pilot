import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewer: vi.fn(), directory: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(),
}));

vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/settings/server/team', () => ({
  getTeamDirectory: state.directory,
  addTeamMember: state.add,
  updateTeamMember: state.update,
  removeTeamMember: state.remove,
}));

import { DELETE, GET, PATCH, POST } from '../src/app/api/settings/team/route';
import { OperationError } from '../src/lib/operation-error';

const actor = { user: { id: 'actor-1' }, workspaceId: 'workspace-1' };
const origin = 'http://localhost';
const url = `${origin}/api/settings/team`;
const headers = { origin, 'content-type': 'application/json' };
const request = (method: string, body: unknown, requestHeaders: Record<string, string> = headers) =>
  new Request(url, { method, headers: requestHeaders, body: JSON.stringify(body) });
const addInput = { email: 'new@example.com', role: 'editor', targetIds: ['channel-1'], allPages: false, confirmation: 'ADD MEMBER new@example.com' };
const updateInput = { membershipId: 'membership-1', role: 'viewer', targetIds: [], allPages: true, confirmation: 'UPDATE MEMBER membership-1' };
const removeInput = { membershipId: 'membership-1', confirmation: 'REMOVE MEMBER membership-1' };

function noStore(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store');
}

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue(actor);
  state.directory.mockResolvedValue({ members: [], total: 0 });
  state.add.mockResolvedValue({ id: 'receipt-add', added: true });
  state.update.mockResolvedValue({ id: 'receipt-update', updated: true });
  state.remove.mockResolvedValue({ id: 'receipt-remove', removed: true });
});

describe('team HTTP boundary', () => {
  it('requires the team feature for reads and returns a private no-store directory', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    noStore(response);
    expect(state.viewer).toHaveBeenCalledWith({ feature: 'settings/team' });
    expect(state.directory).toHaveBeenCalledWith({ userId: actor.user.id, workspaceId: actor.workspaceId });
    expect(await response.json()).toEqual({ members: [], total: 0 });
  });

  it('denies viewers before reads or writes and includes no-store on denials', async () => {
    state.viewer.mockRejectedValue(new OperationError('forbidden', 'Team access is unavailable.'));
    for (const response of [
      await GET(),
      await POST(request('POST', addInput)),
      await PATCH(request('PATCH', updateInput)),
      await DELETE(request('DELETE', removeInput)),
    ]) {
      expect(response.status).toBe(401);
      noStore(response);
    }
    expect(state.directory).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.viewer).toHaveBeenCalledWith({ feature: 'settings/team', write: true });
  });

  it('requires an exact same-origin Origin header for every write', async () => {
    for (const [method, body] of [['POST', addInput], ['PATCH', updateInput], ['DELETE', removeInput]] as const) {
      for (const requestHeaders of [{ 'content-type': 'application/json' }, { ...headers, origin: 'https://attacker.example' }]) {
        const response = method === 'POST' ? await POST(request(method, body, requestHeaders))
          : method === 'PATCH' ? await PATCH(request(method, body, requestHeaders))
            : await DELETE(request(method, body, requestHeaders));
        expect(response.status).toBe(403);
        noStore(response);
      }
    }
    expect(state.viewer).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before dispatching a mutation', async () => {
    for (const [method, handler] of [['POST', POST], ['PATCH', PATCH], ['DELETE', DELETE]] as const) {
      const response = await handler(new Request(url, { method, headers, body: '{' }));
      expect(response.status).toBe(400);
      noStore(response);
    }
    expect(state.add).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it('dispatches the authenticated identity and strict confirmation inputs and returns service receipts', async () => {
    const added = await POST(request('POST', addInput));
    const updated = await PATCH(request('PATCH', updateInput));
    const removed = await DELETE(request('DELETE', removeInput));
    for (const response of [added, updated, removed]) {
      expect(response.status).toBe(200);
      noStore(response);
    }
    const identity = { userId: actor.user.id, workspaceId: actor.workspaceId };
    expect(state.add).toHaveBeenCalledWith(identity, addInput);
    expect(state.update).toHaveBeenCalledWith(identity, updateInput);
    expect(state.remove).toHaveBeenCalledWith(identity, removeInput);
    expect(await added.json()).toEqual({ ok: true, id: 'receipt-add', added: true });
    expect(await updated.json()).toEqual({ ok: true, id: 'receipt-update', updated: true });
    expect(await removed.json()).toEqual({ ok: true, id: 'receipt-remove', removed: true });
  });

  it('returns safe typed failures and masks unexpected infrastructure details', async () => {
    state.add.mockRejectedValueOnce(new OperationError('conflict', 'Confirm the exact member action.'));
    const typed = await POST(request('POST', addInput));
    expect(typed.status).toBe(409);
    noStore(typed);
    expect(await typed.json()).toEqual({ error: 'Confirm the exact member action.', code: 'conflict' });

    state.update.mockRejectedValueOnce(new Error('postgres://user:private-password@db access_token=private-token'));
    const unexpected = await PATCH(request('PATCH', updateInput));
    expect(unexpected.status).toBe(502);
    noStore(unexpected);
    expect(JSON.stringify(await unexpected.json())).not.toMatch(/private-password|private-token|postgres:/);
  });
});
