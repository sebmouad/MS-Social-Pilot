// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampaignCharts } from '../src/modules/ads/ui/campaigns/CampaignCharts';
import { HierarchyTable, type HierarchyRow } from '../src/modules/ads/ui/campaigns/HierarchyTable';
import type { AdsSummary } from '../src/modules/ads/server/summary';

const css = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const adsCss = css('src/modules/ads/ui/ads.css');
const objectsCss = css('src/modules/ads/ui/objects/objects.css');
const homeCss = css('src/modules/home/ui/home.module.css');
const rootCss = css('src/app/root/root-control-center.css');

const hierarchyRow: HierarchyRow = { key: 'k', id: '123456789012345678', name: 'Spring launch', level: 'adset', currency: 'EUR', spend: 12, impressions: 300, clicks: 9, ctr: 3, cpc: 1.33, days: 2,
  path: 'Brand awareness', spendSeries: [4, 8] };
const campaign: AdsSummary = { key: 'c', level: 'campaign', id: 'c1', name: 'Spring launch', accountId: 'a', accountName: 'Studio', currency: 'EUR', spend: 15, impressions: 200, clicks: 10, reach: 100,
  dailyMetrics: [{ date: new Date('2026-10-01T00:00:00Z'), fetchedAt: null, spend: 15, impressions: 200, clicks: 10, reach: 100, cpc: 1.5, cpm: 75, cpp: null, ctr: 5, frequency: null, actions: [], fields: {} }] } as unknown as AdsSummary;

describe('Ads, Home and Root polish', () => {
  it('lets keyboard and pointer users read truncated hierarchy identities', () => {
    const html = renderToStaticMarkup(createElement(HierarchyTable, { caption: 'Ad sets', locale: 'en', rows: [hierarchyRow] }));
    expect(html).toContain('title="Brand awareness"');
    expect(html).toContain('title="123456789012345678"');
    expect(html).toContain('Spring launch');
  });

  it('frames both account charts in matching panels with a shared height', () => {
    const html = renderToStaticMarkup(createElement(CampaignCharts, { accountName: 'Studio', rows: [campaign], locale: 'en' }));
    expect(html.match(/ads-campaign-charts__panel/g)).toHaveLength(2);
    expect(html.match(/height:260px/g)).toHaveLength(2);
  });

  it('never sets Ads text below 12px or uses an undefined border token', () => {
    expect(adsCss).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
    expect(objectsCss).not.toContain('--border');
    expect(objectsCss).not.toContain('currentColor');
  });

  it('gives Ads route-local controls the shared focus ring and touch-size targets', () => {
    expect(adsCss).toMatch(/\.ads-object-actions button:focus-visible[^}]*outline: 3px solid var\(--focus\)/);
    expect(adsCss).toMatch(/\.route-tabs a:focus-visible/);
    expect(adsCss).toMatch(/\.ads-performance-card \.ads-object-actions button[^}]*min-height: var\(--control-height-touch\)/);
    expect(adsCss).toMatch(/\.route-tabs \{[^}]*flex-wrap: nowrap/);
  });

  it('keeps the first performance column in view while wide tables scroll', () => {
    expect(adsCss).toMatch(/\.ads-performance-table td:first-child[^}]*position: sticky/);
  });

  it('uses the shared focus token on Home links and adapts cards for phones', () => {
    expect(homeCss).toMatch(/\.open:focus-visible, \.link:focus-visible \{ outline: 2px solid var\(--focus\)/);
    expect(homeCss).toContain('@media (max-width: 720px)');
    expect(homeCss).toContain('prefers-reduced-motion');
  });

  it('shows focus on Root overview links and supports forced colors', () => {
    expect(rootCss).toMatch(/\.root-control__metrics a:focus-visible[^}]*outline: 3px solid var\(--focus\)/);
    expect(rootCss).toContain('forced-colors: active');
  });
});
