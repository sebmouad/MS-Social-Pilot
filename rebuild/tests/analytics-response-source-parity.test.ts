import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/data', () => ({ prisma: {} }));
import { summarizeResponseSource, summarizeResponseTimes, type ResponseMessage } from '@/modules/analytics/reports/generation/response-time';
import { renderReport } from '@/modules/analytics/reports/generation/document';
import { reportDocumentCopyDefaults } from '@/modules/analytics/reports/generation/copy';
const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const business = { hours: { days: [4], start: 9, end: 18 }, timeZone: 'UTC' };
const messages: ResponseMessage[] = [
  { conversationId: 'a', createdTime: at(8), fromChannel: false, resolvedAt: at(12) },
  { conversationId: 'a', createdTime: at(10), fromChannel: true, sentById: 'member' },
  { conversationId: 'b', createdTime: at(11), fromChannel: false },
];
const comments: ResponseMessage[] = [
  { conversationId: 'comment:a', createdTime: at(17), fromChannel: false, resolvedAt: at(21) },
  { conversationId: 'comment:a', createdTime: at(20), fromChannel: true, sentById: 'member' },
  { conversationId: 'comment:b', createdTime: at(20), fromChannel: false },
  { conversationId: 'comment:b', createdTime: at(21), fromChannel: true },
];
const snapshot = { period: { start: '2026-10-01', end: '2026-10-01' }, allMetrics: [], publishing: { published: 0, scheduled: 0, failed: 0 }, audience: null };
const summary = () => ({ ...summarizeResponseTimes([...messages, ...comments], true, business, new Map([['member', '<Team>']])), comments: summarizeResponseSource(comments, true, business), conversations: summarizeResponseSource(messages, true, business) });
function render(locale: 'en' | 'fr', responseTime = summary()) {
  return renderReport(snapshot as never, { channelName: 'Example', sections: ['responseTime'], generatedAt: at(24), responseTime }, { maxRows: 200, maxBytes: 100000 }, reportDocumentCopyDefaults[locale], locale);
}
describe('separate comment/conversation and member business response parity', () => {
  it('keeps independent denominators and durations for both sources', () => {
    expect(summary().conversations).toMatchObject({ total: 2, answered: 1, unanswered: 1, answeredPercent: 50, medianMs: 7200000, businessMedianMs: 3600000, resolve: { resolved: 1, unresolved: 1, medianMs: 14400000, businessMedianMs: 10800000 } });
    expect(summary().comments).toMatchObject({ total: 2, answered: 2, unanswered: 0, answeredPercent: 100, medianMs: 7200000, slowestMs: 10800000, businessMedianMs: 1800000, businessSlowestMs: 3600000, resolve: { resolved: 1, unresolved: 1 } });
  });
  it('computes business medians from each member’s own waits, including outside-app answers', () => {
    expect(summary().members).toEqual([
      { memberId: 'member', name: '<Team>', answered: 2, medianMs: 9000000, businessMedianMs: 3600000 },
      { memberId: null, name: 'Outside the app', answered: 1, medianMs: 3600000, businessMedianMs: 0 },
    ]);
    expect(summarizeResponseTimes(messages).members?.[0]?.businessMedianMs).toBeNull();
    expect(summarizeResponseTimes(comments, false, business, new Map(), undefined, 'en', 1).membersOmitted).toBe(1);
  });
  it('uses unknown for no waits or unset hours, while preserving genuine zero business waits', () => {
    expect(summarizeResponseSource([])).toMatchObject({ total: 0, answeredPercent: null, medianMs: null, businessMedianMs: null, slowestMs: null });
    expect(summarizeResponseSource(comments).businessMedianMs).toBeNull();
    expect(summarizeResponseSource(comments.slice(2), false, business).businessMedianMs).toBe(0);
  });
  it.each(['en', 'fr'] as const)('exports the same measures in CSV, JSON, HTML and text (%s)', locale => {
    const output = render(locale);
    const records = JSON.parse(output.json!).records;
    const value = (key: string) => records.find((r: { metric_key: string }) => r.metric_key === key);
    expect(value('comment_answered_percent')).toMatchObject({ value: 100, unit: 'percent', coverage: 'partial' });
    expect(value('conversation_answered_percent').value).toBe(50);
    expect(value('comment_median_first_response_business_minutes').value).toBe(30);
    expect(value('conversation_median_resolve_business_minutes').value).toBe(180);
    expect(value('member_first_response_business_minutes').value).toBe(60);
    expect(records.filter((r: { metric_key: string }) => r.metric_key === 'comment_answered_waits')).toHaveLength(1);
    expect(output.csv).toContain('conversation_slowest_first_response_minutes');
    expect(output.html).toContain('&lt;Team&gt;');
    expect(output.html).not.toContain('<Team>');
    for (const content of [output.html, output.text]) {
      expect(content).toContain(locale === 'fr' ? 'Commentaires : 2 attentes, 2 traitées' : 'Comments: 2 waits, 2 answered');
      expect(content).toContain(locale === 'fr' ? 'Conversations : 2 attentes, 1 traitées' : 'Conversations: 2 waits, 1 answered');
      expect(content).toContain(locale === 'fr' ? 'première réponse médiane en heures ouvrées 1 h' : 'median first response within business hours 1 h');
    }
  });
  it('exports empty percentages as null and keeps row/byte ceilings', () => {
    const empty = summarizeResponseSource([]);
    const output = render('en', { ...summary(), comments: empty, conversations: empty });
    expect(JSON.parse(output.json!).records.find((r: { metric_key: string }) => r.metric_key === 'comment_answered_percent').value).toBeNull();
    const small = renderReport(snapshot as never, { channelName: 'Example', sections: ['responseTime'], generatedAt: at(24), responseTime: summary() }, { maxRows: 2, maxBytes: 1000 });
    expect(JSON.parse(small.json!).truncated).toBe(true);
    expect(Buffer.byteLength(small.csv)).toBeLessThanOrEqual(1000);
    expect(Buffer.byteLength(small.html)).toBeLessThanOrEqual(1000);
  });
});
