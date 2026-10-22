import { describe, expect, it } from 'vitest';
import { baselineBlock } from './baseline-block';
import { mergeAdObjectSummaries } from '../src/modules/ads/server/object-summaries';
import type { StoredAdObject } from '../src/modules/ads/server/object-store';

const object: StoredAdObject = { adAccountId: 'account1', level: 'adset', objectId: 's1', parentId: 'c1', name: 'Autumn audience', status: 'paused', fetchedAt: new Date('2026-10-21T12:00:00Z') };
describe('neutral ad inventory', () => {
  it('adds an object without inventing daily metrics or rates and ignores unknown accounts', () => {
    const [summary] = mergeAdObjectSummaries([], [object], [{ id: 'account1', name: 'Studio', currency: 'EUR' }]);
    expect(summary).toMatchObject({ id: 's1', parentId: 'c1', rows: 0, dailyMetrics: [], ctr: null, cpc: null });
    expect(mergeAdObjectSummaries([], [object], [])).toEqual([]);
    expect(mergeAdObjectSummaries([summary!], [{ ...object, name: 'Winter audience' }], [{ id: 'account1', name: 'Studio', currency: 'EUR' }])).toEqual([{ ...summary, name: 'Winter audience' }]);
  });
  it('pins the additive inventory migration and account erasure relationship', () => {
    const sql = baselineBlock('20261101120000_ads_object_inventory');
    expect(sql).toContain('REFERENCES ad_accounts(id) ON DELETE CASCADE');
    expect(sql).not.toMatch(/DROP|ALTER|DELETE FROM|UPDATE/);
  });
});
