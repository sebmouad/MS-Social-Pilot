import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/data', () => ({ prisma: {} }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn() }));
import { summarizeResponseTimes, summarizeResponseSource, type ResponseMessage } from '@/modules/analytics/reports/generation/response-time';
import { renderReport } from '@/modules/analytics/reports/generation/document';
import { reportDocumentCopyDefaults, reportDocumentCopySchema, reportDocumentCatalogDefaults } from '@/modules/analytics/reports/generation/copy';
import { responseTimeCopyDefaults } from '@/modules/analytics/reports/generation/response-copy';
const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const business = { hours: { days: [4], start: 9, end: 18 }, timeZone: 'UTC' };
const names = new Map([['a', '<Alice>'], ['b', 'Bob']]);
const message = (conversationId: string, hour: number, member?: string | null, resolvedAt: Date | null = at(21)): ResponseMessage => ({ conversationId, createdTime: at(hour), fromChannel: member !== undefined, sentById: member, resolvedAt });
const rows = [message('c', 8), message('c', 10, 'a'), message('c', 17), message('c', 20, 'b')];
const summarize = (messages = rows, hours: typeof business | null = business, limit = 25) => summarizeResponseTimes(messages, false, hours, names, responseTimeCopyDefaults, 'en', limit);

describe('legacy member response outcomes', () => {
  it('computes slowest replies in both clocks and credits only the final eligible run', () => {
    expect(summarize().memberOutcomes).toEqual([
      { memberId: 'a', name: '<Alice>', answered: 1, slowestMs: 7200000, businessSlowestMs: 3600000, resolved: 0, unresolved: 1, medianResolveMs: null, businessMedianResolveMs: null },
      { memberId: 'b', name: 'Bob', answered: 1, slowestMs: 10800000, businessSlowestMs: 3600000, resolved: 1, unresolved: 0, medianResolveMs: 14400000, businessMedianResolveMs: 3600000 },
    ]);
  });
  it('does not credit an earlier responder when the last visitor run is unanswered', () => {
    expect(summarize(rows.slice(0, 3)).memberOutcomes?.[0]).toMatchObject({ resolved: 0, unresolved: 1, medianResolveMs: null });
  });
  it('does not credit a reply sent after saved resolution', () => {
    expect(summarize(rows.map(row => ({ ...row, resolvedAt: at(18) }))).memberOutcomes?.find(row => row.memberId === 'b')).toMatchObject({ resolved: 0, medianResolveMs: null });
  });
  it('assigns resolution before a later run only to the earlier eligible run', () => {
    const result = summarize(rows.map(row => ({ ...row, resolvedAt: at(12) })));
    expect(result.memberOutcomes?.find(row => row.memberId === 'a')).toMatchObject({ resolved: 1, medianResolveMs: 14400000 });
    expect(result.memberOutcomes?.find(row => row.memberId === 'b')?.resolved).toBe(0);
  });
  it('computes medians from actual run durations', () => {
    const input = [message('c1', 8), message('c1', 10, 'a'), message('c2', 14), message('c2', 14, 'a')].map(row => ({ ...row, resolvedAt: at(row.conversationId === 'c1' ? 12 : 15) }));
    expect(summarize(input).memberOutcomes?.[0]).toMatchObject({ answered: 2, resolved: 2, medianResolveMs: 9000000, businessMedianResolveMs: 7200000 });
  });
  it('keeps missing hours unknown and preserves true zero', () => {
    const outside = [message('c', 19), message('c', 20, null)];
    expect(summarize(outside).memberOutcomes?.[0]).toMatchObject({ businessSlowestMs: 0, businessMedianResolveMs: 0 });
    expect(summarize(outside, null).memberOutcomes?.[0]).toMatchObject({ businessSlowestMs: null, businessMedianResolveMs: null });
  });
  it('retains source membership, former-member wording and the Root ceiling', () => {
    const source = summarizeResponseSource(rows, false, business, { names: new Map(), copy: responseTimeCopyDefaults, locale: 'fr', limit: 1 });
    expect(source.memberOutcomes).toHaveLength(1);
    expect(source.memberOutcomes?.[0]?.name).toBe('Ancien membre');
    expect(source.membersOmitted).toBe(1);
    expect(summarize([]).memberOutcomes).toEqual([]);
  });
  it.each(['en', 'fr'] as const)('exports all three capabilities through shared artifacts (%s)', locale => {
    const response = summarize();
    response.comments = summarizeResponseSource(rows, false, business, { names, copy: responseTimeCopyDefaults, locale, limit: 25 });
    const snapshot = { period: { start: '2026-10-01', end: '2026-10-01' }, allMetrics: [], audience: null, publishing: { published: 0, scheduled: 0, failed: 0 } };
    const out = renderReport(snapshot as never, { channelName: 'Example', sections: ['responseTime'], generatedAt: at(24), responseTime: response }, { maxRows: 500, maxBytes: 100000 }, reportDocumentCopyDefaults[locale], locale, responseTimeCopyDefaults);
    const records = JSON.parse(out.json!).records;
    const value = (key: string) => records.find((row: { metric_key: string; resource: string }) => row.metric_key === key && row.resource === 'Bob')?.value;
    expect(value('member_slowest_first_response_minutes')).toBe(180);
    expect(value('comment_member_resolved_waits')).toBe(1);
    expect(value('comment_member_median_resolve_business_minutes')).toBe(60);
    expect(out.html).toContain('&lt;Alice&gt;'); expect(out.html).not.toContain('<Alice>');
    expect(out.csv).toContain('member_unresolved_waits');
    for (const content of [out.text, out.html]) expect(content).toContain(locale === 'fr' ? 'pas à la personne' : 'not to the person');
    const bounded = renderReport(snapshot as never, { channelName: 'Example', sections: ['responseTime'], generatedAt: at(24), responseTime: response }, { maxRows: 2, maxBytes: 1000 });
    expect(JSON.parse(bounded.json!).truncated).toBe(true);
    for (const artifact of [bounded.csv, bounded.json!, bounded.html, bounded.text]) expect(Buffer.byteLength(artifact)).toBeLessThanOrEqual(1000);
  });
  it('validates the extended Root catalogs', () => {
    expect(reportDocumentCopySchema.safeParse(reportDocumentCatalogDefaults).success).toBe(true);
  });
});
