import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  snapshots: [] as unknown[], calls: [] as Array<{ actor: unknown; input: Record<string, unknown>; constraints: unknown }>, pinned: ['v2:reach', 'legacy:keep'] as string[] | null, disabledAt: null as Date | null,
  authFail: false, role: 'member', execs: [] as Array<{ sql: string; values: unknown[] }>, config: {} as Record<string, unknown>, updated: 1,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (k: string) => k in state.config ? state.config[k] : ({
  'analytics.demographics.dimensions': [{ id: 'country', label: 'Country', terms: ['country'] }, { id: 'age-gender', label: 'Age and gender', terms: ['age', 'gender'] }],
  'analytics.demographics.maxRowsPerMetric': 2, 'analytics.pins.maxPerUser': 2, 'analytics.comparison.maxMetrics': 10,
} as Record<string, unknown>)[k] }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_w: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@/modules/analytics/server/access', async () => {
  const actual = await vi.importActual<typeof import('../src/modules/analytics/server/access')>('../src/modules/analytics/server/access');
  return { ...actual, authorize: async () => { if (state.authFail) throw Object.assign(new Error('no'), { code: 'forbidden' }); return { role: state.role, scope: null }; }, audit: async (_tx: unknown, _a: unknown, action: string, detail: unknown) => { state.execs.push({ sql: 'audit:' + action, values: [detail] }); } };
});
vi.mock('@/modules/analytics/server/read', () => ({
  readAnalyticsSnapshot: async (actor: unknown, input: Record<string, unknown>, constraints: unknown) => { state.calls.push({ actor, input, constraints }); const s = state.snapshots.shift(); if (s instanceof Error) throw s; return s; },
}));

import { readDemographics, dimensionOf } from '../src/modules/analytics/demographics/server/demographics';
import { changePinnedMetrics, readPinnedMetrics } from '../src/modules/analytics/pins/server/pins';
import { readAnalyticsComparison } from '../src/modules/analytics/comparison/server/comparison';
import { executeAnalyticsPinTool, analyticsPinWriteTools } from '../src/modules/analytics/pins/mcp';
import { analyticsComparisonToolDefinitions } from '../src/modules/analytics/comparison/mcp';
import { analyticsDemographicsWriteTools } from '../src/modules/analytics/demographics/mcp';
import { DEMOGRAPHICS_CONFIG } from '../src/modules/analytics/demographics/config';
import { PINNED_METRIC_CONFIG } from '../src/modules/analytics/pins/config';
import { COMPARISON_CONFIG } from '../src/modules/analytics/comparison/config';

const actor = { userId: 'u1', workspaceId: 'w1' };
const metric = (o: Record<string, unknown>) => ({ key: 'm', label: 'M', sourceLabel: 'Src', resourceKind: 'channel', aggregationLabel: 'Sum', unit: 'count', kind: 'flow', total: 10, latestAt: new Date('2026-10-10T00:00:00Z'), coverage: 2, available: 2, coveredResourceIds: ['c1', 'c2'], points: [], rows: [], ...o });
const snap = (metrics: unknown[], extra: Record<string, unknown> = {}) => ({
  period: { start: '2026-10-01', end: '2026-10-07' }, options: { channels: [{ id: 'c1', name: 'One' }], adAccounts: [], metrics: [] }, selected: { channelIds: ['c1', 'c2'], adAccountIds: [] },
  audience: { entries: [{ id: 'c1', name: 'One', value: 5, asOf: new Date('2026-10-02') }], total: 5, covered: 1, selected: 2 }, comparisons: {}, allMetrics: metrics, ...extra,
});

beforeEach(() => {
  Object.assign(state, { snapshots: [], calls: [], pinned: ['v2:reach', 'legacy:keep'], disabledAt: null, authFail: false, role: 'member', execs: [], config: {}, updated: 1 });
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray) => s.join('?').includes('FOR UPDATE') ? [{ pinned: state.pinned, disabledAt: state.disabledAt }] : [{ pinned: state.pinned }]);
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { state.execs.push({ sql: s.join('?'), values: v }); return state.updated; });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});

