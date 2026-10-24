import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(), executeRaw: vi.fn(), transaction: vi.fn(), config: vi.fn(),
  usable: vi.fn(), audit: vi.fn(), jobAccess: vi.fn(), emit: vi.fn(), measures: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw, $transaction: mocks.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/modules/analytics/reports/server/access', async actual => {
  const real = await actual<object>() as Record<string, unknown>;
  return { ...real, usableChannelIds: mocks.usable, audit: mocks.audit };
});
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: mocks.jobAccess }));
vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: mocks.emit }));

import { ALERTS_POLICY_DEFAULTS } from '@/modules/analytics/alerts/config';
import { evaluateMetricAlerts } from '@/modules/analytics/alerts/server/evaluate';

const rule = { id: 'rule-a', workspaceId: 'workspace-a', targetId: 'channel-a', name: 'Views floor', metric: 'views', operator: 'below', threshold: 100, windowDays: 7, provider: 'facebook' };
const now = new Date('2026-10-22T12:00:00Z');
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ ...ALERTS_POLICY_DEFAULTS });
  mocks.usable.mockResolvedValue(['channel-a']);
  mocks.jobAccess.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(1);
  mocks.emit.mockResolvedValue({ queued: 1 });
  mocks.measures.mockResolvedValue(80);
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM metric_alert_rules r JOIN workspaces')) return [rule];
    if (sql.includes('FOR UPDATE OF r SKIP LOCKED')) return [{ id: 'rule-a' }];
    if (sql.includes('INSERT INTO metric_alert_firings')) return [{ id: 'fire-a' }];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw }));
});

describe('metric alert evaluation', () => {
  it('fires once and notifies when the stored value crosses the threshold', async () => {
    const summary = await evaluateMetricAlerts({ now, measures: mocks.measures });
    expect(summary).toMatchObject({ examined: 1, fired: 1 });
    expect(mocks.measures).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a', targetId: 'channel-a', metric: 'views' }));
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspaceId: 'workspace-a', kind: 'metric_alert', targetId: 'channel-a' }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), { userId: null, workspaceId: 'workspace-a' }, 'analytics.metric_alert_fired', expect.objectContaining({ ruleId: 'rule-a', actual: 80 }));
  });

  it('does not notify twice while the firing stays open', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM metric_alert_rules r JOIN workspaces')) return [rule];
      if (sql.includes('FOR UPDATE OF r SKIP LOCKED')) return [{ id: 'rule-a' }];
      if (sql.includes('INSERT INTO metric_alert_firings')) return [];
      return [];
    });
    const summary = await evaluateMetricAlerts({ now, measures: mocks.measures });
    expect(summary).toMatchObject({ examined: 1, fired: 0, skipped: 1 });
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('resolves the open firing when the value returns within the threshold', async () => {
    mocks.measures.mockResolvedValue(150);
    const summary = await evaluateMetricAlerts({ now, measures: mocks.measures });
    expect(summary).toMatchObject({ examined: 1, resolved: 1 });
    expect(mocks.executeRaw.mock.calls.map(sqlOf).some(sql => sql.includes(`UPDATE metric_alert_firings SET state = 'resolved'`))).toBe(true);
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('leaves unknown measurements unchanged', async () => {
    mocks.measures.mockResolvedValue(null);
    const summary = await evaluateMetricAlerts({ now, measures: mocks.measures });
    expect(summary).toMatchObject({ examined: 1, fired: 0, resolved: 0, skipped: 1 });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('skips rules whose workspace, channel or plan access no longer qualifies', async () => {
    mocks.usable.mockResolvedValue([]);
    expect(await evaluateMetricAlerts({ now, measures: mocks.measures })).toMatchObject({ skipped: 1 });
    mocks.usable.mockResolvedValue(['channel-a']);
    mocks.jobAccess.mockRejectedValue(new Error('suspended'));
    expect(await evaluateMetricAlerts({ now, measures: mocks.measures })).toMatchObject({ skipped: 1 });
    expect(mocks.measures).not.toHaveBeenCalled();
  });

  it('counts a failed measurement without stopping the batch', async () => {
    mocks.measures.mockRejectedValue(new Error('storage down'));
    const summary = await evaluateMetricAlerts({ now, measures: mocks.measures });
    expect(summary).toMatchObject({ examined: 1, failed: 1 });
  });

  it('only selects enabled rules from active, non-purging workspaces', async () => {
    await evaluateMetricAlerts({ now, measures: mocks.measures });
    const select = mocks.queryRaw.mock.calls.map(sqlOf).find(sql => sql.includes('FROM metric_alert_rules r JOIN workspaces'))!;
    expect(select).toContain('r.enabled = true');
    expect(select).toContain('w."suspendedAt" IS NULL');
    expect(select).toContain('workspace_data_purges');
  });

  it('evaluates above-threshold rules on the inclusive boundary', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM metric_alert_rules r JOIN workspaces')) return [{ ...rule, operator: 'above', threshold: 80 }];
      if (sql.includes('FOR UPDATE OF r SKIP LOCKED')) return [{ id: 'rule-a' }];
      if (sql.includes('INSERT INTO metric_alert_firings')) return [{ id: 'fire-a' }];
      return [];
    });
    const summary = await evaluateMetricAlerts({ now, measures: mocks.measures });
    expect(summary).toMatchObject({ fired: 1 });
  });
});
