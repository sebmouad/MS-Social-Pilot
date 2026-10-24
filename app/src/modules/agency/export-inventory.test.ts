import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: 'owner' as string | null, raw: vi.fn(), membership: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 268435456 }));
vi.mock('@/server/data', () => {
  const empty = { findMany: async () => [] };
  return { prisma: {
    membership: { findUnique: mocks.membership, findMany: async () => [] }, workspace: { findUnique: async () => ({ id: 'workspace-a' }) },
    target: empty, socialAccount: empty, post: empty, instagramAccount: empty,
    adAccount: { findMany: async () => [{ id: 'account-a', insights: [] }] },
    $queryRaw: async () => [], $queryRawUnsafe: mocks.raw,
  } };
});
import { exportWorkspaceData } from '@/server/data-control';
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'owner';
  mocks.membership.mockImplementation(async ({ where }: { where: { userId_workspaceId: { workspaceId: string } } }) => mocks.role && where.userId_workspaceId.workspaceId === 'workspace-a' ? { role: mocks.role } : null);
  mocks.raw.mockImplementation(async (sql: string) => sql.includes('"ads_objects"') ? [{ id: 'inventory-a', adAccountId: 'account-a', name: 'Stored campaign', extra: { accessToken: 'private-token' } }] : []);
});

describe('owner workspace export inventory', () => {
  it.each(['owner', 'admin'])('exports safe ad inventory for a current %s using the authorized parent account', async role => {
    mocks.role = role;
    const result = await exportWorkspaceData({ userId: 'person-a', workspaceId: 'workspace-a' });
    expect(result.indirectTables.ads_objects).toEqual([{ id: 'inventory-a', adAccountId: 'account-a', name: 'Stored campaign', extra: { accessToken: '[REDACTED]' } }]);
    expect(result.coverage.indirectRowCounts.ads_objects).toBe(1);
    expect(result.coverage.complete).toBe(false);
    const call = mocks.raw.mock.calls.find(([sql]) => sql.includes('"ads_objects"'))!;
    expect(call[0]).toContain('SELECT "id" FROM "public"."ad_accounts" WHERE "workspaceId" = $1');
    expect(call[1]).toBe('workspace-a');
  });
  it.each(['editor', 'contributor', 'viewer', 'client', null])('refuses %s before reading export data', async role => {
    mocks.role = role;
    await expect(exportWorkspaceData({ userId: 'person-a', workspaceId: 'workspace-a' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.raw).not.toHaveBeenCalled();
  });
  it('refuses another workspace even for an owner elsewhere', async () => {
    await expect(exportWorkspaceData({ userId: 'person-a', workspaceId: 'workspace-b' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.raw).not.toHaveBeenCalled();
  });
});
