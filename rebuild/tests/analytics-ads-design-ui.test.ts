// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountCharts } from '../src/modules/ads/ui/AccountCharts';
import { MetricPicker } from '../src/modules/analytics/ui/AnalyticsFilters';
import AnalyticsMetric from '../src/modules/analytics/ui/AnalyticsMetric';
import type { MetricView } from '../src/modules/analytics/server/aggregate';
import type { AdsSummary } from '../src/modules/ads/server/summary';
const metric: MetricView = { key: 'audience', label: 'Audience', sourceLabel: 'Studio', resourceKind: 'channel', kind: 'stock', unit: 'count', aggregationLabel: 'Latest count', total: 12, coverage: 1, available: 2, latestAt: null,
  points: [{ date: '2026-10-01', label: 'Oct 1', value: 10 }, { date: '2026-10-02', label: 'Oct 2', value: 12 }], rows: [] };
const row: AdsSummary = { key: 'account', level: 'account', id: 'account', name: 'Studio', accountId: 'account', accountName: 'Studio', currency: 'EUR', spend: 15, impressions: 200, clicks: 10, reach: 100, reachDate: new Date('2026-10-01Z'), cpc: 1.5, cpm: 75, cpp: null, ctr: 5, frequency: null, actions: [{ name: 'click', value: 10 }, { name: 'purchase', value: 2 }], fields: {}, fieldsDate: new Date('2026-10-01Z'), rows: 1,
  dailyMetrics: [{ date: new Date('2026-10-01Z'), fetchedAt: null, spend: 15, impressions: 200, clicks: 10, reach: 100, cpc: 1.5, cpm: 75, cpp: null, ctr: 5, frequency: null, actions: [], fields: {} }] };
describe('Analytics and Ads shared design adoption', () => {
  it('retains coverage and semantics alongside shared metric cards and series', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsMetric, { metric, chartPoints: 1 }));
    expect(html).toContain('ui-metric'); expect(html).toContain('1 of 2 channels covered');
    expect(html).toContain('Latest count'); expect(html).toContain('Latest 1 of 2 stored dates');
    expect(html).toContain('Missing values are unknown, not zero'); expect(html).toContain('Oct 2, 2026');
  });
  it('keeps unknown aggregates unavailable', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsMetric, { metric: { ...metric, total: null, points: [] }, chartPoints: 1 }));
    expect(html).toContain('is-unavailable'); expect(html).toContain('No aggregate value');
  });
  it('formats currency and CTR without fabricating results from overlapping action types', () => {
    const node = document.createElement('div'); node.innerHTML = renderToStaticMarkup(createElement(AccountCharts, { row }));
    expect(node.querySelectorAll('.ui-metric')).toHaveLength(5); expect(node.textContent).toContain('€15.00');
    expect(node.textContent).toContain('5%'); expect(node.textContent).toContain('Results are unavailable as a comparable measure');
    expect(node.querySelectorAll('table').length).toBeGreaterThan(0);
  });
  it('provides French chart labels and unknown-currency context', () => {
    const html = renderToStaticMarkup(createElement(AccountCharts, { row: { ...row, currency: null }, locale: 'fr' }));
    expect(html).toContain('Dépenses'); expect(html).toContain('Devise indisponible'); expect(html).toContain('Résultats');
  });
  it('opens metric choices and submits the selected key through a native form', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement('form', null, createElement(MetricPicker, { label: 'Metric', initial: '', options: [{ key: 'views', label: 'Views', sourceLabel: 'Studio' }] }))));
      await act(async () => (host.querySelector('[role="combobox"]') as HTMLElement).click());
      const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent?.includes('Views'))!;
      expect(option.textContent).toContain('Studio'); await act(async () => option.click());
      expect(new FormData(host.querySelector('form')!).get('metric')).toBe('views');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
