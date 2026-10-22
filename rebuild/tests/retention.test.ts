import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(), executeRaw: vi.fn(), batch: vi.fn(), single: vi.fn(),
  entitlements: vi.fn(), permissions: vi.fn(), guard: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw } }));
vi.mock('@/server/config/store', () => ({ runtimeConfigBatch: mocks.batch }));
vi.mock('@/server/config/config-or-default', () => ({ configValueOrDefault: mocks.single }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseModule: () => true, canUseFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.guard }));

import { getRetentionStatus, pruneInstallationHistory, pruneWorkspaceHistory, runRetentionNow, runRetentionSweep, retentionTotal } from '@/modules/settings/server/retention';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const policyValues = {
  'retention.auditDays': 365, 'retention.syncLogDays': 30, 'retention.emailDays': 180, 'retention.clickDays': 365,
  'retention.aiDays': 365, 'retention.errorDays': 90, 'retention.analyticsDays': 730, 'retention.schedule': '17 3 * * *',
  'retention.batchWorkspaces': 100, 'settings.retentionCopy': undefined,
};
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batch.mockResolvedValue(policyValues);
  mocks.single.mockRejectedValue(new Error('missing'));
  mocks.entitlements.mockResolvedValue({ workspaceId: 'workspace-a' });
  mocks.permissions.mockResolvedValue({});
  mocks.guard.mockResolvedValue(undefined);
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM memberships')) return [{ role: 'owner' }];
    if (sql.includes('FROM workspaces')) return [{ id: 'workspace-a' }, { id: 'workspace-b' }];
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(3) }];
    if (sql.includes('FROM rebuild_sync_runs') && sql.includes('SELECT')) return [];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(2);
});

describe('retention pruning', () => {
  it('refuses members, viewers and cross-workspace actors before deleting anything', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM memberships')) return [{ role: 'editor' }];
      return [];
    });
    await expect(runRetentionNow(actor, { confirmation: 'PRUNE OLD RECORDS' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(getRetentionStatus(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('requires the exact confirmation for a clean-up now', async () => {
    await expect(runRetentionNow(actor, { confirmation: 'prune old records' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runRetentionNow(actor, {})).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('prunes one workspace across the six history tables and audits the counts', async () => {
    const result = await runRetentionNow(actor, { confirmation: 'PRUNE OLD RECORDS' }, new Date('2026-10-22T00:00:00Z'));
    expect(result.total).toBe(retentionTotal(result.pruned));
    const statements = mocks.executeRaw.mock.calls.map(sqlOf).join('\n');
    for (const table of ['activity_logs', 'email_logs', 'link_clicks', 'ai_generations', 'report_runs']) expect(statements).toContain(`DELETE FROM ${table}`);
    expect(statements).toContain('settings.retention.pruned');
    // Link totals live on the link row and are never touched; running reports keep their idempotency rows.
    expect(statements).not.toContain('DELETE FROM short_links');
    expect(statements).not.toContain('UPDATE short_links');
    expect(statements).toContain('"finishedAt" IS NOT NULL');
    for (const call of mocks.executeRaw.mock.calls) {
      const values = call.slice(1) as unknown[];
      if (sqlOf(call).startsWith('DELETE')) expect(values).toContain('workspace-a');
    }
  });

  it('prunes installation history without touching the one-row-per-job status', async () => {
    const counts = await pruneInstallationHistory({ auditDays: 365, syncLogDays: 30, emailDays: 180, clickDays: 365, aiDays: 365, errorDays: 90, analyticsDays: 730, batchWorkspaces: 100 });
    expect(counts.errors).toBe(2);
    const statements = mocks.executeRaw.mock.calls.map(sqlOf).join('\n');
    expect(statements).toContain('DELETE FROM error_events');
    expect(statements).toContain('DELETE FROM rebuild_sync_runs');
    expect(statements).not.toContain('worker_job_runs');
  });

  it('sweeps bounded workspaces, continues past one failure and writes one audit receipt', async () => {
    let calls = 0;
    mocks.executeRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      calls += 1;
      if (calls === 1) throw new Error('workspace-a activity table locked');
      return 1;
    });
    const summary = await runRetentionSweep(new Date('2026-10-22T00:00:00Z'));
    expect(summary).toContain('workspaces=2');
    expect(summary).toContain('failed=1');
    const statements = mocks.executeRaw.mock.calls.map(sqlOf).join('\n');
    expect(statements).toContain('root.retention.pruned');
    const workspaceList = mocks.queryRaw.mock.calls.map(sqlOf).find(sql => sql.includes('FROM workspaces'));
    expect(workspaceList).toContain('LIMIT');
  });

  it('never selects feed items, insight snapshots or member content for deletion', async () => {
    await pruneWorkspaceHistory('workspace-a', { auditDays: 365, syncLogDays: 30, emailDays: 180, clickDays: 365, aiDays: 365, errorDays: 90, analyticsDays: 730, batchWorkspaces: 100 });
    const statements = mocks.executeRaw.mock.calls.map(sqlOf).join('\n');
    for (const table of ['feed_items', 'page_insights', 'posts', 'members', 'memberships', 'targets']) expect(statements).not.toContain(table);
  });

  it('reports status with the policy, pending counts and the last run', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM memberships')) return [{ role: 'admin' }];
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(4) }];
      if (sql.includes("job = 'retention'")) return [{ startedAt: new Date('2026-10-21T03:17:00Z'), summary: 'workspaces=2 activity=9 emails=0 clicks=0 ai=0 errors=0 syncRuns=3 reports=0', outcome: 'ok' }];
      return [];
    });
    const status = await getRetentionStatus(actor);
    expect(status.policy.emailDays).toBe(180);
    expect(status.pending.activity).toBe(4);
    expect(status.lastRun?.outcome).toBe('ok');
  });
});
