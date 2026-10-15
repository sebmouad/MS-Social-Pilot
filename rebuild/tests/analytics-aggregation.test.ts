import { describe, expect, it } from 'vitest';
import { buildAnalytics, latestAudience } from '../src/server/analytics/aggregate';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('analytics aggregation', () => {
  it('adds one latest stock audience value per selected Page and reports missing Pages', () => {
    const rows = [
      { metric: 'page_follows', numeric: 120, endTime: date('2026-10-12'), fetchedAt: date('2026-10-13'), target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_fans', numeric: 119, endTime: date('2026-10-12'), fetchedAt: date('2026-10-13'), target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_follows', numeric: 80, endTime: date('2026-10-11'), fetchedAt: date('2026-10-12'), target: { id: 'p2', name: 'Page Two' } },
    ];
    expect(latestAudience(rows, ['p1', 'p2', 'p3'])).toMatchObject({ total: 200, covered: 2, selected: 3 });
    expect(latestAudience(rows, ['p1']).entries[0]?.metric).toBe('page_follows');
  });

  it('discovers Page metrics, sums daily flows, and keeps stock metrics at their latest values', () => {
    const pageRows = [
      { metric: 'page_daily_follows_unique', endTime: date('2026-10-01'), numeric: 4, value: 4, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_daily_follows_unique', endTime: date('2026-10-02'), numeric: 5, value: 5, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_daily_follows_unique', endTime: date('2026-10-02'), numeric: 3, value: 3, target: { id: 'p2', name: 'Page Two' } },
      { metric: 'page_follows', endTime: date('2026-10-01'), numeric: 90, value: 90, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_follows', endTime: date('2026-10-02'), numeric: 100, value: 100, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_follows', endTime: date('2026-10-02'), numeric: 60, value: 60, target: { id: 'p2', name: 'Page Two' } },
    ];
    const result = buildAnalytics(pageRows, [], [], [{ id: 'p1', type: 'page', name: 'Page One' }, { id: 'p2', type: 'page', name: 'Page Two' }]);
    expect(result.metrics.find(metric => metric.key.startsWith('page_daily_follows_unique::'))?.total).toBe(12);
    expect(result.metrics.find(metric => metric.key.startsWith('page_follows::'))?.total).toBe(160);
    expect(result.metrics.map(metric => metric.key)).toEqual(expect.arrayContaining(['page_follows::day', 'page_daily_follows_unique::day']));
  });


  it('builds ad metrics from account-level stored delivery and discovers retained fields and actions', () => {
    const base = { date: date('2026-10-01'), spend: 20, impressions: 1000, clicks: 25, reach: 700, cpc: 0.8, cpm: 20, cpp: 0.03, ctr: 2.5, frequency: 1.4, fetchedAt: date('2026-10-02'), adAccount: { id: 'a1', name: 'Account One', currency: 'USD' } };
    const rows = [
      { ...base, fields: { quality_ranking: 2 }, actions: { actions: [{ action_type: 'link_click', value: '25' }] } },
      { ...base, date: date('2026-10-02'), spend: 10, impressions: 500, clicks: 5, reach: 400, fields: { quality_ranking: 3 }, actions: { actions: [{ action_type: 'link_click', value: '5' }] } },
    ];
    const result = buildAnalytics([], rows, [], [{ id: 'p1', type: 'page', name: 'Page One' }], 2);
    expect(result.metrics.find(metric => metric.key === 'spend')?.total).toBe(30);
    expect(result.metrics.find(metric => metric.key === 'ctr')?.total).toBeCloseTo(2.5);
    expect(result.metrics.find(metric => metric.key === 'quality_ranking')?.coverage).toBe(1);
    expect(result.metrics.find(metric => metric.key === 'quality_ranking')?.available).toBe(2);
    expect(result.metrics.find(metric => metric.key === 'actions:link_click')?.total).toBe(30);
  });

  it('keeps same-named ad accounts separate and reads direct action arrays', () => {
    const base = { date: date('2026-10-01'), spend: 10, impressions: 100, clicks: 4, reach: 50, cpc: 2.5, cpm: 100, cpp: 0.2, ctr: 4, frequency: 2, fetchedAt: date('2026-10-02'), fields: {} };
    const rows = [
      { ...base, adAccount: { id: 'a1', name: 'Main', currency: 'USD' }, actions: [{ action_type: 'link_click', value: '4' }] },
      { ...base, adAccount: { id: 'a2', name: 'Main', currency: 'USD' }, actions: [{ action_type: 'link_click', value: '3' }] },
    ];
    const metrics = buildAnalytics([], rows, [], [], 2).metrics;
    expect(metrics.find(metric => metric.key === 'reach')).toMatchObject({ total: 100, coverage: 2 });
    expect(metrics.find(metric => metric.key === 'spend')).toMatchObject({ total: 20, coverage: 2 });
    expect(metrics.find(metric => metric.key === 'actions:link_click')).toMatchObject({ total: 7, label: 'Actions Link Click' });
  });
});
