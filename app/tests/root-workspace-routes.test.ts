import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ currentRootActor: vi.fn(), runtimeConfig: vi.fn(), createRootWorkspace: vi.fn(), renameRootWorkspace: vi.fn() }));
vi.mock('@/server/config/access', () => ({ currentRootActor: state.currentRootActor }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));
vi.mock('@/server/root/workspace-controls', () => ({ createRootWorkspace: state.createRootWorkspace, renameRootWorkspace: state.renameRootWorkspace }));

import { POST } from '../src/app/api/root/workspaces/route';
import { PATCH } from '../src/app/api/root/workspaces/[id]/route';

const create = (origin: string) => new Request('https://app.example.test/api/root/workspaces', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme', ownerEmail: 'owner@example.com', confirmation: 'CREATE Acme FOR owner@example.com' }) });
const rename = (origin: string) => new Request('https://app.example.test/api/root/workspaces/ws-1', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme Studio', confirmation: 'RENAME Acme TO Acme Studio' }) });

describe('Root workspace mutation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentRootActor.mockResolvedValue({ id: 'root', isInstanceOwner: true });
    state.runtimeConfig.mockImplementation(async (key: string) => key === 'root.workspaceNameMaxCharacters' ? 100 : 'UTC');
    state.createRootWorkspace.mockResolvedValue({ id: 'ws-new', slug: 'acme-uuid' });
    state.renameRootWorkspace.mockResolvedValue({ changed: true });
  });

  it('rejects cross-origin create and rename before actor lookup', async () => {
    expect((await POST(create('https://evil.example'), undefined)).status).toBe(403);
    expect((await PATCH(rename('https://evil.example'), { params: Promise.resolve({ id: 'ws-1' }) })).status).toBe(403);
    expect(state.currentRootActor).not.toHaveBeenCalled();
  });

  it('restricts both routes to installation owner', async () => {
    state.currentRootActor.mockResolvedValue({ id: 'viewer', isInstanceOwner: false });
    expect((await POST(create('https://app.example.test'), undefined)).status).toBe(404);
    expect((await PATCH(rename('https://app.example.test'), { params: Promise.resolve({ id: 'ws-1' }) })).status).toBe(404);
    expect(state.createRootWorkspace).not.toHaveBeenCalled();
    expect(state.renameRootWorkspace).not.toHaveBeenCalled();
  });

  it('applies Root defaults and passes validated changes to service', async () => {
    expect((await POST(create('https://app.example.test'), undefined)).status).toBe(201);
    expect(state.createRootWorkspace).toHaveBeenCalledWith('root', { name: 'Acme', ownerEmail: 'owner@example.com', confirmation: 'CREATE Acme FOR owner@example.com' });
    expect((await PATCH(rename('https://app.example.test'), { params: Promise.resolve({ id: 'ws-1' }) })).status).toBe(200);
    expect(state.renameRootWorkspace).toHaveBeenCalledWith('root', 'ws-1', 'Acme Studio', 'RENAME Acme TO Acme Studio');
  });
});
