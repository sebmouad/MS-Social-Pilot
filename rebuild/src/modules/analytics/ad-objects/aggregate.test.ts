import { expect, it } from 'vitest';
import { aggregateObjects, adObjectsCsv } from './aggregate';
const row = (patch: Record<string, unknown> = {}) => ({ id: 'r', accountId: 'a', accountName: 'Account', currency: 'USD', level: 'campaign', objectId: 'c', objectName: '=Campaign', parentId: null, date: '2026-10-01', fetchedAt: '2026-10-02T00:00:00.000Z', spend: 10, impressions: 100, clicks: 2, reach: 80, frequency: 1.25, cpc: 5, cpm: 100, cpp: null, ctr: 2, actions: [], fields: {}, redactedPaths: [], ...patch });
it('deduplicates days by latest fetch, weights ratios, keeps reach a dated snapshot and reports missing days', () => {
  const result = aggregateObjects([row({ id: 'old', spend: 999, fetchedAt: null }), row(), row({ id: 'next', date: '2026-10-02', spend: 20, impressions: 300, clicks: 8, reach: 200 })], 3);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ spend: 30, impressions: 400, clicks: 10, cpc: 3, ctr: 2.5, cpm: 75, reach: 200, reachDate: '2026-10-02', coveredDays: 2, requestedDays: 3 });
});
it('never combines objects across accounts, levels or currencies', () => {
  expect(aggregateObjects([row(), row({ accountId: 'b', currency: 'EUR' }), row({ level: 'adset' }), row({ currency: 'EUR' })], 1)).toHaveLength(4);
});
it('unknown flow values stay unknown while stored zero remains zero', () => {
  const [item] = aggregateObjects([row({ spend: null, impressions: 0, clicks: 0, reach: null })], 1);
  expect(item).toMatchObject({ spend: null, impressions: 0, clicks: 0, cpc: null, ctr: null, reach: null });
});
it('exports summaries and all dated observations with provenance, missing data and formula protection in both languages', () => {
  const items = aggregateObjects([row({ currency: null, spend: null, fields: { extra: 5 } })], 2);
  const csv = adObjectsCsv(items, '2026-10-01', '2026-10-02', 'en');
  expect(csv).toContain("'=Campaign"); expect(csv).toContain('Not available'); expect(csv).toContain('extra'); expect(csv).toContain('2026-10-02'); expect(csv).toContain('summary'); expect(csv).toContain('daily');
  expect(adObjectsCsv(items, '2026-10-01', '2026-10-02', 'fr')).toContain('Non disponible');
});
it('does not attach an object to a parent when its stored lineage conflicts within the period', () => {
  const [item] = aggregateObjects([row({ level: 'adset', parentId: 'c' }), row({ id: 'r2', date: '2026-10-02', level: 'adset', parentId: 'different' })], 2);
  expect(item.parentConsistent).toBe(false);
});
it('exports each observation with its own parent and marks a conflicting summary lineage unknown', () => {
  const items = aggregateObjects([row({ level: 'adset', parentId: 'old' }), row({ id: 'r2', date: '2026-10-02', level: 'adset', parentId: 'new' })], 2);
  const lines = adObjectsCsv(items, '2026-10-01', '2026-10-02', 'en').split('\r\n');
  expect(lines[1]).not.toContain('"new"'); expect(lines[1]).toContain('"Not available"');
  expect(lines[2]).toContain('"old"'); expect(lines[3]).toContain('"new"');
});
