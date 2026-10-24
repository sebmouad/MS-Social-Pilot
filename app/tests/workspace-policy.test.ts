import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, workspaceDataPurge: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), canUse: vi.fn(), canAccess: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUse }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccess }));

import { needsContributorApproval, workspacePolicyConfirmation } from '../src/modules/settings/workspace-policy';
import { readWorkspacePolicy, updateWorkspacePolicy } from '../src/modules/settings/server/workspace-policy';

const actor = { userId: 'owner-1', workspaceId: 'workspace-1' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.user.findUnique.mockResolvedValue({ disabledAt: null });
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'owner' });
  mocks.prisma.workspaceDataPurge.findUnique.mockResolvedValue(null);
  mocks.config.mockImplementation(async (key: string) => key === 'settings.workspacePolicyTimezoneMaxCharacters' ? 80 : key === 'settings.teamOperationTimeoutMs' ? 10000 : 1000);
  mocks.entitlements.mockResolvedValue({ workspaceId: actor.workspaceId }); mocks.permissions.mockResolvedValue({}); mocks.canUse.mockReturnValue(true); mocks.canAccess.mockReturnValue(true);
  mocks.prisma.$queryRaw.mockResolvedValue([{ id: actor.workspaceId, suspendedAt: null }]);
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
});

describe('workspace operational policies', () => {
  it('matches the legacy approval role rule', () => {
    expect(needsContributorApproval(true, 'contributor')).toBe(true);
    expect(needsContributorApproval(true, 'owner')).toBe(false);
    expect(needsContributorApproval(true, 'admin')).toBe(false);
    expect(needsContributorApproval(true, 'editor')).toBe(false);
    expect(needsContributorApproval(false, 'contributor')).toBe(false);
  });

  it('reads existing settings only for an active workspace manager', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ timezone: 'Europe/Paris', requiresApproval: true }]);
    await expect(readWorkspacePolicy(actor)).resolves.toMatchObject({ timezone: 'Europe/Paris', requiresApproval: true });
    mocks.prisma.membership.findUnique.mockResolvedValueOnce({ role: 'contributor' });
    await expect(readWorkspacePolicy(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.canUse).toHaveBeenCalledWith(expect.anything(), 'settings/workspace');
    expect(mocks.canAccess).toHaveBeenCalledWith(expect.anything(), 'settings/workspace', 'read');
  });

  it('blocks reads while workspace erasure is active', async () => {
    mocks.prisma.workspaceDataPurge.findUnique.mockResolvedValue({ status: 'running' });
    await expect(readWorkspacePolicy(actor)).rejects.toMatchObject({ code: 'conflict' });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('requires the exact workspace-bound confirmation before any transaction', async () => {
    await expect(updateWorkspacePolicy(actor, { timezone: 'UTC', requiresApproval: true, confirmation: 'UPDATE WORKSPACE POLICY other-workspace' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates IANA zones and fails closed for unsupported values', async () => {
    await expect(updateWorkspacePolicy(actor, { timezone: 'Mars/Olympus', requiresApproval: true, confirmation: workspacePolicyConfirmation(actor.workspaceId) })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed when the Root time-zone length cap is out of range', async () => {
    mocks.config.mockResolvedValueOnce(129);
    await expect(updateWorkspacePolicy(actor, { timezone: 'UTC', requiresApproval: true, confirmation: workspacePolicyConfirmation(actor.workspaceId) })).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('locks the workspace exclusively and commits both columns and audit in one transaction', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ id: actor.workspaceId, suspendedAt: null, requiresApproval: false }]).mockResolvedValueOnce([{ locked: true }]).mockResolvedValueOnce([{ role: 'owner', disabledAt: null }]);
    const result = await updateWorkspacePolicy(actor, { timezone: 'America/New_York', requiresApproval: true, confirmation: workspacePolicyConfirmation(actor.workspaceId) });
    expect(result).toMatchObject({ ok: true, timezone: 'America/New_York', requiresApproval: true });
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.prisma.$queryRaw.mock.calls[0]?.[0]?.join('')).toContain('FOR UPDATE');
    expect(mocks.prisma.$queryRaw.mock.calls[2]?.[0]?.join('')).toContain('FOR UPDATE OF m, u');
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.$executeRaw.mock.calls[0]?.[0]?.join('')).toContain('UPDATE workspaces');
    expect(mocks.prisma.$executeRaw.mock.calls[1]?.[0]?.join('')).toContain('INSERT INTO activity_logs');
  });

  it('refuses suspended or purging workspaces before policy writes', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ id: actor.workspaceId, suspendedAt: new Date() }]);
    await expect(updateWorkspacePolicy(actor, { timezone: 'UTC', requiresApproval: true, confirmation: workspacePolicyConfirmation(actor.workspaceId) })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('releases held posts atomically when disabling the approval policy', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ id: actor.workspaceId, suspendedAt: null, requiresApproval: true }]).mockResolvedValueOnce([{ locked: true }]).mockResolvedValueOnce([{ role: 'owner', disabledAt: null }]).mockResolvedValueOnce([{ total: BigInt('3'), scheduled: BigInt('2'), drafts: BigInt('1') }]);
    await updateWorkspacePolicy(actor, { timezone: 'UTC', requiresApproval: false, confirmation: workspacePolicyConfirmation(actor.workspaceId) });
    expect(mocks.prisma.$queryRaw.mock.calls[3]?.[0]?.join('')).toContain("status = 'pending_approval'");
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(3);
    expect(mocks.prisma.$executeRaw.mock.calls[0]?.[0]?.join('')).toContain('approvals.disabled');
  });
});
