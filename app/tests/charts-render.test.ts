// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), dispatchAction: vi.fn() };
const init = vi.fn(() => chart);
vi.mock('../src/components/charts/echarts-setup', () => ({ init }));

import { AudiencePyramid, BarChart, DonutChart, FunnelChart, HeatmapChart, Sparkline, TimeSeriesChart } from '../src/components/charts';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function mount(element: Parameters<typeof root.render>[0]) { await act(async () => root.render(element)); await flush(); }
const lastOption = () => chart.setOption.mock.calls.at(-1)![0];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const [index, color] of ['#aa0001', '#aa0002'].entries()) document.documentElement.style.setProperty(`--chart-${index + 1}`, color);
  document.documentElement.style.setProperty('--chart-grid', '#gridcolor');
  Object.values(chart).forEach(fn => fn.mockClear());
  init.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.documentElement.removeAttribute('style'); document.documentElement.removeAttribute('data-theme'); });

const series = [{ id: 'a', name: 'Reach', points: [{ t: '2026-10-01', v: 1 }, { t: '2026-10-02', v: 2 }] }];

describe('chart shell', () => {
  it('lazily inits ECharts, applies the themed option and exposes role=img with the summary', async () => {
    await mount(createElement(TimeSeriesChart, { label: 'Reach over 2 days', series }));
    const host = container.querySelector('[role="img"]')!;
    expect(host.getAttribute('aria-label')).toBe('Reach over 2 days');
    expect(init).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenCalledTimes(1);
    expect(lastOption().color).toEqual(['#aa0001', '#aa0002']);
    expect(lastOption().yAxis.splitLine.lineStyle.color).toBe('#gridcolor');
  });

  it('renders the hidden data table fallback by default and omits it on request', async () => {
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series, locale: 'fr' }));
    const table = container.querySelector('table.ui-visually-hidden')!;
    expect(table.querySelector('caption')!.textContent).toBe('Reach');
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['Date', 'Reach']);
    expect([...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent))).toEqual([['1 oct. 2026', '1'], ['2 oct. 2026', '2']]);
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series, table: false }));
    expect(container.querySelector('table')).toBeNull();
  });

  it('re-renders with new theme colors on the theme-change event', async () => {
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series }));
    document.documentElement.style.setProperty('--chart-1', '#bb0001');
    await act(async () => { window.dispatchEvent(new Event('theme-change')); });
    expect(lastOption().color[0]).toBe('#bb0001');
    expect(chart.setOption).toHaveBeenCalledTimes(2);
  });

  it('re-renders when data-theme changes on <html>', async () => {
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series }));
    document.documentElement.style.setProperty('--chart-2', '#cc0002');
    await act(async () => { document.documentElement.setAttribute('data-theme', 'nightfall'); await Promise.resolve(); });
    await flush();
    expect(lastOption().color[1]).toBe('#cc0002');
  });

  it('does not reapply an identical option on parent re-render, and disposes on unmount', async () => {
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series }));
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series: structuredClone(series) }));
    expect(chart.setOption).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement('div')));
    expect(chart.dispose).toHaveBeenCalledTimes(1);
  });

  it('shows loading, error and empty states instead of a canvas', async () => {
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series, loading: true }));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(init).not.toHaveBeenCalled();
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series, error: 'Provider unavailable', locale: 'fr' }));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Ce graphique n’a pas pu être chargé');
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series: [] }));
    expect(container.textContent).toContain('No data to chart yet');
    expect(container.querySelector('[role="img"]')).toBeNull();
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series: [], emptyTitle: 'Nothing here' }));
    expect(container.textContent).toContain('Nothing here');
  });

  it('shows the tooltip for the focused point with arrow keys', async () => {
    await mount(createElement(TimeSeriesChart, { label: 'Reach', series }));
    const host = container.querySelector<HTMLElement>('[role="img"]')!;
    expect(host.tabIndex).toBe(0);
    await act(async () => { host.focus(); });
    expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'showTip', seriesIndex: 0, dataIndex: 0 });
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'showTip', seriesIndex: 0, dataIndex: 1 });
    await act(async () => { host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'hideTip' });
  });
});

describe('every chart renders its table fallback', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cases: Array<[string, ComponentType<any>, Record<string, unknown>, string[]]> = [
    ['BarChart', BarChart, { categories: ['A', 'B'], series: [{ id: 's', name: 'S', values: [1, 2] }] }, ['Category', 'S']],
    ['DonutChart', DonutChart, { slices: [{ name: 'A', value: 3 }, { name: 'B', value: 1 }] }, ['Category', 'Value', 'Share']],
    ['HeatmapChart', HeatmapChart, { cells: [{ day: 1, hour: 9, value: 2 }], weekStart: 1 }, ['Day']],
    ['FunnelChart', FunnelChart, { stages: [{ name: 'Impressions', value: 10 }, { name: 'Clicks', value: 1 }] }, ['Stage', 'Value', '% of previous stage', '% of first stage']],
    ['Sparkline', Sparkline, { values: [1, 2, 3] }, ['Category', 'Value']],
    ['AudiencePyramid', AudiencePyramid, { groups: ['18-24'], left: { name: 'Women', values: [1] }, right: { name: 'Men', values: [2] } }, ['Category', 'Women', 'Men']],
  ];
  it.each(cases)('%s', async (_name, component, props, headers) => {
    await mount(createElement(component, { label: `${_name} summary`, ...props }));
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(`${_name} summary`);
    const columns = [...container.querySelectorAll('thead th')].map(th => th.textContent);
    expect(columns.slice(0, headers.length)).toEqual(headers);
    expect(chart.setOption).toHaveBeenCalledTimes(1);
  });

  it('Sparkline defaults to a compact height', async () => {
    await mount(createElement(Sparkline, { label: 'Trend', values: [1, 2] }));
    expect(container.querySelector<HTMLElement>('[role="img"]')!.style.height).toBe('40px');
  });
});
