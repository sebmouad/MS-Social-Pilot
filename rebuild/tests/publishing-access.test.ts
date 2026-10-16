import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: vi.fn(), membership: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), feature: vi.fn(), permission: vi.fn(), purge: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.user }, membership: { findFirst: state.membership } } }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.feature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.permission }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge }));

import { authorizePublishing } from '../src/modules/publishing/server/access';

const actor = { userId: 'writer', workspaceId: 'workspace', allowedTargetIds: ['allowed', 'revoked'] };
const grants = { pageScope: { all: false, ids: ['allowed', 'current'] } };

beforeEach(() => {
  vi.clearAllMocks();
  state.user.mockResolvedValue({ disabledAt: null });
  state.membership.mockResolvedValue({ role: 'editor' });
  state.entitlements.mockResolvedValue({ marker: 'entitlements' });
  state.permissions.mockResolvedValue({ ...grants, marker: 'permissions' });
  state.feature.mockReturnValue(true);
  state.permission.mockReturnValue(true);
  state.purge.mockResolvedValue(undefined);
});

describe('Publishing authorization', () => {
  it('requires an active user, current membership, entitlement and write permission', async () => {
    state.user.mockResolvedValueOnce(null);
    await expect(authorizePublishing(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(state.entitlements).not.toHaveBeenCalled();

    state.user.mockResolvedValue({ disabledAt: null });
    state.permissions.mockResolvedValueOnce(null);
    await expect(authorizePublishing(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.entitlements).toHaveBeenCalledWith('writer', 'workspace', { allowInstallationInspection: false });
  });

  it('intersects caller target constraints with current grants and returns current authorization context', async () => {
    const result = await authorizePublishing(actor, 'publishing/approvals');
    expect(state.permission).toHaveBeenCalledWith(expect.anything(), 'publishing/approvals', 'write');
    expect(result).toMatchObject({
      actor: { userId: 'writer', workspaceId: 'workspace', allowedTargetIds: ['allowed'] },
      role: expect.any(String), entitlements: { marker: 'entitlements' }, permissions: { marker: 'permissions' },
    });
    expect(state.purge).toHaveBeenCalledWith('workspace');
  });

  it('rejects missing feature access and an active workspace purge', async () => {
    state.feature.mockReturnValue(false);
    await expect(authorizePublishing(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.feature.mockReturnValue(true);
    state.purge.mockRejectedValueOnce(new Error('purging'));
    await expect(authorizePublishing(actor)).rejects.toThrow('purging');
  });
});
