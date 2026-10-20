import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), authorize: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: {} }));
vi.mock('@/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: mocks.read }));
vi.mock('@/modules/analytics/server/access', () => ({ authorize: mocks.authorize }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key.endsWith('dimensions') ? [{ id: 'country', label: 'Country', terms: ['country'] }] : 1 }));
import { normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';
import { buildAnalytics } from '../src/modules/analytics/server/aggregate';
import { readDemographics } from '../src/modules/analytics/demographics/server/demographics';
import { executeAnalyticsDemographicsTool } from '../src/modules/analytics/demographics/mcp';

const actor = { userId: 'u', workspaceId: 'w', allowedChannelIds: ['a'] };
const date = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00Z`);
function normalized() {
  const row = (day: number, value: unknown, fetched = day, id = 'a') => ({ metric: 'page_fans_country', period: 'lifetime', endTime: date(day), fetchedAt: date(fetched), numeric: null, value, target: { id, name: id.toUpperCase() } });
  return normalizeFacebookAnalytics({ pageRows: [row(1, { FR: 4, US: 6 }), row(2, { FR: 1 }), row(2, { FR: 3, Unknown: null, '=formula,"': 'bad' }, 3)], audienceRows: [], adRows: [], selectedTargets: [{ id: 'a', name: 'A', type: 'page', socialAccountId: 's' }, { id: 'b', name: 'B', type: 'page', socialAccountId: 's' }], selectedAdAccounts: [] });
}
function snapshot() {
  const n = normalized();
  return { allMetrics: buildAnalytics(n.metrics, [], 2).metrics, exportRowLimit: 100, period: { start: '2026-10-01', end: '2026-10-03' }, selected: { channelIds: ['a', 'b'], adAccountIds: [] }, options: { channels: [], adAccounts: [], metrics: [] }, audience: { total: 0, covered: 0, selected: 2, entries: [] } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(snapshot()); });
describe('stored demographic history', () => {
  it('preserves all stored demographic dimensions and separates periods/resources', () => {
    const pageRows = ['page_fans_gender_age', 'page_fans_country', 'page_fans_city', 'page_fans_locale'].flatMap(metric =>
      ['day', 'lifetime'].flatMap(period => ['a', 'b'].map(id => ({ metric, period, endTime: date(1), fetchedAt: date(2), numeric: null,
        value: { 'original.category': 0 }, target: { id, name: id } }))));
    const result = normalizeFacebookAnalytics({ pageRows, audienceRows: [], adRows: [], selectedTargets: [
      { id: 'a', name: 'A', type: 'page', socialAccountId: 's' }, { id: 'b', name: 'B', type: 'page', socialAccountId: 's' },
    ], selectedAdAccounts: [] });
    expect(result.metrics).toHaveLength(8);
    for (const metric of result.metrics) {
      expect(metric.breakdownHistory).toHaveLength(2);
      expect(metric.breakdownHistory!.map(item => item.resourceId)).toEqual(['a', 'b']);
      expect(metric.breakdownHistory![0]!.rows).toEqual([{ label: 'original.category', value: 0 }]);
    }
  });
  it('retains every date and latest fetch at an exact resource/date, through neutral aggregation', () => {
    const metric = snapshot().allMetrics[0]!;
    expect(metric.breakdownHistory).toHaveLength(2);
    expect(metric.breakdownHistory![0]!.rows).toEqual([{ label: 'FR', value: 4 }, { label: 'US', value: 6 }]);
    expect(metric.breakdownHistory![1]!.fetchedAt).toEqual(date(3));
    expect(metric.breakdownHistory![1]!.rows[0]!.value).toBe(3);
    expect(metric.breakdownHistory![1]!.rows.some(row => row.label === 'US')).toBe(false);
  });
  it('keeps complete history beyond the latest-table cap and reports actual covered channels', async () => {
    const result = await readDemographics(actor);
    const metric = result.groups[0]!.metrics[0]!;
    expect(metric.history[0]!.rows).toHaveLength(2);
    expect(metric.history[0]!.rows[0]!.share).toBe(40);
    expect(metric.history[1]!.rows[1]).toMatchObject({ value: null, share: null });
    expect(metric.history[1]!.rows[0]!.share).toBeNull();
    expect(metric.historyCoverage).toEqual({ covered: 1, selected: 2, oldestAsOf: date(1), newestAsOf: date(2) });
  });
  it('exports every stored category with dates, unknowns and formula-safe CSV through MCP', async () => {
    const result = await executeAnalyticsDemographicsTool(actor, { format: 'csv', start: '2026-10-01', end: '2026-10-03', filter: '1', channel: ['a'] });
    expect(result.csv).toContain('2026-10-01T00:00:00.000Z');
    expect(result.csv).toContain('"US","6","60"');
    expect(result.csv).toContain('"Unknown","Not available","Not available"');
    expect(result.csv).toContain('"\'=formula,"""');
    expect(mocks.read).toHaveBeenCalledWith(actor, { start: '2026-10-01', end: '2026-10-03', filter: '1', channel: ['a'] }, { feature: 'analytics/demographics', allowedChannelIds: ['a'] });
  });
  it('refuses oversized history and MCP results rather than returning partial history', async () => {
    mocks.read.mockResolvedValueOnce({ ...snapshot(), exportRowLimit: 2 });
    await expect(readDemographics(actor)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readDemographics({ ...actor, maxResultItems: 1 }, { format: 'csv' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('enforces current authorization before any snapshot read and rejects malformed formats', async () => {
    mocks.authorize.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'forbidden' }));
    await expect(readDemographics(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.read).not.toHaveBeenCalled();
    await expect(readDemographics(actor, { format: ['csv'] })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
