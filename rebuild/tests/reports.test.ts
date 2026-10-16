import { describe, expect, it } from 'vitest';
import { buildReportOverview, reportOverviewCsv } from '../src/server/analytics/reports';

describe('reports overview and CSV', () => {
  it('adds audience once for each selected channel and excludes unselected audience', () => {
    const data = {
      targets: [], selectedTargets: [], adAccounts: [], selectedAdIds: [], adAccountCount: 0,
      metrics: [],
      audienceEntries: [
        { id: 'channel-a', name: 'Channel A', metric: 'followers', metricLabel: 'Followers', sourceLabel: 'Community', value: 12, asOf: new Date('2026-10-14T00:00:00Z'), fetchedAt: new Date('2026-10-14T01:00:00Z') },
        { id: 'channel-b', name: 'Channel B', metric: 'subscribers', metricLabel: 'Subscribers', sourceLabel: 'Video', value: 30, asOf: new Date('2026-10-14T00:00:00Z'), fetchedAt: new Date('2026-10-14T01:00:00Z') },
      ], audienceSelected: 3, range: { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-31T23:59:59Z') },
    } as Parameters<typeof buildReportOverview>[0];
    const view = buildReportOverview(data);
    expect(view.audience.total).toBe(42);
    expect(view.audience.entries.map(row => row.id)).toEqual(['channel-a', 'channel-b']);
    expect(view.audience.selected).toBe(3);
  });

  it('quotes provider text and caps large exports with an explicit truncation marker', () => {
    const view = {
      audience: { entries: [], total: 0, covered: 0, selected: 0 },
      metrics: [{ key: 'reach::day', label: '=Injected', sourceLabel: 'Community', resourceKind: 'channel', aggregationLabel: 'Total over the selected period', unit: 'count', kind: 'flow', total: 5, latestAt: null, coverage: 1, available: 1,
        points: [{ date: '2026-10-01', label: 'Oct 1', value: 5 }, { date: '2026-10-02', label: 'Oct 2', value: 6 }], rows: [] }],
    } as ReturnType<typeof buildReportOverview>;
    const result = reportOverviewCsv(view, 1);
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.csv).toContain("'=Injected");
    expect(result.csv).toContain('"truncated","true"');
    const capped = reportOverviewCsv(view, 5001);
    expect(capped.truncated).toBe(false);
  });
});

it('exports complete metric detail and comparison provenance independently of visible pagination', async () => {
  const { analyticsSnapshotCsv } = await import('../src/server/analytics/reports');
  const snapshot = {
    period: { start: '2026-10-01', end: '2026-10-02', comparison: { start: '2026-09-29', end: '2026-09-30', mode: 'previous' } },
    audience: { entries: [], total: 0, covered: 0, selected: 0 },
    allMetrics: [{ key: 'module:metric', label: '=Unsafe', sourceLabel: 'Source', unit: 'count', kind: 'flow', total: 12, coverage: 1, available: 1, aggregationLabel: 'Total over the selected period', latestAt: null, points: [{ date: '2026-10-01', value: 5 }, { date: '2026-10-02', value: 7 }], rows: [{ label: 'Channel', value: 12, asOf: null }] }],
    comparisons: { 'module:metric': { previous: 8, delta: 4, percent: 50, status: 'comparable' } },
  } as unknown as Parameters<typeof analyticsSnapshotCsv>[0];
  const result = analyticsSnapshotCsv(snapshot, 100);
  expect(result.truncated).toBe(false);
  expect(result.csv).toContain('comparison_status');
  expect(result.csv).toContain('2026-09-29');
  expect(result.csv).toContain("'=Unsafe");
  expect(result.csv).toContain('"comparable","8","4","50"');
  expect(result.csv).toContain('2026-10-02');
  const capped = analyticsSnapshotCsv(snapshot, 1);
  expect(capped.rowCount).toBe(1); expect(capped.truncated).toBe(true);
});
