import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(), executeRaw: vi.fn(), transaction: vi.fn(), config: vi.fn(),
  authorize: vi.fn(), lock: vi.fn(), usable: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw, $transaction: mocks.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/modules/analytics/reports/server/access', async actual => {
  const real = await actual<object>() as Record<string, unknown>;
  return { ...real, authorizeReport: mocks.authorize, lockActor: mocks.lock, usableChannelIds: mocks.usable, audit: mocks.audit };
});

import { alertConfirmation } from '@/modules/analytics/alerts/contracts';
import { alertsCopy, alertsCopyDefaults } from '@/modules/analytics/alerts/copy';
import { ALERTS_POLICY_DEFAULTS } from '@/modules/analytics/alerts/config';
import { analyticsAlertToolDefinitions, executeAnalyticsAlertTool } from '@/modules/analytics/alerts/mcp';
import { listMetricAlertFirings, listMetricAlertRules, manageMetricAlertRule } from '@/modules/analytics/alerts/server/rules';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
const ruleRow = {
  id: 'rule-a', targetId: 'channel-a', targetName: 'Page', name: 'Views floor', metric: 'views', operator: 'below',
  threshold: 100, windowDays: 7, enabled: true, createdAt: new Date('2026-10-20T00:00:00Z'), updatedAt: new Date('2026-10-20T00:00:00Z'),
  usable: true, firingActual: null, firingAt: null, evaluatedActual: 150, evaluatedAt: new Date('2026-10-21T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ role: 'owner', scope: null, providers: ['facebook'], canManage: true, maxItems: undefined });
  mocks.lock.mockResolvedValue({ role: 'owner', scope: null });
  mocks.usable.mockResolvedValue(['channel-a']);
  mocks.audit.mockResolvedValue(1);
  mocks.config.mockImplementation(async (key: string) => {
    if (key === 'analytics.alerts.policy') return { ...ALERTS_POLICY_DEFAULTS };
    throw new Error(`unexpected config ${key}`);
  });
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM workspaces WHERE id')) return [{ id: 'workspace-a' }];
    if (sql.includes('FROM metric_alert_rules r')) return [ruleRow];
    if (sql.includes('FROM metric_alert_firings f JOIN metric_alert_rules')) return [];
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(1) }];
    if (sql.includes('FROM metric_alert_rules WHERE id')) return [{ id: 'rule-a', targetId: 'channel-a' }];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw }));
});

