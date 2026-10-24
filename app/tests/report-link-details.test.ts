import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
import { readLinkReport } from '../src/modules/analytics/reports/server/link-report';
import { LINK_REPORT_DEFAULTS, LINK_REPORT_POLICY_SCHEMA, REPORT_WORKFLOW_CONFIG } from '../src/modules/analytics/reports/config';
import { renderReport } from '../src/modules/analytics/reports/generation/document';
import { reportDocumentCopyDefaults } from '../src/modules/analytics/reports/generation/copy';
const period = { start: '2026-10-01', end: '2026-10-03' };
const link = { id: '=unsafe<script>', postId: 'post', lifetime: 123, period: 0 };
const report = { links: [link], days: [{ day: '2026-10-02', clicks: 300 }], linksTruncated: true, daysTruncated: false };
const snapshot = { period, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
const destination = { name: 'Channel', type: 'channel', posts: 1, sharedPosts: 0, linkClicks: 123, measures: [], links: report };
const render = (locale: 'en' | 'fr' = 'en', maxRows = 100, maxBytes = 30000) => renderReport(snapshot as never, { channelName: 'Channel', sections: ['destinations'], destination, generatedAt: new Date(0) }, { maxRows, maxBytes }, reportDocumentCopyDefaults[locale], locale);
beforeEach(() => { vi.clearAllMocks(); mocks.config.mockResolvedValue({ links: 1, days: 1 }); });
describe('link report read', () => {
  it('uses one scoped snapshot and independent deterministic bounds; excludes ambiguous legacy links and visitor data', async () => {
    mocks.query.mockResolvedValue([{ links: [link, { ...link, id: 'omitted' }], days: report.days }]);
    expect(await readLinkReport('workspace', 'channel', period)).toEqual(report);
    expect(mocks.config).toHaveBeenCalledWith('analytics.reports.linkDetails');
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [parts, ...values] = mocks.query.mock.calls[0]; const sql = parts.join('?');
    expect(values).toContain('workspace'); expect(values).toContain('channel');
    expect(values).toContainEqual(new Date('2026-10-01T00:00Z'));
    expect(values).toContainEqual(new Date('2026-10-04T00:00Z'));
    for (const predicate of ['p."workspaceId" = sl."workspaceId"', 't."workspaceId" = p."workspaceId"', 'sl."workspaceId" =', 'sl."targetId" IS NULL', 'COUNT(DISTINCT other."targetId")', "other.status = 'published'", 'LEFT JOIN period_clicks', 'ORDER BY c.lifetime DESC, c.id ASC', 'FROM period_clicks GROUP BY day', 'to_char("createdAt",']) expect(sql).toContain(predicate);
    for (const privateField of ['ipHash', 'userAgent', 'referer', 'country', 'targetUrl', 'slug']) expect(sql).not.toContain(privateField);
    // Daily query uses the entire click cohort, never the clipped inventory.
    expect(sql.split('daily AS (')[1]).not.toContain('JOIN inventory');
  });
  it('marks daily clipping independently and preserves honest empty reads', async () => {
    mocks.query.mockResolvedValueOnce([{ links: [], days: [report.days[0], { day: '2026-10-03', clicks: 1 }] }]).mockResolvedValueOnce([]);
    expect(await readLinkReport('w', 'c', period)).toMatchObject({ links: [], linksTruncated: false, daysTruncated: true, days: report.days });
    expect(await readLinkReport('w', 'c', period)).toEqual({ links: [], days: [], linksTruncated: false, daysTruncated: false });
  });
  it('validates the registered Root bounds before querying', async () => {
    expect(LINK_REPORT_POLICY_SCHEMA.parse(LINK_REPORT_DEFAULTS)).toEqual(LINK_REPORT_DEFAULTS);
    expect(REPORT_WORKFLOW_CONFIG.find(e => e.key === 'analytics.reports.linkDetails')?.consumption).toBe('active');
    mocks.config.mockResolvedValue({ links: 0, days: 1 });
    await expect(readLinkReport('w', 'c', period)).rejects.toThrow(); expect(mocks.query).not.toHaveBeenCalled();
    expect(LINK_REPORT_POLICY_SCHEMA.safeParse({ links: 1, days: 3661 }).success).toBe(false);
  });
});
describe('all report artifacts', () => {
  it.each(['en', 'fr'] as const)('includes all three capabilities and retention/attribution notes in %s', locale => {
    const out = render(locale); const records = JSON.parse(out.json!).records;
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric_key: 'link_lifetime_clicks', value: 123 }),
      expect.objectContaining({ metric_key: 'link_period_clicks', value: 0 }),
      expect.objectContaining({ metric_key: 'link_daily_clicks', value: 300 }),
    ]));
    expect(out.csv).toContain('"\'=unsafe<script>"'); expect(out.html).toContain('&lt;script&gt;'); expect(out.html).not.toContain('<script>');
    for (const artifact of [out.csv, out.json!, out.html, out.text]) expect(artifact).toContain(locale === 'en' ? 'older records may have been deleted' : 'anciens enregistrements peuvent avoir été supprimés');
    expect(out.html).toContain(locale === 'en' ? 'Short-link details' : 'Détail des liens courts');
    expect(out.truncated).toBe(true); expect(JSON.parse(out.json!).truncated).toBe(true);
  });
  it('applies row and byte ceilings to all artifacts', () => {
    const out = render('en', 1, 2500);
    expect(out.rowCount).toBe(1); expect(JSON.parse(out.json!).records.length).toBe(1);
    for (const artifact of [out.csv, out.json!, out.html, out.text]) expect(Buffer.byteLength(artifact)).toBeLessThanOrEqual(2500);
    expect(out.truncated).toBe(true);
  });
  it('does not expose links when Destinations is absent', () => {
    const out = renderReport(snapshot as never, { channelName: 'C', sections: ['published'], destination, generatedAt: new Date(0) }, { maxRows: 100, maxBytes: 30000 });
    expect(out.csv).not.toContain('link_lifetime_clicks'); expect(out.html).not.toContain('unsafe');
  });
});
