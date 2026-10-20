import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '@/lib/operation-error';
const state = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn(), lockedMembership: vi.fn(), audit: vi.fn(), guard: vi.fn(), set: vi.fn(), actor: vi.fn(), clients: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: state.set }) }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: state.session, prisma: { membership: { findUnique: state.membership }, $transaction: async (run: (tx: unknown) => unknown) => run({ $queryRaw: state.lockedMembership }) } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 200 }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.guard }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: state.audit }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: state.actor }));
vi.mock('@/modules/agency/server/agency', () => ({ agencyOverview: vi.fn(), listAgencyClients: state.clients }));
vi.mock('@/modules/agency/server/export', () => ({ exportAgencyOverview: vi.fn() }));
import { selectWorkspace, assertAgencySession } from '@/modules/agency/server/workspace-selection';
import { AGENCY_SESSION_MCP } from '@/modules/agency/mcp';
import type { McpViewer } from '@/server/mcp/types';
const actor = { userId: 'user', workspaceId: 'old', sessionTokenHash: 'secret-hash' };
const viewer = { scope: 'workspace', userId: 'user', workspaceId: 'old' } as McpViewer;
const session = () => ({ userId: 'user', expiresAt: new Date(Date.now() + 60_000), pending: null, user: { id: 'user', disabledAt: null } });
describe('Agency browser session parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.session.mockResolvedValue(session()); state.membership.mockResolvedValue({ id: 'member' }); state.lockedMembership.mockResolvedValue([{ id: 'member' }]);
    state.guard.mockImplementation(async (_id, run) => run()); state.audit.mockResolvedValue(undefined); state.actor.mockResolvedValue(actor); state.clients.mockResolvedValue({ ok: true, workspaces: [] });
  });
  it('shares selection, audit and cookie without exposing credentials', async () => {
    expect(await selectWorkspace(actor, { workspaceId: 'next' })).toEqual({ ok: true });
    expect(state.guard).toHaveBeenCalledWith('next', expect.any(Function));
    expect(state.audit).toHaveBeenCalledWith(expect.anything(), 'user', 'account.workspace_selected', { workspaceId: 'next' });
    expect(state.set).toHaveBeenCalledWith('sp_workspace', 'next', expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
  });
  it('rejects mismatched confirmation and unknown properties before membership lookup', async () => {
    await expect(selectWorkspace(actor, { workspaceId: 'next', confirmation: 'SELECT WORKSPACE other' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(selectWorkspace(actor, { workspaceId: 'next', redirect: '/root' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.membership).not.toHaveBeenCalled();
  });
  it('requires current membership before inspecting target status', async () => {
    state.membership.mockResolvedValue(null);
    await expect(selectWorkspace(actor, { workspaceId: 'other' })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.guard).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled();
  });
  it.each(['suspended', 'purging'])('refuses %s targets through workspace guard', async status => {
    state.guard.mockRejectedValue(new OperationError('forbidden', status));
    await expect(selectWorkspace(actor, { workspaceId: 'next' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.audit).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled();
  });
  it('refuses membership removed before locked authorization', async () => {
    state.lockedMembership.mockResolvedValue([]);
    await expect(selectWorkspace(actor, { workspaceId: 'next' })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.audit).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled();
  });
  it('refuses preference mutation when durable audit fails', async () => {
    state.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(selectWorkspace(actor, { workspaceId: 'next' })).rejects.toThrow('audit unavailable'); expect(state.set).not.toHaveBeenCalled();
  });
  it.each([{ pending: 'totp' }, { expiresAt: new Date(0) }, { userId: 'other' }, { user: { id: 'user', disabledAt: new Date() } }])('refuses unusable session %j', async override => {
    state.session.mockResolvedValue({ ...session(), ...override });
    await expect(selectWorkspace(actor, { workspaceId: 'next' })).rejects.toMatchObject({ code: 'unauthorized' }); expect(state.set).not.toHaveBeenCalled();
  });
  it('rechecks session after acquiring the workspace guard', async () => {
    state.session.mockResolvedValueOnce(session()).mockResolvedValueOnce(null);
    await expect(selectWorkspace(actor, { workspaceId: 'next' })).rejects.toMatchObject({ code: 'unauthorized' }); expect(state.audit).not.toHaveBeenCalled();
  });
  it('excludes bearer keys before session cookie access', async () => {
    const keyed = { ...viewer, apiKeyId: 'key' };
    expect((await AGENCY_SESSION_MCP.available!(keyed))('list_agency_clients')).toBe(false);
    expect(() => AGENCY_SESSION_MCP.beforeCall!(keyed, 'select_workspace', true)).toThrow();
    await expect(AGENCY_SESSION_MCP.execute(keyed, 'list_agency_clients', {}, 100)).rejects.toMatchObject({ code: 'forbidden' }); expect(state.actor).not.toHaveBeenCalled();
    await expect(assertAgencySession({ ...actor, apiKeyId: 'key' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(assertAgencySession({ ...actor, personKeyId: 'person' } as typeof actor)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('uses checked session and existing Clients service with its current workspace authority', async () => {
    await expect(AGENCY_SESSION_MCP.execute(viewer, 'list_agency_clients', { q: 'Studio' }, 100)).resolves.toEqual({ ok: true, workspaces: [] });
    expect(state.actor).toHaveBeenCalledWith('user', 'old'); expect(state.clients).toHaveBeenCalledWith({ userId: 'user' }, { q: 'Studio' });
    expect(AGENCY_SESSION_MCP.features.list_agency_clients).toBe('agency/clients');
  });
  it('requires MCP confirmation and shares the same selection service', async () => {
    await expect(AGENCY_SESSION_MCP.execute(viewer, 'select_workspace', { workspaceId: 'next' }, 100)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(AGENCY_SESSION_MCP.execute(viewer, 'select_workspace', { workspaceId: 'next', confirmation: 'SELECT WORKSPACE next' }, 100)).resolves.toEqual({ ok: true }); expect(state.set).toHaveBeenCalledOnce();
  });
});
