// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), dispatchAction: vi.fn() };
vi.mock('../src/components/charts/echarts-setup', () => ({ init: vi.fn(() => chart) }));

import { buildTimeSeriesModel } from '../src/components/charts/TimeSeriesChart';
import { buildBarModel } from '../src/components/charts/BarChart';
import { buildDonutModel } from '../src/components/charts/DonutChart';
import { fillTimes, groupOther, PALETTE_LIMIT } from '../src/components/charts/series-fit';
import { TimeSeriesChart } from '../src/components/charts';
import type { ChartEnv } from '../src/components/charts/theme';

const env: ChartEnv = { reducedMotion: false, theme: { palette: ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8'], grid: '#g', text: '#t', surface: '#s', accent: '#a', ink: '#i', inkSoft: '#o', line: '#l' } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const option = (model: { option: (e: ChartEnv) => unknown }): any => model.option(env);
const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

describe('chart fixes (design v2 02 §6)', () => {
  it('fills missing days so a gap is drawn as a gap instead of being compressed', () => {
    expect(fillTimes([day('2026-10-01'), day('2026-10-04')], 'day')).toEqual([day('2026-10-01'), day('2026-10-02'), day('2026-10-03'), day('2026-10-04')]);
    expect(fillTimes([day('2026-10-01'), day('2026-10-15')], 'week')).toEqual([day('2026-10-01'), day('2026-10-08'), day('2026-10-15')]);
    expect(fillTimes([day('2026-08-31'), day('2026-10-31')], 'month')).toHaveLength(3);
    expect(fillTimes([day('2026-10-01')], 'day')).toEqual([day('2026-10-01')]);
    // A span too long to draw is returned as given, never expanded without bound.
    expect(fillTimes([0, Date.UTC(2100, 0, 1)], 'day', 100)).toHaveLength(2);
    const model = buildTimeSeriesModel({ label: 'x', series: [{ id: 'a', name: 'A', points: [{ t: '2026-10-01', v: 1 }, { t: '2026-10-04', v: 4 }] }] });
    expect(option(model).series[0].data).toEqual([1, null, null, 4]);
    expect(model.table.rows.map(row => row[1])).toEqual(['1', '—', '—', '4']);
  });

  it('aligns the previous period by date offset, not array position', () => {
    const model = buildTimeSeriesModel({ label: 'x', series: [{
      id: 'a', name: 'A', points: [{ t: '2026-10-08', v: 1 }, { t: '2026-10-09', v: 2 }, { t: '2026-10-10', v: 3 }],
      // The previous period lacks its middle day: the dashed line must show a gap there, not slide the last value left.
      comparison: [{ t: '2026-10-01', v: 10 }, { t: '2026-10-03', v: 30 }],
    }] });
    expect(option(model).series[1].data).toEqual([10, null, 30]);
    // Comparison dates that already sit in the current range are used as they are.
    const same = buildTimeSeriesModel({ label: 'x', series: [{ id: 'a', name: 'A', points: [{ t: '2026-10-08', v: 1 }, { t: '2026-10-09', v: 2 }], comparison: [{ t: '2026-10-09', v: 7 }] }] });
    expect(option(same).series[1].data).toEqual([null, 7]);
  });

  it('adds a marker shape and line pattern per series above two series, so color is not the only cue', () => {
    const three = ['a', 'b', 'c'].map((id, index) => ({ id, name: id, points: [{ t: '2026-10-01', v: index }, { t: '2026-10-02', v: index + 1 }] }));
    const lines = option(buildTimeSeriesModel({ label: 'x', series: three })).series;
    expect(new Set(lines.map((line: { symbol: string }) => line.symbol)).size).toBe(3);
    expect(lines.every((line: { showSymbol: boolean }) => line.showSymbol)).toBe(true);
    expect(new Set(lines.map((line: { lineStyle: { type: string } }) => line.lineStyle.type)).size).toBeGreaterThan(1);
    const two = option(buildTimeSeriesModel({ label: 'x', series: three.slice(0, 2) })).series;
    expect(two.every((line: { lineStyle: { type: string } }) => line.lineStyle.type === 'solid')).toBe(true);
  });

  it('groups slices beyond the palette as Other and keeps unknown values out of the sum', () => {
    const slices = Array.from({ length: 11 }, (_, index) => ({ name: `S${index}`, value: index === 0 ? null : 100 - index }));
    const grouped = groupOther(slices, (_rest, total) => ({ name: 'Other', value: total }));
    expect(grouped).toHaveLength(PALETTE_LIMIT);
    expect(grouped.at(-1)).toEqual({ name: 'Other', value: expect.any(Number) });
    expect(groupOther([{ name: 'a', value: 1 }], () => ({ name: 'x', value: 0 }))).toHaveLength(1);
    const donut = buildDonutModel({ label: 'x', slices, locale: 'fr' });
    expect(donut.table.rows.map(row => row[0])).toContain('Autres');
    expect(donut.table.rows).toHaveLength(PALETTE_LIMIT);
  });

  it('sums only known values into Other for stacked bars, and shows an all-unknown group as unknown', () => {
    const series = Array.from({ length: 10 }, (_, index) => ({ id: `s${index}`, name: `S${index}`, values: [index === 9 ? null : index + 1, index >= 8 ? null : 1] }));
    const model = buildBarModel({ label: 'x', categories: ['A', 'B'], stacked: true, series });
    expect(model.table.columns).toHaveLength(1 + PALETTE_LIMIT);
    expect(model.table.columns.at(-1)).toBe('Other');
    const plain = buildBarModel({ label: 'x', categories: ['A', 'B'], series });
    expect(plain.table.columns).toHaveLength(11);
  });

  it('shows each slice share in the legend', () => {
    const o = option(buildDonutModel({ label: 'x', slices: [{ name: 'A', value: 75 }, { name: 'B', value: 25 }] }));
    expect(o.legend.formatter('A')).toBe('A  75%');
    expect(o.legend.formatter('B')).toBe('B  25%');
    expect(o.legend.formatter('Missing')).toBe('Missing');
  });
});

describe('Show data', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each([['en', 'Show data', 'Hide data'], ['fr', 'Afficher les données', 'Masquer les données']])('reveals the data table to everyone and hides it again in %s', async (locale, show, hide) => {
    await act(async () => root.render(createElement(TimeSeriesChart, { label: 'Reach', locale, series: [{ id: 'a', name: 'Reach', points: [{ t: '2026-10-01', v: 1 }, { t: '2026-10-02', v: 2 }] }] })));
    const toggle = container.querySelector<HTMLButtonElement>('button.ui-chart__toggle')!;
    expect(toggle.textContent).toBe(show);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('table')!.className).toBe('ui-visually-hidden');
    await act(async () => toggle.click());
    expect(toggle.textContent).toBe(hide);
    expect(container.querySelector('table')!.className).toBe('ui-chart__table');
    expect(container.querySelector('.ui-chart__data')!.getAttribute('role')).toBe('region');
    await act(async () => toggle.click());
    expect(container.querySelector('table')!.className).toBe('ui-visually-hidden');
  });

  it('offers no toggle when the table is switched off (sparklines)', async () => {
    await act(async () => root.render(createElement(TimeSeriesChart, { label: 'Reach', table: false, series: [{ id: 'a', name: 'Reach', points: [{ t: '2026-10-01', v: 1 }] }] })));
    expect(container.querySelector('button.ui-chart__toggle')).toBeNull();
  });
});
