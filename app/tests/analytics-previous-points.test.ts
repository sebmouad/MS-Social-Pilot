import { describe, expect, it } from 'vitest';
import { alignPreviousPoints, buildPreviousPoints } from '../src/modules/analytics/server/previous-points';
import { previousSeries } from '../src/modules/analytics/ui/series';
import type { MetricView } from '../src/modules/analytics/server/aggregate';

const metric = (points: Array<{ date: string; value: number }>): MetricView => ({
  key: 'views', label: 'Views', sourceLabel: 'Community', resourceKind: 'channel', aggregationLabel: 'Total', unit: 'count', kind: 'flow', total: 1,
  latestAt: null, coverage: 1, available: 1, points: points.map(point => ({ ...point, label: point.date })), rows: [],
});
const current = { start: '2026-10-10', end: '2026-10-14' };
const previous = { start: '2026-10-05', end: '2026-10-09' };

describe('previous-period alignment', () => {
  it('maps each previous day onto the current day with the same relative index and marks gaps null', () => {
    const aligned = alignPreviousPoints([{ date: '2026-10-05', value: 5 }, { date: '2026-10-07', value: 7 }, { date: '2026-10-09', value: 0 }], current, previous);
    expect(aligned.map(point => [point.date, point.previousDate, point.value])).toEqual([
      ['2026-10-10', '2026-10-05', 5], ['2026-10-11', '2026-10-06', null], ['2026-10-12', '2026-10-07', 7], ['2026-10-13', '2026-10-08', null], ['2026-10-14', '2026-10-09', 0],
    ]);
  });

  it('cuts to the shorter range when the comparison is clamped and returns nothing without data', () => {
    expect(alignPreviousPoints([{ date: '2026-10-05', value: 1 }], current, { start: '2026-10-05', end: '2026-10-06' })).toHaveLength(2);
    expect(alignPreviousPoints([{ date: '2026-10-05', value: 1 }], { start: '2026-10-10', end: '2026-10-11' }, previous)).toHaveLength(2);
    expect(alignPreviousPoints([], current, previous)).toEqual([]);
    expect(alignPreviousPoints([{ date: '2026-09-01', value: 1 }], current, previous)).toEqual([]);
  });

  it('only exposes comparable metrics and none without a comparison period', () => {
    const identity = (item: MetricView) => item.key;
    const now = [metric([])];
    const before = [metric([{ date: '2026-10-05', value: 3 }])];
    expect(buildPreviousPoints(now, before, identity, { views: { status: 'comparable' } }, current, previous).views).toHaveLength(5);
    expect(buildPreviousPoints(now, before, identity, { views: { status: 'coverage_changed' } }, current, previous)).toEqual({});
    expect(buildPreviousPoints(now, before, identity, { views: { status: 'comparable' } }, current, null)).toEqual({});
  });

  it('feeds the chart by current date so gaps stay gaps, scaling percent units', () => {
    const aligned = alignPreviousPoints([{ date: '2026-10-05', value: 50 }], current, previous);
    const series = previousSeries([{ date: '2026-10-10', value: 1 }, { date: '2026-10-12', value: 2 }], aligned, 'percent');
    expect(series).toEqual([{ t: '2026-10-10', v: 0.5 }, { t: '2026-10-12', v: null }]);
  });
});
