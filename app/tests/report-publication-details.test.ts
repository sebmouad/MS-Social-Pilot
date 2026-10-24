import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
import { readPublicationReport } from '../src/modules/analytics/reports/server/publication-report';
import { renderReport } from '../src/modules/analytics/reports/generation/document';
import { reportDocumentCopyDefaults } from '../src/modules/analytics/reports/generation/copy';
import { PUBLICATION_REPORT_POLICY_SCHEMA } from '../src/modules/analytics/reports/config';

const post = { postId: 'p1', text: '=SUM(1,2) <script>', at: new Date('2026-10-02T01:00Z'), attempts: 2 };
const report = { published: [post], failed: [{ ...post, postId: 'p2' }], days: [{ day: '2026-10-02', published: 300 }], publishedTruncated: true, failedTruncated: false };
const snapshot = { period: { start: '2026-10-01', end: '2026-10-03' }, allMetrics: [], audience: null, publishing: { published: 300, scheduled: 0, failed: 1 } };
const render = (locale: 'en' | 'fr' = 'en', maxRows = 100, maxBytes = 30000) => renderReport(snapshot as never, { channelName: 'Channel', sections: ['published'], publications: report, generatedAt: new Date(0) }, { maxRows, maxBytes }, reportDocumentCopyDefaults[locale], locale);

beforeEach(() => { vi.clearAllMocks(); mocks.config.mockResolvedValue({ publishedRows: 1, failedRows: 1, excerptCharacters: 100 }); });
describe('publication detail reads', () => {
  it('bounds each content log independently, keeps daily totals complete and tenant/channel/date predicates in all queries', async () => {
    mocks.query.mockResolvedValueOnce([post, { ...post, postId: 'omitted' }]).mockResolvedValueOnce([post]).mockResolvedValueOnce([{ day: '2026-10-02', published: BigInt(300) }]);
    const result = await readPublicationReport('workspace', 'channel', snapshot.period);
    expect(result).toEqual({ ...report, failed: [post] });
    expect(mocks.config).toHaveBeenCalledWith('analytics.reports.publicationDetails');
    for (const [parts, ...values] of mocks.query.mock.calls) {
      const sql = parts.join('?');
      expect(sql).toContain('p."workspaceId" ='); expect(sql).toContain('pt."targetId" =');
      expect(sql).toContain('t."workspaceId" = p."workspaceId"');
      expect(values).toContain('workspace'); expect(values).toContain('channel');
      expect(values).toContainEqual(new Date('2026-10-01T00:00Z'));
      expect(values).toContainEqual(new Date('2026-10-04T00:00Z'));
      expect(sql).not.toContain('errorMessage'); expect(sql).not.toContain('errorCode');
    }
    expect(mocks.query.mock.calls[0][0].join('?')).toContain('messageOverride');
    expect(mocks.query.mock.calls[1][0].join('?')).toContain('pt."updatedAt"');
    expect(mocks.query.mock.calls[2][0].join('?')).toContain('to_char(pt."publishedAt",');
    expect(mocks.query.mock.calls[2][0].join('?')).not.toContain('LIMIT');
  });
  it('rejects unusable Root limits before reading content', async () => {
    mocks.config.mockResolvedValue({ publishedRows: 0, failedRows: 1, excerptCharacters: 100 });
    await expect(readPublicationReport('w', 'c', snapshot.period)).rejects.toThrow(); expect(mocks.query).not.toHaveBeenCalled();
    expect(PUBLICATION_REPORT_POLICY_SCHEMA.safeParse({ publishedRows: 1, failedRows: 1, excerptCharacters: 2001 }).success).toBe(false);
  });
});
describe('publication report artifacts', () => {
  it.each(['en', 'fr'] as const)('includes all three views, precise scope notes, safe excerpts and source-limit marking in %s', locale => {
    const output = render(locale);
    const json = JSON.parse(output.json!);
    expect(json.records.filter((r: { record_type: string }) => r.record_type === 'publication_day')[0].value).toBe(300);
    expect(json.records.map((r: { record_type: string }) => r.record_type)).toEqual(expect.arrayContaining(['publication_day', 'publication_log', 'publication_failure']));
    expect(output.csv).toContain('"\'=SUM(1,2) <script>"');
    expect(output.html).toContain('&lt;script&gt;'); expect(output.html).not.toContain('<script>');
    expect(output.text).toContain(locale === 'fr' ? 'pas un historique' : 'not a history');
    expect(output.html).toContain(locale === 'fr' ? 'totaux quotidiens' : 'daily totals');
    expect(output.truncated).toBe(true); expect(json.truncated).toBe(true); expect(output.csv).toContain('"truncated","true"');
  });
  it('respects row and byte ceilings in every artifact', () => {
    const output = render('en', 1, 2500);
    expect(output.rowCount).toBe(1); expect(JSON.parse(output.json!).records.length).toBe(1);
    for (const artifact of [output.csv, output.json!, output.html, output.text]) expect(Buffer.byteLength(artifact)).toBeLessThanOrEqual(2500);
    expect(output.truncated).toBe(true);
  });
  it('does not attach content when the published section was not selected', () => {
    const output = renderReport(snapshot as never, { channelName: 'C', sections: ['audience'], publications: report, generatedAt: new Date(0) }, { maxRows: 100, maxBytes: 30000 });
    expect(output.csv).not.toContain('publication_log'); expect(output.html).not.toContain('SUM');
  });
});