describe('metric alert rules', () => {
  it('lists scoped rules with firing state and latest measurement', async () => {
    const result = await listMetricAlertRules(actor, {});
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({ id: 'rule-a', name: 'Views floor', state: 'ok', lastActual: 150, channelAvailable: true });
    expect(result.canManage).toBe(true);
  });

  it('marks a rule firing while its open firing exists', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM workspaces WHERE id')) return [{ id: 'workspace-a' }];
      if (sql.includes('FROM metric_alert_rules r')) return [{ ...ruleRow, firingActual: 80, firingAt: new Date('2026-10-22T00:00:00Z') }];
      return [];
    });
    const result = await listMetricAlertRules(actor, {});
    expect(result.rules[0]).toMatchObject({ state: 'firing', lastActual: 80 });
  });

  it('returns nothing outside the channel scope', async () => {
    mocks.authorize.mockResolvedValue({ role: 'viewer', scope: [], providers: ['facebook'], canManage: false, maxItems: undefined });
    const result = await listMetricAlertRules(actor, {});
    expect(result.rules).toEqual([]);
  });

  it('refuses creates without the exact confirmation or an unusable channel', async () => {
    await expect(manageMetricAlertRule(actor, { action: 'create', channelId: 'channel-a', name: 'x', metric: 'views', operator: 'below', threshold: 5, windowDays: 7, enabled: true, confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.usable.mockResolvedValue([]);
    await expect(manageMetricAlertRule(actor, { action: 'create', channelId: 'channel-a', name: 'x', metric: 'views', operator: 'below', threshold: 5, windowDays: 7, enabled: true, confirmation: alertConfirmation.createRule('channel-a', 'views') })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('creates a rule inside the workspace limit and audits it', async () => {
    const result = await manageMetricAlertRule(actor, { action: 'create', channelId: 'channel-a', name: 'Views floor', metric: 'views', operator: 'below', threshold: 100, windowDays: 7, confirmation: alertConfirmation.createRule('channel-a', 'views') });
    expect(result).toMatchObject({ ok: true, action: 'create' });
    expect(mocks.executeRaw.mock.calls.map(sqlOf).some(sql => sql.includes('INSERT INTO metric_alert_rules'))).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), actor, 'analytics.metric_alert_created', expect.objectContaining({ channelId: 'channel-a', metric: 'views' }));
  });

  it('refuses a create past the workspace rule limit', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM workspaces WHERE id')) return [{ id: 'workspace-a' }];
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(ALERTS_POLICY_DEFAULTS.maxRulesPerWorkspace) }];
      return [];
    });
    await expect(manageMetricAlertRule(actor, { action: 'create', channelId: 'channel-a', name: 'x', metric: 'views', operator: 'below', threshold: 5, windowDays: 7, confirmation: alertConfirmation.createRule('channel-a', 'views') })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('pausing a rule resolves its open firing; deleting removes the rule', async () => {
    const updated = await manageMetricAlertRule(actor, { action: 'update', id: 'rule-a', name: 'Views floor', metric: 'views', operator: 'below', threshold: 100, windowDays: 7, enabled: false, confirmation: alertConfirmation.updateRule('rule-a') });
    expect(updated).toMatchObject({ ok: true, action: 'update' });
    expect(mocks.executeRaw.mock.calls.map(sqlOf).some(sql => sql.includes(`UPDATE metric_alert_firings SET state = 'resolved'`))).toBe(true);
    const deleted = await manageMetricAlertRule(actor, { action: 'delete', id: 'rule-a', confirmation: alertConfirmation.deleteRule('rule-a') });
    expect(deleted).toMatchObject({ ok: true, action: 'delete' });
  });

  it('reports a rule outside the scope as missing', async () => {
    mocks.lock.mockResolvedValue({ role: 'owner', scope: ['channel-b'] });
    await expect(manageMetricAlertRule(actor, { action: 'delete', id: 'rule-a', confirmation: alertConfirmation.deleteRule('rule-a') })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lists firing history newest first', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM workspaces WHERE id')) return [{ id: 'workspace-a' }];
      if (sql.includes('FROM metric_alert_firings f JOIN metric_alert_rules')) return [{ id: 'fire-a', ruleId: 'rule-a', ruleName: 'Views floor', targetId: 'channel-a', targetName: 'Page', metric: 'views', operator: 'below', threshold: 100, actual: 80, periodStart: new Date('2026-10-15T00:00:00Z'), periodEnd: new Date('2026-10-22T00:00:00Z'), state: 'fired', firedAt: new Date('2026-10-22T00:00:00Z'), resolvedAt: null }];
      return [];
    });
    const result = await listMetricAlertFirings(actor, {});
    expect(result.firings).toHaveLength(1);
    expect(result.firings[0]).toMatchObject({ id: 'fire-a', actual: 80, state: 'fired' });
  });
});

describe('metric alert MCP tools', () => {
  it('lists rules plus firings through one read tool and manages through one write tool', async () => {
    expect(analyticsAlertToolDefinitions.map(tool => tool.name)).toEqual(['list_metric_alerts', 'manage_metric_alert']);
    const listed = await executeAnalyticsAlertTool(actor, 'list_metric_alerts', {});
    expect((listed as { rules: unknown[] }).rules).toHaveLength(1);
    expect((listed as { firings: unknown[] }).firings).toEqual([]);
    await expect(executeAnalyticsAlertTool(actor, 'manage_metric_alert', { action: 'delete', id: 'rule-a', confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAnalyticsAlertTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('metric alert copy', () => {
  it('ships every customer string in English and French', () => {
    for (const [key, value] of Object.entries(alertsCopyDefaults)) {
      expect(value.en.trim().length, `en:${key}`).toBeGreaterThan(0);
      expect(value.fr.trim().length, `fr:${key}`).toBeGreaterThan(0);
    }
    expect(alertsCopy('fr').title).toBe(alertsCopyDefaults.title.fr);
    expect(alertsCopy('en-US').title).toBe(alertsCopyDefaults.title.en);
  });
});
