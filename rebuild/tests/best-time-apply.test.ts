import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(), executeRaw: vi.fn(), batch: vi.fn(),
  entitlements: vi.fn(), permissions: vi.fn(), guard: vi.fn(), analytics: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw } }));
vi.mock('@/server/config/store', () => ({ runtimeConfigBatch: mocks.batch }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseModule: () => true, canUseFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.guard }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: mocks.analytics }));

import { getBestTimeApplyStatus, runBestTimeApplyNow, runBestTimeApplication } from '@/modules/publishing/server/best-time-apply';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const policyValues = {
  'publishing.bestTimeLookbackDays': 90, 'publishing.bestTimeMaxPosts': 500, 'publishing.bestTimeMinHistory': 10,
  'publishing.bestTimeMinPostsPerSlot': 3, 'publishing.bestTimeMinLift': 1.2, 'publishing.bestTimeAddPerWeek': 2,
  'publishing.bestTimeMaxOwnSlots': 14, 'publishing.bestTimeApplyBatchWorkspaces': 50,
};
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
const history = [
  ...Array.from({ length: 9 }, (_, index) => ({ postId: `post-${index}`, publishedAt: new Date(`2026-10-0${(index % 5) + 1}T${10 + index}:00:00Z`), measuredAt: new Date('2026-10-20T09:00:00Z'), rankValue: 10 })),
  ...Array.from({ length: 3 }, (_, index) => ({ postId: `winner-${index}`, publishedAt: new Date('2026-10-01T09:00:00Z'), measuredAt: new Date('2026-10-20T09:00:00Z'), rankValue: 100 })),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batch.mockResolvedValue(policyValues);
  mocks.entitlements.mockResolvedValue({ workspaceId: 'workspace-a' });
  mocks.permissions.mockResolvedValue({});
  mocks.guard.mockResolvedValue(undefined);
  mocks.analytics.mockResolvedValue({ postPerformance: async () => history });
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM memberships')) return [{ role: 'owner' }];
    if (sql.includes('FROM workspaces') && sql.includes('SELECT timezone')) return [{ timezone: 'Europe/Paris', bestTimeMode: 'apply' }];
    if (sql.includes('FROM workspaces') && sql.includes('"bestTimeMode" = \'apply\'')) return [{ id: 'workspace-a' }];
    if (sql.includes('FROM targets t JOIN social_accounts')) return [{ id: 'target-a', name: 'Page', provider: 'test' }];
    if (sql.includes('FROM queue_slots')) return [];
    if (sql.includes('"bestTimeMode", "bestTimesRunAt"')) return [{ bestTimeMode: 'apply', bestTimesRunAt: new Date('2026-10-10T00:00:00Z') }];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(1);
});

describe('best-time automatic application', () => {
  it('refuses non-managers before touching slots', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      return sql.includes('FROM memberships') ? [{ role: 'viewer' }] : [];
    });
    await expect(runBestTimeApplyNow(actor, { confirmation: 'APPLY BEST TIMES' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(getBestTimeApplyStatus(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('requires the exact confirmation and automatic mode', async () => {
    await expect(runBestTimeApplyNow(actor, { confirmation: 'apply best times' })).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.executeRaw.mockResolvedValue(0); // claim lost: mode is suggest
    await expect(runBestTimeApplyNow(actor, { confirmation: 'APPLY BEST TIMES' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('adds the strongest new times and audits each with its evidence', async () => {
    const result = await runBestTimeApplyNow(actor, { confirmation: 'APPLY BEST TIMES' }, new Date('2026-10-22T00:00:00Z'));
    expect(result.added).toBeGreaterThan(0);
    const statements = mocks.executeRaw.mock.calls.map(sqlOf).join('\n');
    expect(statements).toContain('INSERT INTO queue_slots');
    expect(statements).toContain('queue.bestTimesAdded');
    const insert = mocks.executeRaw.mock.calls.find(call => sqlOf(call).includes('INSERT INTO queue_slots'))!;
    expect(insert.slice(1)).toContain('workspace-a');
  });

  it('leaves times the queue already covers alone', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM memberships')) return [{ role: 'admin' }];
      if (sql.includes('SELECT timezone')) return [{ timezone: 'Europe/Paris', bestTimeMode: 'apply' }];
      if (sql.includes('FROM targets t JOIN social_accounts')) return [{ id: 'target-a', name: 'Page', provider: 'test' }];
      if (sql.includes('FROM queue_slots')) return [{ targetId: null, dayOfWeek: 4, hour: 11, minute: 0 }];
      return [];
    });
    const result = await runBestTimeApplyNow(actor, { confirmation: 'APPLY BEST TIMES' }, new Date('2026-10-22T00:00:00Z'));
    expect(result.added).toBe(0);
  });

  it('claims each workspace weekly so two workers never double-add', async () => {
    const summary = await runBestTimeApplication(new Date('2026-10-22T00:00:00Z'));
    expect(summary).toContain('workspaces=1');
    const claim = mocks.executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('SET "bestTimesRunAt"'))!;
    expect(claim).toContain('"bestTimeMode" = \'apply\'');
    expect(claim).toContain('"bestTimesRunAt" <=');
  });

  it('reports mode with last and next eligible runs', async () => {
    const status = await getBestTimeApplyStatus(actor, new Date('2026-10-22T00:00:00Z'));
    expect(status.mode).toBe('apply');
    expect(status.lastRunAt).toBe('2026-10-10T00:00:00.000Z');
    expect(status.nextEligibleAt).toBe('2026-10-17T00:00:00.000Z');
  });
});
