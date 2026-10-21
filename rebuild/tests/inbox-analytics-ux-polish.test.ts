// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnalyticsMetric from '../src/modules/analytics/ui/AnalyticsMetric';
import type { MetricView } from '../src/modules/analytics/server/aggregate';

const read = (path: string) => readFileSync(path, 'utf8');
const metric: MetricView = { key: 'audience', label: 'Audience', sourceLabel: 'Studio', resourceKind: 'channel', kind: 'stock', unit: 'count', aggregationLabel: 'Latest count', total: 12, coverage: 2, available: 2, latestAt: null,
  updatedAt: new Date('2026-10-02T10:00:00Z'),
  points: [{ date: '2026-10-01', label: 'Oct 1', value: 10 }, { date: '2026-10-02', label: 'Oct 2', value: 12 }], rows: [] } as MetricView;

describe('Analytics metric card polish', () => {
  it('wraps the chart so it has its own legible region', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsMetric, { metric, chartPoints: 2 }));
    expect(html).toMatch(/class="analytics-chart"/);
  });
  it('formats the last-synced date in the viewer language', () => {
    const fr = renderToStaticMarkup(createElement(AnalyticsMetric, { metric, chartPoints: 2, locale: 'fr' }));
    expect(fr).toContain('oct. 2026');
    expect(fr).not.toContain('Oct 2, 2026');
  });
  it('keeps an unknown aggregate unavailable rather than zero', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsMetric, { metric: { ...metric, total: null, points: [] }, chartPoints: 2 }));
    expect(html).toContain('No aggregate value');
    expect(html).toContain('No dated series is stored for this metric.');
  });
});

describe('Inbox and Analytics stylesheets', () => {
  const inbox = read('src/modules/inbox/ui/inbox.module.css');
  const bulk = read('src/modules/inbox/ui/inbox-round3.module.css');
  const analytics = read('src/modules/analytics/ui/analytics.css');
  const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('shows keyboard focus on every Inbox link and checkbox it styles', () => {
    expect(inbox).toContain('.pagination a:focus-visible');
    expect(inbox).toContain('.back:focus-visible');
    expect(bulk).toContain('.selectBox:focus-visible');
  });
  it('gives phone Inbox rows, bulk actions and pagination 44px targets and a stacking bulk bar', () => {
    expect(inbox).toMatch(/@media \(max-width: 900px\), \(pointer: coarse\) \{\s*\.pagination a[^}]*min-height: 44px/);
    expect(bulk).toMatch(/\.bulkActions > button \{[^}]*min-height: 44px/);
  });
  it('marks selected Inbox rows without relying on colour alone being the only state', () => {
    expect(bulk).toContain('.row:has(.selectBox:checked)');
    expect(bulk).toMatch(/forced-colors: active\) \{ \.row:has/);
  });
  it('uses square quick-filter toggles that wrap their label instead of truncating it', () => {
    const quick = bulk.slice(bulk.lastIndexOf('.quickToggle {'));
    expect(quick).toContain('white-space: normal');
    expect(quick).toContain('border-radius: var(--radius-sm)');
  });
  it('makes Analytics tables keyboard-scrollable, right-aligned for numbers and stacked on phones', () => {
    expect(analytics).toContain('.analytics-table-wrap:focus-visible');
    expect(analytics).toContain('.analytics-table td:not(:first-child)');
    expect(analytics).toMatch(/max-width: 620px\) \{[\s\S]*\.report-row \{ flex-direction: column/);
  });
  it('colours chart accents from theme tokens, never raw colours', () => {
    for (const css of [inbox, bulk, analytics]) {
      const rules = withoutComments(css.slice(css.indexOf('UX polish')));
      expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rules).not.toMatch(/\brgba?\(/);
    }
    expect(analytics).toContain('fill: var(--chart-1, var(--accent))');
  });
});
