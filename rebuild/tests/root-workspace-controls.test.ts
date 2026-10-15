import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workspace: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  executeRaw: vi.fn(), transaction: vi.fn(),
}));
state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ user: state.user, workspace: state.workspace, $executeRaw: state.executeRaw }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: state.transaction } }));

import { createRootWorkspace, renameRootWorkspace } from '@/server/root/workspace-controls';

describe('Root workspace controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ user: state.user, workspace: state.workspace, $executeRaw: state.executeRaw }));
    state.user.findUnique.mockResolvedValue({ id: 'owner', email: 'owner@example.com', disabledAt: null });
    state.workspace.create.mockResolvedValue({ id: 'workspace-new', slug: 'acme-example' });
    state.workspace.findUnique.mockResolvedValue({ id: 'workspace-1', name: 'Acme', dataPurge: null });
    state.workspace.updateMany.mockResolvedValue({ count: 1 });
  });

  it('creates a workspace and owner membership atomically with an audit entry', async () => {
    await expect(createRootWorkspace('root', { name: 'Acme', ownerEmail: 'owner@example.com', timezone: 'Africa/Casablanca', confirmation: 'CREATE Acme FOR owner@example.com' })).resolves.toEqual({ id: 'workspace-new', slug: 'acme-example' });
    expect(state.workspace.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'Acme', timezone: 'Africa/Casablanca', memberships: { create: expect.objectContaining({ userId: 'owner', role: 'owner' }) } }) }));
    expect(state.executeRaw).toHaveBeenCalledOnce();
  });

  it('rejects missing owner and wrong confirmation before creating', async () => {
    await expect(createRootWorkspace('root', { name: 'Acme', ownerEmail: 'owner@example.com', timezone: 'UTC', confirmation: 'yes' })).rejects.toThrow(/confirmation/);
    state.user.findUnique.mockResolvedValue(null);
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
