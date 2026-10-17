import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), purge: vi.fn(), featureAllowed: true, permissionAllowed: true }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.user }, membership: { findFirst: state.membership }, workspaceDataPurge: { findUnique: state.purge } } }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: (_e: unknown, feature: string) => feature === 'ads/campaigns' && state.featureAllowed, entitledPlatformIds: () => ['facebook', 'instagram'] }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: (_p: unknown, feature: string, action: string) => feature === 'ads/campaigns' && action === 'read' && state.permissionAllowed }));

import { authorizeAdsRead } from '../src/modules/ads/server/access';

const actor = { userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['target-a', 'target-b'] };

describe('Ads read authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user.mockResolvedValue({ disabledAt: null });
    state.membership.mockResolvedValue({ role: 'viewer' });
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['target-b', 'target-c'] } });
    state.entitlements.mockResolvedValue({ workspaceId: actor.workspaceId });
    state.purge.mockResolvedValue(null);
    state.featureAllowed = true;
    state.permissionAllowed = true;
  });

  it('rechecks active user, membership, read grants, entitlements and purge before returning intersected scope', async () => {
    await expect(authorizeAdsRead(actor)).resolves.toMatchObject({
      actor: { ...actor, allowedTargetIds: ['target-b'] },
      allowedTargetIds: ['target-b'], allowedProviders: ['facebook', 'instagram'], role: 'viewer',
    });
    expect(state.entitlements).toHaveBeenCalledWith(actor.userId, actor.workspaceId, { allowInstallationInspection: false });
    expect(state.purge).toHaveBeenCalledWith({ where: { workspaceId: actor.workspaceId }, select: { status: true } });
  });

  it('denies stale identities, missing membership, and deleted or disabled report access', async () => {
    state.user.mockResolvedValueOnce(null);
    await expect(authorizeAdsRead(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    state.user.mockResolvedValue({ disabledAt: null });
    state.membership.mockResolvedValue(null);
    await expect(authorizeAdsRead(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.membership.mockResolvedValue({ role: 'viewer' });
    state.entitlements.mockResolvedValue(null);
    await expect(authorizeAdsRead(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.entitlements.mockResolvedValue({ workspaceId: actor.workspaceId });
    state.featureAllowed = false; // Root disabled Ads or suspended this workspace.
    await expect(authorizeAdsRead(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.featureAllowed = true;
    state.permissionAllowed = false;
    await expect(authorizeAdsRead(actor)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('denies an in-progress workspace purge and never accepts Root as a customer bypass', async () => {
    state.purge.mockResolvedValue({ status: 'requested' });
    await expect(authorizeAdsRead(actor)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.purge).toHaveBeenCalledTimes(1);
  });
});
