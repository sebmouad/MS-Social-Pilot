import { describe, expect, it } from 'vitest';
import { buildTimeSeriesModel } from '../src/components/charts/TimeSeriesChart';
import { buildBarModel } from '../src/components/charts/BarChart';
import { buildDonutModel } from '../src/components/charts/DonutChart';
import { buildHeatmapModel } from '../src/components/charts/HeatmapChart';
import { buildFunnelModel } from '../src/components/charts/FunnelChart';
import { buildSparklineModel } from '../src/components/charts/Sparkline';
import { buildPyramidModel } from '../src/components/charts/AudiencePyramid';
import { trendMode } from '../src/components/charts/TrendChart';
import { numberFormatter, dateFormatters, UNKNOWN } from '../src/components/charts/format';
import type { ChartEnv } from '../src/components/charts/theme';

const env: ChartEnv = {
  reducedMotion: false,
  theme: { palette: ['#p1', '#p2', '#p3'], grid: '#grid', text: '#text', surface: '#surface', accent: '#accent', ink: '#ink', inkSoft: '#soft', line: '#line' },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Opt = any;
const opt = (model: { option: (e: ChartEnv) => unknown }, e = env): Opt => model.option(e);

describe('formatting', () => {
  it('formats with Intl per locale and treats missing values as unknown', () => {
    expect(numberFormatter('en')(1234.5)).toBe('1,234.5');
    expect(numberFormatter('fr')(1234.5)).toMatch(/1\s234,5/);
    expect(numberFormatter('en', { style: 'percent' })(0.255)).toBe('25.5%');
    expect(numberFormatter('en', { style: 'currency', currency: 'EUR' })(3)).toBe('€3.00');
    expect(numberFormatter('en')(null)).toBe(UNKNOWN);
    expect(numberFormatter('en')(Number.NaN)).toBe(UNKNOWN);
  });
  it('formats dates in the requested zone, UTC by default', () => {
    const t = Date.UTC(2026, 9, 5, 23, 30);
    expect(dateFormatters('en', 'day').full(t)).toBe('Oct 5, 2026');
    expect(dateFormatters('en', 'day', 'Africa/Casablanca').full(t)).toBe('Oct 6, 2026');
    expect(dateFormatters('fr', 'month').full(t)).toBe('octobre 2026');
  });
});

describe('TimeSeries model', () => {
  const series = [{
    id: 'reach', name: 'Reach', color: 2,
    points: [{ t: '2026-10-01', v: 10 }, { t: '2026-10-02', v: null }, { t: '2026-10-03', v: 30 }],
    comparison: [{ t: '2026-09-01', v: 5 }, { t: '2026-09-02', v: 6 }, { t: '2026-09-03', v: 7 }],
  }, { id: 'clicks', name: 'Clicks', points: [{ t: '2026-10-01', v: 1 }, { t: '2026-10-03', v: 3 }] }];

  it('maps series, dashed comparison, theme palette and gaps for unknown values', () => {
    const model = buildTimeSeriesModel({ label: 'x', series, comparisonLabel: 'last month' });
    const o = opt(model);
    expect(o.series).toHaveLength(3);
    expect(o.series[0].data).toEqual([10, null, 30]);
    expect(o.series[0].connectNulls).toBe(false);
    expect(o.series[0].lineStyle.color).toBe('#p3');
    expect(o.series[1].name).toBe('Reach · last month');
    expect(o.series[1].lineStyle.type).toBe('dashed');
    expect(o.series[1].data).toEqual([5, 6, 7]);
    expect(o.series[2].data).toEqual([1, null, 3]);
    expect(o.series[2].lineStyle.color).toBe('#p2'); // position 1 -> second color
    expect(o.color).toEqual(['#p1', '#p2', '#p3']);
    expect(o.yAxis.splitLine.lineStyle.color).toBe('#grid');
    expect(o.legend.show).not.toBe(false);
    expect(model.focusCount).toBe(3);
  });
  it('stacks, fills and disables animation for reduced motion', () => {
    const o = opt(buildTimeSeriesModel({ label: 'x', series: [series[1]!, { ...series[1]!, id: 'c2' }], stacked: true }), { ...env, reducedMotion: true });
    expect(o.animation).toBe(false);
    expect(o.series.every((s: Opt) => s.stack === 'total' && s.areaStyle)).toBe(true);
  });
  it('builds the table with locale-formatted dates and unknown cells', () => {
    const { table } = buildTimeSeriesModel({ label: 'x', series, locale: 'fr', comparisonLabel: 'mois dernier' });
    expect(table.columns).toEqual(['Date', 'Reach', 'Clicks', 'Reach · mois dernier']);
    expect(table.rows[0]![0]).toBe('1 oct. 2026');
    expect(table.rows[1]).toEqual(['2 oct. 2026', UNKNOWN, UNKNOWN, '6']);
  });
  it('is empty without any known value', () => {
    expect(buildTimeSeriesModel({ label: 'x', series: [] }).empty).toBe(true);
    expect(buildTimeSeriesModel({ label: 'x', series: [{ id: 'a', name: 'A', points: [{ t: '2026-10-01', v: null }] }] }).empty).toBe(true);
  });
});

describe('Bar model', () => {
  it('swaps axes for horizontal bars and stacks', () => {
    const model = buildBarModel({ label: 'x', categories: ['A', 'B'], series: [{ id: 's', name: 'S', values: [1, null] }, { id: 't', name: 'T', values: [2, 3] }], orientation: 'horizontal', stacked: true });
    const o = opt(model);
    expect(o.yAxis.type).toBe('category');
    expect(o.yAxis.inverse).toBe(true);
    expect(o.xAxis.type).toBe('value');
    expect(o.series.map((s: Opt) => s.stack)).toEqual(['total', 'total']);
    expect(model.table.rows).toEqual([['A', '1', '2'], ['B', UNKNOWN, '3']]);
  });
  it('keeps vertical orientation by default', () => {
    const o = opt(buildBarModel({ label: 'x', categories: ['A'], series: [{ id: 's', name: 'S', values: [1] }] }));
    expect(o.xAxis.type).toBe('category');
    expect(o.legend.show).toBe(false);
  });
});

describe('Donut model', () => {
  it('shows a centre total, skips unknown slices and tabulates shares', () => {
    const model = buildDonutModel({ label: 'x', slices: [{ name: 'A', value: 30 }, { name: 'B', value: 10 }, { name: 'C', value: null }], totalLabel: 'Posts' });
    const o = opt(model);
    expect(o.graphic[0].style.text).toBe('40\nPosts');
    expect(o.series[0].data.map((d: Opt) => d.name)).toEqual(['A', 'B']);
    expect(o.series[0].data[1].itemStyle.color).toBe('#p2');
    expect(model.table.rows).toEqual([['A', '30', '75%'], ['B', '10', '25%'], ['C', UNKNOWN, null]]);
    expect(buildDonutModel({ label: 'x', slices: [{ name: 'A', value: 0 }] }).empty).toBe(true);
  });
});

describe('Heatmap model', () => {
  const cells = [{ day: 1, hour: 9, value: 4 }, { day: 0, hour: 18, value: 10 }, { day: 3, hour: 3, value: null }];
  it('orders rows from the week start and maps cells to [hour, row, value]', () => {
    const o = opt(buildHeatmapModel({ label: 'x', cells, weekStart: 1 }));
    expect(o.yAxis.data[0]).toBe('Mon');
    expect(o.yAxis.data[6]).toBe('Sun');
    expect(o.series[0].data).toEqual([[9, 0, 4], [18, 6, 10]]);
    expect(o.visualMap.min).toBe(4);
    expect(o.visualMap.max).toBe(10);
    expect(o.visualMap.inRange.color).toEqual(['#surface', '#accent']);
  });
  it('tabulates a weekday x hour matrix with unknown for missing cells', () => {
    const { table } = buildHeatmapModel({ label: 'x', cells, weekStart: 1 });
    expect(table.columns).toHaveLength(25);
    expect(table.rows[0]![10]).toBe('4');
    expect(table.rows[0]![1]).toBe(UNKNOWN);
  });
  it('escapes tooltip text', () => {
    const o = opt(buildHeatmapModel({ label: 'x', cells, valueLabel: '<b>Reach</b>', weekStart: 0 }));
    expect(o.tooltip.formatter({ value: [9, 1, 4] })).toContain('&lt;b&gt;Reach&lt;/b&gt;');
  });
});

describe('Funnel model', () => {
  it('computes step and overall conversion, unknown without a denominator', () => {
    const model = buildFunnelModel({ label: 'x', stages: [{ name: 'Impressions', value: 1000 }, { name: 'Clicks', value: 100 }, { name: 'Results', value: 25 }] });
    expect(model.table.rows[1]).toEqual(['Clicks', '100', '10%', '10%']);
    expect(model.table.rows[2]).toEqual(['Results', '25', '25%', '2.5%']);
    expect(opt(model).series[0].sort).toBe('none');
    const zero = buildFunnelModel({ label: 'x', stages: [{ name: 'A', value: 0 }, { name: 'B', value: 5 }] });
    expect(zero.table.rows[1]).toEqual(['B', '5', null, null]);
  });
  it('places narrow-stage labels outside in ink so they never overflow their segment', () => {
    const model = buildFunnelModel({ label: 'x', stages: [{ name: 'Impressions', value: 6300 }, { name: 'Clicks', value: 178 }] });
    const data = opt(model).series[0].data;
    expect(data[0].label).toBeUndefined();
    expect(data[1].label).toMatchObject({ position: 'right' });
    const wide = buildFunnelModel({ label: 'x', stages: [{ name: 'A', value: 100 }, { name: 'B', value: 80 }] });
    expect(opt(wide).series[0].data[1].label).toBeUndefined();
  });
});

describe('Sparkline model', () => {
  it('draws a bare line without axes', () => {
    const model = buildSparklineModel({ label: 'x', values: [1, null, 3], labels: ['a', 'b', 'c'], area: true, color: 1 });
    const o = opt(model);
    expect(o.xAxis.show).toBe(false);
    expect(o.yAxis.show).toBe(false);
    expect(o.series[0].data).toEqual([1, null, 3]);
    expect(o.series[0].lineStyle.color).toBe('#p2');
    expect(o.series[0].areaStyle).toBeTruthy();
    expect(model.table.rows[1]).toEqual(['b', UNKNOWN]);
  });
});

describe('Trend mode', () => {
  it('draws lines for several days and bars for a single stored day', () => {
    expect(trendMode([{ id: 'a', name: 'A', points: [{ t: '2026-10-22', v: 1 }, { t: '2026-10-23', v: 2 }] }])).toBe('line');
    expect(trendMode([{ id: 'a', name: 'A', points: [{ t: '2026-10-23', v: 1 }] }, { id: 'b', name: 'B', points: [{ t: '2026-10-23', v: 3 }] }])).toBe('bar');
    expect(trendMode([])).toBe('bar');
  });
});

describe('Pyramid model', () => {
  it('mirrors the left side and keeps the axis symmetric', () => {
    const model = buildPyramidModel({ label: 'x', groups: ['18-24', '25-34'], left: { name: 'Women', values: [20, 30] }, right: { name: 'Men', values: [10, null] } });
    const o = opt(model);
    expect(o.series[0].data).toEqual([-20, -30]);
    expect(o.series[1].data).toEqual([10, null]);
    expect(o.xAxis.min).toBe(-30);
    expect(o.xAxis.max).toBe(30);
    expect(o.tooltip.valueFormatter(-20)).toBe('20');
    expect(model.table.rows).toEqual([['18-24', '20', '10'], ['25-34', '30', UNKNOWN]]);
  });
});
