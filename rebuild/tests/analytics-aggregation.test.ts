import { describe, expect, it, vi } from 'vitest';
import { buildAnalytics } from '../src/server/analytics/aggregate';
import type { AnalyticsMetricInput } from '../src/server/analytics/catalog';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const input = (overrides: Partial<AnalyticsMetricInput>): AnalyticsMetricInput => ({
  key: 'metric', label: 'Metric', sourceLabel: 'Channel performance', kind: 'flow', unit: 'count', observations: [], available: 1, ...overrides,
});

describe('provider-neutral analytics aggregation', () => {
  it('adds daily flows, uses one latest stock value per channel, and sorts chart points by date', () => {
    const result = buildAnalytics([
      input({ key: 'daily', kind: 'flow', observations: [
        { date: date('2026-10-02'), channelId: 'a', channelLabel: 'A', value: 5 },
        { date: date('2026-10-01'), channelId: 'a', channelLabel: 'A', value: 4 },
        { date: date('2026-10-02'), channelId: 'b', channelLabel: 'B', value: 3 },
      ] }),
      input({ key: 'followers', kind: 'stock', observations: [
        { date: date('2026-10-01'), channelId: 'a', channelLabel: 'A', value: 90 },
        { date: date('2026-10-02'), channelId: 'a', channelLabel: 'A', value: 100 },
        { date: date('2026-10-02'), channelId: 'b', channelLabel: 'B', value: 60 },
      ] }),
    ], [], 0);
    expect(result.metrics.find(metric => metric.key === 'daily')).toMatchObject({ total: 12, points: [{ date: '2026-10-01', value: 4 }, { date: '2026-10-02', value: 8 }] });
    expect(result.metrics.find(metric => metric.key === 'followers')).toMatchObject({ total: 160, rows: [{ value: 100 }, { value: 60 }] });
  });

  it('retains category breakdowns without inventing a numeric total', () => {
    const result = buildAnalytics([input({ key: 'countries', kind: 'breakdown', covered: 2, rows: [
      { label: 'US', value: 12, asOf: null }, { label: 'CA', value: 5, asOf: null },
    ] })], [], 2);
    expect(result.metrics[0]).toMatchObject({ kind: 'breakdown', total: null, coverage: 2, rows: [{ label: 'US', value: 12 }, { label: 'CA', value: 5 }] });
  });

  it('does not add overlapping window values from non-daily flow series', () => {
    const result = buildAnalytics([input({ key: 'views::week', kind: 'flow', rollup: 'latest-per-channel', observations: [
      { date: date('2026-10-01'), channelId: 'a', channelLabel: 'A', value: 40 },
      { date: date('2026-10-02'), channelId: 'a', channelLabel: 'A', value: 45 },
    ] })], [], 0);
    expect(result.metrics[0]).toMatchObject({ key: 'views::week', total: 45, rows: [{ value: 45 }], points: [{ value: 40 }, { value: 45 }] });
  });

  it('uses provider-normalized weighted ratios and supports mixed-currency totals', () => {
    const result = buildAnalytics([
      input({ key: 'ctr', kind: 'ratio', unit: 'percent', observations: [
        { date: date('2026-10-01'), channelId: 'total', channelLabel: 'Selected accounts', value: 2.5 },
      ], totalObservations: [{ date: date('2026-10-01'), value: 2.5 }], rows: [{ label: 'Account A', value: 4, asOf: date('2026-10-01') }, { label: 'Account B', value: 1, asOf: date('2026-10-01') }] }),
      input({ key: 'spend', kind: 'flow', unit: 'currency', observations: [], totalOverride: null, displayTotal: 'Multiple currencies' }),
    ], [], 0);
    expect(result.metrics.find(metric => metric.key === 'ctr')).toMatchObject({ total: 2.5, rows: [{ value: 4 }, { value: 1 }] });
    expect(result.metrics.find(metric => metric.key === 'spend')).toMatchObject({ total: null, displayTotal: 'Multiple currencies' });
  });

  it('preserves provider covered resource IDs and infers ordinary IDs without synthetic ratio totals', () => {
    const result = buildAnalytics([
      input({ key: 'accounts-ratio', kind: 'ratio', observations: [
        { date: date('2026-10-01'), channelId: 'total', channelLabel: 'Selected accounts', value: 2 },
      ], coveredResourceIds: ['account-a', 'account-b'] }),
      input({ key: 'generic', observations: [
        { date: date('2026-10-01'), channelId: 'b', channelLabel: 'B', value: 2 },
        { date: date('2026-10-01'), channelId: 'a', channelLabel: 'A', value: 3 },
      ] }),
    ], [], 0);
    expect(result.metrics.find(metric => metric.key === 'accounts-ratio')?.coveredResourceIds).toEqual(['account-a', 'account-b']);
    expect(result.metrics.find(metric => metric.key === 'generic')?.coveredResourceIds).toEqual(['a', 'b']);
  });

  it('formats chart day labels in UTC', () => {
    const formatter = vi.spyOn(Date.prototype, 'toLocaleDateString');
    try {
      const result = buildAnalytics([input({ observations: [
        { date: date('2026-10-01'), channelId: 'a', channelLabel: 'A', value: 1 },
      ] })], [], 0);
      expect(result.metrics[0]?.points[0]?.label).toBe('Oct 1');
      expect(formatter).toHaveBeenCalledWith(undefined, expect.objectContaining({ timeZone: 'UTC' }));
    } finally {
      formatter.mockRestore();
    }
  });

  it('adds normalized audience snapshots and reports selected-channel coverage', () => {
    const entry = { id: 'channel-a', name: 'A', metric: 'followers', metricLabel: 'Followers', sourceLabel: 'Channel performance', value: 91, asOf: date('2026-10-02'), fetchedAt: date('2026-10-03') };
    expect(buildAnalytics([], [entry], 2).audience).toMatchObject({ total: 91, covered: 1, selected: 2, entries: [entry] });
  });

  it('combines fictional provider inputs by neutral provenance while preserving independent coverage', () => {
    const firstAudience = { id: 'network-a', name: 'Network A', metric: 'audience', metricLabel: 'Followers', sourceLabel: 'Community', value: 20, asOf: date('2026-10-02'), fetchedAt: date('2026-10-03') };
    const secondAudience = { id: 'network-b', name: 'Network B', metric: 'subscribers', metricLabel: 'Subscribers', sourceLabel: 'Video', value: 30, asOf: date('2026-10-02'), fetchedAt: date('2026-10-03') };
    const result = buildAnalytics([
      input({ key: 'audience', label: 'Followers', sourceLabel: 'Community', kind: 'stock', observations: [{ date: date('2026-10-02'), channelId: 'network-a', channelLabel: 'Network A', value: 20 }], available: 2 }),
      input({ key: 'plays', label: 'Plays', sourceLabel: 'Video', kind: 'flow', observations: [{ date: date('2026-10-02'), channelId: 'network-b', channelLabel: 'Network B', value: 8 }], available: 1 }),
    ], [firstAudience, secondAudience], 3);
    expect(result.metrics.map(metric => [metric.sourceLabel, metric.coverage, metric.available])).toEqual([['Community', 1, 2], ['Video', 1, 1]]);
    expect(result.audience).toMatchObject({ total: 50, covered: 2, selected: 3 });
  });
});
