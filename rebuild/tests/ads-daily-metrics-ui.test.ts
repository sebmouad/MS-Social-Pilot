// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyMetrics } from '../src/app/ads/DailyMetrics';
import type { AdsSummary } from '@/modules/ads/server/summary';

type DailyMetric = AdsSummary['dailyMetrics'][number];

const sample: DailyMetric = {
  date: new Date('2026-10-02T00:00:00.000Z'),
  fetchedAt: new Date('2026-10-02T08:34:56.000Z'),
  spend: 12.5,
  impressions: 1200,
  clicks: 30,
  reach: 850,
  cpc: 0.42,
  cpm: 10.42,
  cpp: null,
  ctr: 2.5,
  frequency: 1.5,
  actions: [{ action_type: 'link_click', value: 3 }],
  fields: { custom_measure: 9, authorization: 'Bearer private-token' },
};

function rendered(rows: readonly DailyMetric[]) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(createElement(DailyMetrics, { rows, currency: 'EUR' }));
  return container;
}

describe('Ads daily metric details', () => {
  it('renders every scalar metric, UTC report/fetch dates, currency, and safe stored values semantically', () => {
    const node = rendered([sample]);
    const detail = node.querySelector('details')!;
    expect(detail.querySelector('summary')?.textContent).toBe('2026-10-02 UTC');
    expect(detail.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-02');

    const rows = [...detail.querySelector('.ads-detail-content > .ads-field-group > dl')!.querySelectorAll(':scope > div')];
    const values = Object.fromEntries(rows.map(row => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent]));
    expect(values).toEqual({
      'Report day (UTC)': '2026-10-02 UTC',
      'Fetched at (UTC)': '2026-10-02 08:34:56 UTC',
      Currency: 'EUR',
      Spend: 'EUR 12.50',
      Impressions: '1,200',
      Clicks: '30',
      'Reach (daily, non-additive)': '850',
      CPC: 'EUR 0.42',
      CPM: 'EUR 10.42',
      CPP: 'Not reported',
      CTR: '2.5%',
      Frequency: '1.5',
    });
    expect(detail.textContent).toContain('Link Click');
    expect(detail.textContent).toContain('Custom Measure');
    expect(detail.textContent).toContain('[REDACTED]');
    expect(detail.textContent).not.toContain('private-token');
    expect(detail.querySelector('dl')).not.toBeNull();
  });

  it('labels missing provenance and invalid report dates without fabricating a day or zero value', () => {
    const node = rendered([{ ...sample, date: new Date('invalid'), fetchedAt: null, spend: Number.NaN }]);
    expect(node.querySelector('summary')?.textContent).toBe('Report day unavailable');
    expect(node.querySelector('time')).toBeNull();
    expect(node.textContent).toContain('Fetched at (UTC)');
    expect(node.textContent).toContain('Fetch time unavailable');
    expect(node.textContent).toContain('Spend');
    expect(node.textContent).toContain('Not reported');
    expect(node.textContent).not.toContain('NaN');
  });

  it('keeps the empty daily history state explicit', () => {
    expect(renderToStaticMarkup(createElement(DailyMetrics, { rows: [], currency: null }))).toContain('No daily measures stored.');
  });
});
