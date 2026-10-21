import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workspace: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  executeRaw: vi.fn(), queryRaw: vi.fn(), transaction: vi.fn(), runtime: vi.fn(),
}));
state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ user: state.user, workspace: state.workspace, $executeRaw: state.executeRaw, $queryRaw: state.queryRaw }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: state.transaction } }));

vi.mock('@/server/config/store', () => ({ runtimeConfig: state.runtime }));

import { createRootWorkspace, renameRootWorkspace } from '@/server/root/workspace-controls';

describe('Root workspace controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ user: state.user, workspace: state.workspace, $executeRaw: state.executeRaw, $queryRaw: state.queryRaw }));
    state.runtime.mockImplementation(async (key: string) => ({ 'root.workspaceNameMaxCharacters': 100, 'root.identifierMaxCharacters': 200, 'root.emailMaxCharacters': 254, 'root.confirmationMaxCharacters': 400, 'root.defaultWorkspaceTimezone': 'UTC', 'root.accountOperationTimeoutMs': 10000, 'root.accountOperationLockWaitMs': 5000 }[key]));
    state.user.findUnique.mockImplementation(async ({ where }: any) => where.id ? { isInstanceOwner: true, disabledAt: null } : { id: 'owner', email: 'owner@example.com', disabledAt: null });
    state.workspace.create.mockResolvedValue({ id: 'workspace-new', slug: 'acme-example' });
    state.workspace.findUnique.mockResolvedValue({ id: 'workspace-1', name: 'Acme', dataPurge: null });
    state.workspace.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each([null, { isInstanceOwner: false, disabledAt: null }, { isInstanceOwner: true, disabledAt: new Date() }])('refuses direct mutations for unauthorized actors: %j', async actor => {
    state.user.findUnique.mockResolvedValue(actor);
    await expect(createRootWorkspace('untrusted', { name: 'Acme', ownerEmail: 'owner@example.com', timezone: 'UTC', confirmation: 'CREATE Acme FOR owner@example.com' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(renameRootWorkspace('untrusted', 'w', 'New', 'RENAME Acme TO New')).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.workspace.create).not.toHaveBeenCalled();
    expect(state.workspace.updateMany).not.toHaveBeenCalled();
  });

  it('enforces runtime name limits for direct service callers', async () => {
    await expect(renameRootWorkspace('root', 'w', 'x'.repeat(101), 'anything')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.workspace.updateMany).not.toHaveBeenCalled();
  });

  it('uses the current Root timezone when a direct caller omits it', async () => {
    await createRootWorkspace('root', { name: 'Acme', ownerEmail: 'Owner@Example.com', confirmation: 'CREATE Acme FOR owner@example.com' });
    expect(state.workspace.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ timezone: 'UTC' }) }));
  });

  it('rechecks Root authority after acquiring the actor lock', async () => {
    state.user.findUnique.mockResolvedValueOnce({ isInstanceOwner: true, disabledAt: null }).mockResolvedValue({ isInstanceOwner: false, disabledAt: null });
    await expect(renameRootWorkspace('root', 'w', 'New', 'RENAME Acme TO New')).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.workspace.updateMany).not.toHaveBeenCalled();
  });

  it.each([{ name: 'x'.repeat(101) }, { ownerEmail: 'invalid' }, { timezone: 'Unknown/Zone' }])('rejects invalid direct create input: %j', async overrides => {
    await expect(createRootWorkspace('root', { name: 'Acme', ownerEmail: 'owner@example.com', confirmation: 'CREATE Acme FOR owner@example.com', ...overrides })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.workspace.create).not.toHaveBeenCalled();
  });

  it('creates a workspace and owner membership atomically with an audit entry', async () => {
    await expect(createRootWorkspace('root', { name: 'Acme', ownerEmail: 'owner@example.com', timezone: 'Africa/Casablanca', confirmation: 'CREATE Acme FOR owner@example.com' })).resolves.toEqual({ id: 'workspace-new', slug: 'acme-example' });
    expect(state.workspace.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'Acme', timezone: 'Africa/Casablanca', memberships: { create: expect.objectContaining({ userId: 'owner', role: 'owner' }) } }) }));
    expect(state.executeRaw).toHaveBeenCalledOnce();
  });

  it('rejects missing owner and wrong confirmation before creating', async () => {
    await expect(createRootWorkspace('root', { name: 'Acme', ownerEmail: 'owner@example.com', timezone: 'UTC', confirmation: 'yes' })).rejects.toThrow(/confirmation/);
    state.user.findUnique.mockImplementation(async ({ where }: any) => where.id ? { isInstanceOwner: true, disabledAt: null } : null);
    await expect(createRootWorkspace('root', { name: 'Acme', ownerEmail: 'owner@example.com', timezone: 'UTC', confirmation: 'CREATE Acme FOR owner@example.com' })).rejects.toThrow(/active account/);
    expect(state.workspace.create).not.toHaveBeenCalled();
  });

  it('renames an active workspace and audits previous and new names', async () => {
    await expect(renameRootWorkspace('root', 'workspace-1', 'Acme Studio', 'RENAME Acme TO Acme Studio')).resolves.toEqual({ changed: true });
    expect(state.workspace.updateMany).toHaveBeenCalledWith({ where: { id: 'workspace-1', name: 'Acme' }, data: { name: 'Acme Studio' } });
    expect(state.executeRaw).toHaveBeenCalledOnce();
  });

  it('does not mutate a workspace undergoing deletion', async () => {
    state.workspace.findUnique.mockResolvedValue({ id: 'workspace-1', name: 'Acme', dataPurge: { status: 'requested' } });
    await expect(renameRootWorkspace('root', 'workspace-1', 'Acme Studio', 'RENAME Acme TO Acme Studio')).rejects.toThrow(/deletion/);
    expect(state.workspace.updateMany).not.toHaveBeenCalled();
  });
});
