import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 20000 }));

import { facebookDestinationMeasures, readFacebookDestinationMeasures } from '../src/platforms/facebook/destination-measures';
import { renderReport, type DestinationSummary } from '../src/modules/analytics/reports/generation/document';

describe('Facebook destination measures', () => {
  it('sums stored measures, keeps never-stored ones unknown and counts measured posts', () => {
    const out = facebookDestinationMeasures([{ impressions: 10, reactions: 2 }, { impressions: 5, reactions: null }, null]);
    const by = Object.fromEntries(out.measures.map(m => [m.key, m]));
    expect(by.impressions).toMatchObject({ value: 15, measuredPosts: 2 });
    expect(by.reactions).toMatchObject({ value: 2, measuredPosts: 1 });
    expect(by.reach).toMatchObject({ value: null, measuredPosts: 0 });
  });
  it('reads workspace-bound published rows only', async () => {
    db.$queryRaw.mockResolvedValue([{ insights: { shares: 3 } }]);
    const out = await readFacebookDestinationMeasures({ workspaceId: 'w1', targetId: 't1', from: new Date(0), to: new Date() });
    expect(out.measures.find(m => m.key === 'shares')!.value).toBe(3);
    const sql = (db.$queryRaw.mock.calls[0]![0] as { sql: string }).sql;
    expect(sql).toContain(`t."workspaceId" =`); expect(sql).toContain(`pt.status = 'published'`);
  });
});

const snap = { period: { start: '2026-10-01', end: '2026-10-31' }, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
const destination: DestinationSummary = { name: '=Evil <Page>', type: 'page', posts: 3, linkClicks: null, sharedPosts: 1, measures: [{ key: 'impressions', label: 'Impressions', value: 15, measuredPosts: 2 }, { key: 'reach', label: 'Reach', value: null, measuredPosts: 0 }] };
const input = { channelName: 'P', sections: ['destinations' as const], generatedAt: new Date('2026-10-19T00:00:00Z'), destination };

describe('destinations report section', () => {
  const bounds = { maxRows: 100, maxBytes: 50000 };
  it('renders CSV, HTML, text and JSON honestly', () => {
    const out = renderReport(snap as never, input, bounds);
    expect(out.sections).toEqual(['destinations']); expect(out.notIncluded).toEqual([]);
    expect(out.csv).toContain(`"'=Evil <Page>"`);
    expect(out.html).toContain('<h2>Destinations</h2>'); expect(out.html).toContain('&lt;Page&gt;'); expect(out.html).toContain('Not available');
    expect(out.html).toContain('stored for 2 of 3 posts');
    expect(out.text).toContain('Reach Not available');
    const json = JSON.parse(out.json!);
    expect(json.truncated).toBe(false);
    const reach = json.records.find((r: { metric_key: string }) => r.metric_key === 'reach');
    expect(reach.value).toBeNull();
    expect(json.records.find((r: { metric_key: string }) => r.metric_key === 'link_clicks_lifetime').value).toBeNull();
    expect(out.jsonBytes).toBe(Buffer.byteLength(out.json!, 'utf8'));
  });
  it('says so when the summary is unavailable', () => {
    const out = renderReport(snap as never, { ...input, destination: null }, bounds);
    expect(out.html).toContain('Destination summary not available');
  });
  it('bounds and marks the JSON like the CSV', () => {
    const out = renderReport(snap as never, input, { maxRows: 2, maxBytes: 50000 });
    const json = JSON.parse(out.json!);
    expect(json.records).toHaveLength(2); expect(json.truncated).toBe(true); expect(out.truncated).toBe(true);
    const tiny = renderReport(snap as never, input, { maxRows: 100, maxBytes: 100 });
    expect(Buffer.byteLength(tiny.json!, 'utf8')).toBeLessThanOrEqual(100);
    expect(() => JSON.parse(tiny.json!)).not.toThrow();
  });
});