describe('demographics', () => {
  it('groups breakdowns by configured dimension with shares, caps rows and combines counts honestly', async () => {
    const a = metric({ key: 'a', label: 'Audience by country', kind: 'breakdown', rows: [{ label: 'US', value: 60, asOf: null }, { label: 'FR', value: 30, asOf: null }, { label: 'MA', value: 10, asOf: null }] });
    const b = metric({ key: 'b', label: 'Fans by country', kind: 'breakdown', coveredResourceIds: ['c2'], rows: [{ label: 'US', value: 40, asOf: null }] });
    const c = metric({ key: 'c', label: 'Mood', kind: 'breakdown', rows: [{ label: 'x', value: 1, asOf: null }] });
    state.snapshots = [snap([a, b, c, metric({ key: 'flow', kind: 'flow' })])];
    const r = await readDemographics(actor, {});
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0]!;
    expect(g.metrics[0]!.rows).toHaveLength(2); expect(g.metrics[0]!.hiddenRows).toBe(1); expect(g.metrics[0]!.rows[0]!.share).toBeCloseTo(60);
    expect(g.combined!.rows[0]).toMatchObject({ label: 'US', value: 100 }); expect(g.combined!.coverage).toBe(2); expect(g.combined!.note).toMatch(/not a count of unique people/);
    expect(r.other.map(m => m.key)).toEqual(['c']);
    expect(r.audience).toMatchObject({ covered: 1, selected: 2 });
  });
  it('does not combine non-count units and keeps unknown coverage unknown', async () => {
    const a = metric({ key: 'a', label: 'Age', kind: 'breakdown', unit: 'percent', rows: [{ label: '18-24', value: 40, asOf: null }] });
    const b = metric({ key: 'b', label: 'Gender', kind: 'breakdown', unit: 'percent', rows: [{ label: 'F', value: 50, asOf: null }] });
    state.snapshots = [snap([a, b])];
    const g = (await readDemographics(actor, {})).groups[0]!;
    expect(g.combined).toBeNull(); expect(g.metrics[0]!.rows[0]!.share).toBeNull();
  });
  it('reports empty without zeros, matches whole words only, and fails closed on bad config or authorization', async () => {
    state.snapshots = [snap([])]; expect((await readDemographics(actor, {})).empty).toBe(true);
    expect(dimensionOf({ key: 'manager', label: 'Managers' }, [{ id: 'age', label: 'Age', terms: ['age'] }])).toBeNull();
    state.config['analytics.demographics.maxRowsPerMetric'] = 0; await expect(readDemographics(actor, {})).rejects.toMatchObject({ code: 'unavailable' });
    state.config = {}; state.authFail = true; await expect(readDemographics(actor, {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(analyticsDemographicsWriteTools.size).toBe(0);
  });
  it('passes the channel filter to the scoped snapshot reader and surfaces its denial', async () => {
    state.snapshots = [Object.assign(new Error('x'), { code: 'forbidden' })];
    await expect(readDemographics(actor, { filter: '1', channel: ['foreign'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.calls[0]!.input).toMatchObject({ channel: ['foreign'] });
  });
  it('intersects caller channel grants for a resource-restricted MCP actor', async () => {
    const scopedActor = { ...actor, allowedChannelIds: ['allowed-1'] as const };
    state.snapshots = [snap([])];
    await readDemographics(scopedActor, {});
    expect(state.calls[0]!.constraints).toEqual({ feature: 'analytics/demographics', allowedChannelIds: ['allowed-1'] });
  });
  it('refuses a complete demographic result that exceeds the caller item limit', async () => {
    const scopedActor = { ...actor, maxResultItems: 1 };
    state.snapshots = [snap([metric({ key: 'country', kind: 'breakdown', label: 'Audience by country', rows: [{ label: 'US', value: 10, asOf: null }] })])];
    await expect(readDemographics(scopedActor, {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('refuses a Root-capped demographic result to MCP when categories are hidden', async () => {
    const scopedActor = { ...actor, maxResultItems: 100 };
    state.snapshots = [snap([metric({ key: 'country', kind: 'breakdown', label: 'Audience by country', rows: [
      { label: 'US', value: 10, asOf: null }, { label: 'FR', value: 5, asOf: null }, { label: 'MA', value: 2, asOf: null },
    ] })])];
    await expect(readDemographics(scopedActor, {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('pinned metrics', () => {
  it('shows unavailable pins as unknown, never zero, and lists only single-value pinnable metrics', async () => {
    state.snapshots = [snap([metric({ key: 'reach', total: 7 }), metric({ key: 'bk', kind: 'breakdown' })], { comparisons: { reach: { status: 'comparable', previous: 5, delta: 2, percent: 40 } } })];
    state.pinned = ['v2:reach', 'v2:gone', 'legacy:x'];
    const r = await readPinnedMetrics(actor, {});
    expect(r.pins.map(p => [p.key, p.state, p.total, p.resourceKind])).toEqual([['reach', 'available', 7, 'channel'], ['gone', 'unavailable', null, null]]);
    expect(r.pinnable.map(p => p.key)).toEqual(['reach']); expect(r.max).toBe(2);
  });
  it('requires exact confirmation, a visible metric, and the per-person limit', async () => {
    await expect(changePinnedMetrics(actor, { action: 'pin', key: 'reach', confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.snapshots = [snap([metric({ key: 'bk', kind: 'breakdown' })])];
    await expect(changePinnedMetrics(actor, { action: 'pin', key: 'bk', confirmation: 'PIN ANALYTICS METRIC bk' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.snapshots = [snap([metric({ key: 'fresh' })])]; state.pinned = ['v2:a', 'v2:b'];
    await expect(changePinnedMetrics(actor, { action: 'pin', key: 'fresh', confirmation: 'PIN ANALYTICS METRIC fresh' })).rejects.toMatchObject({ code: 'conflict' });
    expect(state.execs).toHaveLength(0);
  });
  it('pins, preserves non-rebuild entries, audits, and treats repeats as unchanged', async () => {
    state.snapshots = [snap([metric({ key: 'new' })])]; state.pinned = ['v2:reach', 'legacy:keep'];
    await expect(changePinnedMetrics(actor, { action: 'pin', key: 'new', confirmation: 'PIN ANALYTICS METRIC new' })).resolves.toMatchObject({ ok: true, count: 2 });
    expect(state.execs[0]!.values[0]).toEqual(['legacy:keep', 'v2:reach', 'v2:new']);
    expect(state.execs[1]!.sql).toBe('audit:analytics.pins_changed');
    state.execs = []; state.snapshots = [snap([metric({ key: 'reach' })])];
    await expect(changePinnedMetrics(actor, { action: 'pin', key: 'reach', confirmation: 'PIN ANALYTICS METRIC reach' })).resolves.toMatchObject({ unchanged: true });
    expect(state.execs).toHaveLength(0);
  });
  it('reorders only existing pins, rejects duplicates, and blocks disabled accounts or failed saves', async () => {
    state.pinned = ['v2:a', 'v2:b'];
    await expect(changePinnedMetrics(actor, { action: 'reorder', keys: ['b', 'a'], confirmation: 'REORDER ANALYTICS PINS 2' })).resolves.toMatchObject({ count: 2 });
    expect(state.execs[0]!.values[0]).toEqual(['v2:b', 'v2:a']);
    await expect(changePinnedMetrics(actor, { action: 'reorder', keys: ['b', 'b'], confirmation: 'REORDER ANALYTICS PINS 2' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(changePinnedMetrics(actor, { action: 'reorder', keys: ['zzz'], confirmation: 'REORDER ANALYTICS PINS 1' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.disabledAt = new Date(); await expect(changePinnedMetrics(actor, { action: 'unpin', key: 'a', confirmation: 'UNPIN ANALYTICS METRIC a' })).rejects.toMatchObject({ code: 'unauthorized' });
    state.disabledAt = null; state.updated = 0; await expect(changePinnedMetrics(actor, { action: 'unpin', key: 'a', confirmation: 'UNPIN ANALYTICS METRIC a' })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('updates only the actor row and routes MCP actions through the same service', async () => {
    state.pinned = ['v2:a']; await executeAnalyticsPinTool(actor, 'unpin_analytics_metric', { key: 'a', confirmation: 'UNPIN ANALYTICS METRIC a' });
    expect(state.execs[0]!.values).toContain('u1');
    await expect(executeAnalyticsPinTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
    expect(analyticsPinWriteTools.has('pin_analytics_metric')).toBe(true);
  });
  it('resolves personal pins through current caller resource grants and refuses an oversized MCP result', async () => {
    const scopedActor = { ...actor, allowedChannelIds: ['allowed-1'] as const, maxResultItems: 1 };
    state.pinned = ['v2:reach']; state.snapshots = [snap([metric({ key: 'reach' })])];
    await expect(readPinnedMetrics(scopedActor, {})).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.calls[0]!.constraints).toEqual({ feature: 'analytics/pins', allowedChannelIds: ['allowed-1'] });
  });
  it('cannot pin a metric absent from the current restricted resource catalog', async () => {
    const scopedActor = { ...actor, allowedChannelIds: ['allowed-1'] as const };
    state.snapshots = [snap([])]; state.pinned = [];
    await expect(changePinnedMetrics(scopedActor, { action: 'pin', key: 'only-foreign', confirmation: 'PIN ANALYTICS METRIC only-foreign' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.calls[0]!.constraints).toEqual({ feature: 'analytics/pins', allowedChannelIds: ['allowed-1'] });
    expect(state.execs).toHaveLength(0);
  });
});

describe('comparison', () => {
  const side = (total: number | null, o: Record<string, unknown> = {}) => snap([metric({ key: 'impr', label: 'Impressions', total, ...o }), metric({ key: 'reach', label: 'Reach', kind: 'ratio', total: 3, aggregationNote: 'not additive' })]);
  it('rejects malformed input, overlapping groups and unauthorized access before reading', async () => {
    await expect(readAnalyticsComparison(actor, { mode: 'period', a: { start: 'x', end: 'y' } })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c1'] })).rejects.toMatchObject({ code: 'invalid_request' });
    state.authFail = true; await expect(readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.calls).toHaveLength(0);
  });
  it('compares two groups only when both are fully covered and counts as unknown when one side is missing', async () => {
    state.snapshots = [side(10, { coverage: 1, available: 1 }), side(4, { coverage: 1, available: 1 })];
    const r = await readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] });
    expect(r.metrics.find(m => m.key === 'impr')).toMatchObject({ status: 'comparable', delta: 6, percent: 150 });
    expect(state.calls.map(c => c.input.channel)).toEqual([['c1'], ['c2']]);
    state.snapshots = [snap([metric({ key: 'only' })]), snap([])];
    const m = (await readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] })).metrics[0]!;
    expect(m).toMatchObject({ status: 'missing', delta: null, b: null });
  });
  it('uses explicit empty ad-account filters for channel groups, so the shared reader excludes ad metrics', async () => {
    const channelMetric = metric({ key: 'impr', label: 'Impressions', resourceKind: 'channel', total: 10, coverage: 1, available: 1, coveredResourceIds: ['c1'] });
    // The shared reader's explicit-empty adFilter contract returns no ad metrics.
    state.snapshots = [snap([channelMetric], { selected: { channelIds: ['c1'], adAccountIds: [] } }), snap([channelMetric], { selected: { channelIds: ['c2'], adAccountIds: [] } })];
    const r = await readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] });
    expect(state.calls.map(c => c.input)).toEqual([
      { start: '2026-10-01', end: '2026-10-07', adFilter: '1', filter: '1', channel: ['c1'] },
      { start: '2026-10-01', end: '2026-10-07', adFilter: '1', filter: '1', channel: ['c2'] },
    ]);
    expect(r.metrics.map(m => m.resourceKind)).toEqual(['channel']);
    expect(r.selected.a.adAccountIds).toEqual([]); expect(r.selected.b.adAccountIds).toEqual([]);
  });
  it('does not subtract ratios between channel groups even when each side is complete', async () => {
    state.snapshots = [
      snap([metric({ key: 'ctr', kind: 'ratio', unit: 'percent', total: 4, coverage: 1, available: 1 })]),
      snap([metric({ key: 'ctr', kind: 'ratio', unit: 'percent', total: 2, coverage: 1, available: 1 })]),
    ];
    const r = await readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] });
    expect(r.metrics[0]).toMatchObject({ status: 'not_comparable', delta: null, percent: null, reason: expect.stringMatching(/ratio/i) });
  });
  it('does not subtract a module-caveated reach measure between single-resource groups', async () => {
    state.snapshots = [
      snap([metric({ key: 'reach', kind: 'stock', total: 100, coverage: 1, available: 1, aggregationNote: 'People may overlap across sources.' })]),
      snap([metric({ key: 'reach', kind: 'stock', total: 90, coverage: 1, available: 1, aggregationNote: 'People may overlap across sources.' })]),
    ];
    const r = await readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] });
    expect(r.metrics[0]).toMatchObject({ status: 'not_comparable', delta: null, percent: null });
  });
  it('does not subtract currency totals between groups without a neutral denomination contract', async () => {
    state.snapshots = [
      snap([metric({ key: 'spend', kind: 'flow', unit: 'currency', total: 100, coverage: 1, available: 1 })]),
      snap([metric({ key: 'spend', kind: 'flow', unit: 'currency', total: 90, coverage: 1, available: 1 })]),
    ];
    const r = await readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] });
    expect(r.metrics[0]).toMatchObject({ status: 'not_comparable', delta: null, percent: null });
  });
  it('fails closed when a stored comparison metric bound is outside the typed Root range', async () => {
    state.config['analytics.comparison.maxMetrics'] = 1;
    await expect(readAnalyticsComparison(actor, { mode: 'period', a: { start: '2026-10-08', end: '2026-10-14' }, b: { start: '2026-10-01', end: '2026-10-07' } })).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.calls).toHaveLength(0);
  });
  it('never subtracts partially covered, noted or null measures between groups and withholds audience delta', async () => {
    state.snapshots = [side(10, { coverage: 1, available: 2 }), side(null, { coverage: 0, available: 1 })];
    const r = await readAnalyticsComparison(actor, { mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['c1'], groupB: ['c2'] });
    expect(r.metrics.every(m => m.status !== 'comparable' && m.delta === null)).toBe(true);
    expect(r.audience.delta).toBeNull(); expect(r.audience.note).toMatch(/not a count of unique people/);
  });
  it('compares two periods for the same channels, caps rows via Root and reports truncation', async () => {
    const many = Array.from({ length: 11 }, (_, i) => metric({ key: `metric-${i}` }));
    state.snapshots = [snap(many), snap(many.map(m => ({ ...m, total: 5 })))];
    const r = await readAnalyticsComparison(actor, { mode: 'period', a: { start: '2026-10-08', end: '2026-10-14' }, b: { start: '2026-10-01', end: '2026-10-07' }, channel: ['c1'] });
    expect(r.metrics).toHaveLength(10); expect(r.truncated).toBe(true); expect(r.totalMetrics).toBe(11);
    expect(state.calls[0]!.input).toMatchObject({ start: '2026-10-08', filter: '1', channel: ['c1'] });
    state.config['analytics.comparison.maxMetrics'] = 0; state.snapshots = [snap([]), snap([])];
    await expect(readAnalyticsComparison(actor, { mode: 'period', a: { start: '2026-10-08', end: '2026-10-14' }, b: { start: '2026-10-01', end: '2026-10-07' } })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('surfaces channel-scope denials from the shared reader and defines a read-only tool', async () => {
    state.snapshots = [Object.assign(new Error('x'), { code: 'forbidden' }), snap([])];
    await expect(readAnalyticsComparison(actor, { mode: 'period', a: { start: '2026-10-08', end: '2026-10-14' }, b: { start: '2026-10-01', end: '2026-10-07' }, channel: ['foreign'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(analyticsComparisonToolDefinitions[0]!.name).toBe('compare_analytics');
  });
  it('forwards MCP resource grants to both period snapshots and refuses oversized complete results', async () => {
    const scopedActor = { ...actor, allowedChannelIds: ['allowed-1'] as const, maxResultItems: 1 };
    const input = { mode: 'period', a: { start: '2026-10-08', end: '2026-10-14' }, b: { start: '2026-10-01', end: '2026-10-07' } };
    state.snapshots = [snap([metric({ key: 'one' }), metric({ key: 'two' })]), snap([metric({ key: 'one' }), metric({ key: 'two' })])];
    await expect(readAnalyticsComparison(scopedActor, input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.calls.map(c => c.constraints)).toEqual([
      { feature: 'analytics/compare', allowedChannelIds: ['allowed-1'] },
      { feature: 'analytics/compare', allowedChannelIds: ['allowed-1'] },
    ]);
  });
  it('refuses an explicitly Root-truncated comparison to MCP rather than returning a partial list', async () => {
    const scopedActor = { ...actor, maxResultItems: 100 };
    const input = { mode: 'period', a: { start: '2026-10-08', end: '2026-10-14' }, b: { start: '2026-10-01', end: '2026-10-07' } };
    const many = Array.from({ length: 11 }, (_, i) => metric({ key: `metric-${i}` }));
    state.snapshots = [snap(many), snap(many)];
    await expect(readAnalyticsComparison(scopedActor, input)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('config tuples', () => {
  it('are active and have valid defaults', () => {
    for (const e of [...DEMOGRAPHICS_CONFIG, ...PINNED_METRIC_CONFIG, ...COMPARISON_CONFIG]) { expect(e.consumption).toBe('active'); expect(e.schema.safeParse(e.defaultValue).success).toBe(true); }
  });
});
