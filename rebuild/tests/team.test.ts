import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  membership: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() }, target: { findMany: vi.fn() },
  executeRaw: vi.fn(), queryRaw: vi.fn(), transaction: vi.fn(),
}));
state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ membership: state.membership, user: state.user, target: state.target, $executeRaw: state.executeRaw, $queryRaw: state.queryRaw }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: state.transaction } }));

import { removeTeamMember, updateTeamMember } from '@/server/team';

describe('workspace team mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ membership: state.membership, user: state.user, target: state.target, $executeRaw: state.executeRaw, $queryRaw: state.queryRaw }));
    state.membership.findUnique.mockResolvedValue({ role: 'owner' });
    state.membership.findFirst.mockResolvedValue({ id: 'member-owner', userId: 'other', role: 'owner' });
    state.membership.count.mockResolvedValue(1);
    state.target.findMany.mockResolvedValue([]);
    state.executeRaw.mockResolvedValue(1);
  });

  it('blocks demotion of the final owner', async () => {
    await expect(updateTeamMember({ userId: 'actor', workspaceId: 'workspace' }, 'member-owner', 'admin', [], true)).rejects.toThrow('must keep at least one owner');
    expect(state.membership.update).not.toHaveBeenCalled();
  });

  it('blocks removal of the final owner', async () => {
    await expect(removeTeamMember({ userId: 'actor', workspaceId: 'workspace' }, 'member-owner')).rejects.toThrow('must keep at least one owner');
    expect(state.membership.delete).not.toHaveBeenCalled();
  });

  it('prevents admins from changing or removing owner memberships', async () => {
    state.membership.findUnique.mockResolvedValue({ role: 'admin' });
    await expect(updateTeamMember({ userId: 'actor', workspaceId: 'workspace' }, 'member-owner', 'viewer', [], true)).rejects.toThrow('Only an owner');
    await expect(removeTeamMember({ userId: 'actor', workspaceId: 'workspace' }, 'member-owner')).rejects.toThrow('Only an owner');
    expect(state.membership.update).not.toHaveBeenCalled();
    expect(state.membership.delete).not.toHaveBeenCalled();
  });

  it('prevents self-demotion and self-removal', async () => {
    state.membership.findFirst.mockResolvedValue({ id: 'member-self', userId: 'actor', role: 'admin' });
    await expect(updateTeamMember({ userId: 'actor', workspaceId: 'workspace' }, 'member-self', 'viewer', [], true)).rejects.toThrow('cannot change your own role');
    await expect(removeTeamMember({ userId: 'actor', workspaceId: 'workspace' }, 'member-self')).rejects.toThrow('cannot remove your own');
  });
});
