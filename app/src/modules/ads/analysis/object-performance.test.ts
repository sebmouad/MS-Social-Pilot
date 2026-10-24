import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ObjectPerformance } from '../ui/compare/ObjectPerformance';
import { buildKpis, totalsFromRows } from './metrics';
const totals = totalsFromRows([{ date: '2026-10-19', spend: 20, impressions: 1000, clicks: 10 }]);
const earlier = totalsFromRows([{ date: '2026-10-10', spend: 10, impressions: 1000, clicks: 10 }]);
const row = { name: '<Example>', kpis: buildKpis(totals, earlier), trend: [{ date: '2026-10-19', ...totals }] };
it.each(['en', 'fr'] as const)('renders object comparisons and stored daily trends in %s', locale => {
  const html = renderToStaticMarkup(createElement(ObjectPerformance, { row, locale, currency: 'EUR', compare: true }));
  expect(html).toContain('&lt;Example&gt;');
  expect(html).toContain('100%');
  expect(html).toContain('2026-10-19');
  expect(html).toContain(locale === 'en' ? 'Previous period' : 'Période précédente');
  expect(html).toContain(locale === 'en' ? 'Missing days' : 'Les jours manquants');
});
it('keeps absent baselines and zero denominators unavailable and hides comparisons in account mode', () => {
  const missing = { ...row, kpis: buildKpis({ ...totals, cpc: null }, null) };
  const html = renderToStaticMarkup(createElement(ObjectPerformance, { row: missing, locale: 'en', currency: null, compare: true }));
  expect(html).toContain('Not available'); expect(html).not.toContain('Infinity');
  const accounts = renderToStaticMarkup(createElement(ObjectPerformance, { row, locale: 'en', currency: 'EUR', compare: false }));
  expect(accounts).not.toContain('Previous period'); expect(accounts).toContain('2026-10-19');
});
