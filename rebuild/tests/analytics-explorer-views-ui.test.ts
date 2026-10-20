// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/components/charts', () => ({ TimeSeriesChart: (props: unknown) => createElement('div', { 'data-chart': JSON.stringify(props) }) }));
import { MetricViews } from '../src/modules/analytics/ui/explorer/MetricViews';

describe('Explorer chart and table views', () => {
  it('uses ratio units for percent charts while preserving source values in the table', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(MetricViews, { label: 'Engagement', unit: 'percent', locale: 'fr', points: [{ date: '2026-10-01', value: 25 }] })));
      const chart = JSON.parse(host.querySelector('[data-chart]')!.getAttribute('data-chart')!);
      expect(chart.series[0].points).toEqual([{ t: '2026-10-01', v: .25 }]);
      expect(chart.format).toEqual({ style: 'percent' });
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Graphique');
      const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      await act(async () => tabs[1]!.click());
      expect(host.querySelector('table')?.textContent).toContain('25%');
      expect(host.querySelector('table')?.textContent).toContain('2026-10-01');
      expect(host.querySelector('.ui-table--stack')).toBeTruthy();
      await act(async () => tabs[0]!.click());
      expect(host.querySelector('[data-chart]')).toBeTruthy();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
