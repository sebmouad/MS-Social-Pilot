import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ target: { findFirst: vi.fn() }, $queryRaw: vi.fn(), postComment: { findMany: vi.fn() }, conversationMessage: { findMany: vi.fn() }, user: { findMany: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => { const { responseTimeCopyDefaults } = await import('../src/modules/analytics/reports/generation/response-copy'); return { runtimeConfig: async (key: string) => key === 'analytics.reports.responseMemberLimit' ? 25 : key.startsWith('analytics.reports.response') && key.endsWith('Limit') ? 100 : responseTimeCopyDefaults }; });
import { historicalResolutionCycles, periodResponseMessages, resolutionAtEnd, type ResolutionEvent } from '../src/modules/analytics/reports/server/response-history';
import { readResponseTime, summarizeResponseTimes, type ResponseMessage } from '../src/modules/analytics/reports/generation/response-time';
import { renderReport } from '../src/modules/analytics/reports/generation/document';
import { reportDocumentCopyDefaults } from '../src/modules/analytics/reports/generation/copy';
const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const from = at(0); const to = at(24);
const message = (hour: number, fromChannel = false, patch: Partial<ResponseMessage> = {}): ResponseMessage => ({ conversationId: 'c', createdTime: at(hour), fromChannel, ...patch });
const event = (hour: number, resolved: boolean, patch: Partial<ResolutionEvent> = {}): ResolutionEvent => ({ itemId: 'c', kind: 'message', createdAt: at(hour), resolved, ...patch });

describe('period-start conversation context', () => {
  it('excludes continuation of a pre-period wait, includes the next new visitor run', () => {
    const result = summarizeResponseTimes(periodResponseMessages([message(-1), message(1), message(2, true), message(3), message(5, true)], from, to));
    expect(result).toMatchObject({ answered: 1, unanswered: 0, medianMs: 2 * 3600000 });
  });
  it('excludes an old unanswered run, includes exactly the inclusive start, excludes end replies', () => {
    expect(periodResponseMessages([message(-1), message(1)], from, to)).toEqual([]);
    expect(summarizeResponseTimes(periodResponseMessages([message(0), message(24, true)], from, to))).toMatchObject({ answered: 0, unanswered: 1 });
  });
  it('attaches the saved resolution to the latest preceding visitor run only', () => {
    const result = summarizeResponseTimes(periodResponseMessages([message(1, false, { resolvedAt: at(7) }), message(2, true), message(5, false, { resolvedAt: at(7) }), message(6, true)], from, to));
    expect(result.resolve).toEqual({ resolved: 1, unresolved: 1, medianMs: 2 * 3600000 });
  });
});

describe('historical resolve and reopen events', () => {
  it('uses the last event before exclusive end despite a later reopen or changed current snapshot', () => {
    expect(resolutionAtEnd([event(3, true), event(25, false)], 'message', 'c', to)).toEqual({ known: true, resolvedAt: at(3) });
    expect(resolutionAtEnd([event(3, true), event(4, false)], 'message', 'c', to)).toEqual({ known: true, resolvedAt: null });
    expect(resolutionAtEnd([event(24, true)], 'message', 'c', to).known).toBe(false);
  });
  it('never mixes comments, conversations or unrelated items', () => {
    expect(resolutionAtEnd([event(3, true, { kind: 'comment' }), event(4, true, { itemId: 'other' })], 'message', 'c', to).known).toBe(false);
  });
  it('retains completed cycles after reopening and ignores duplicate resolves and reopen without visitor input', () => {
    const messages = [1, 7].map(hour => ({ itemId: 'c', kind: 'message' as const, createdTime: at(hour), fromChannel: false }));
    expect(historicalResolutionCycles(messages, [event(3, true), event(4, true), event(5, false), event(6, true), event(9, true), event(10, false)], from, to)).toEqual([
      { startedAt: at(1), resolvedAt: at(3) }, { startedAt: at(7), resolvedAt: at(9) },
    ]);
  });
  it('excludes cycles starting before the period and those resolving at the end', () => {
    const messages = [-1, 7].map(hour => ({ itemId: 'c', kind: 'message' as const, createdTime: at(hour), fromChannel: false }));
    expect(historicalResolutionCycles(messages, [event(3, true), event(24, true)], from, to)).toEqual([]);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  db.target.findFirst.mockResolvedValue({ providerId: 'channel' });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [event(3, true), event(5, false)] : [{ timezone: 'UTC', businessDays: [4], businessStart: 0, businessEnd: 24 }]);
  db.conversationMessage.findMany.mockResolvedValue([
    { conversationId: 'c', createdTime: at(1), fromId: 'visitor', sentById: null, conversation: { resolvedAt: null } },
    { conversationId: 'c', createdTime: at(2), fromId: 'channel', sentById: null, conversation: { resolvedAt: null } },
  ]);
  db.postComment.findMany.mockResolvedValue([]); db.user.findMany.mockResolvedValue([]);
});

describe('shared report reader and bilingual artifacts', () => {
  it('reads scoped audit events, reconstructs cycles after a reopen, and discloses stored-only coverage', async () => {
    const report = await readResponseTime('w', 't', { start: '2026-10-01', end: '2026-10-01' });
    expect(report).toMatchObject({ history: { resolved: 1, reopened: 1, measuredCycles: 1, medianMs: 2 * 3600000 }, resolve: { resolved: 0, unresolved: 1 }, coverage: { storedOnly: true, messagesRead: 2, eventsRead: 2, snapshotFallbackItems: 0 } });
    const call = db.$queryRaw.mock.calls.find(([strings]) => strings.join('').includes('root_activities'))!;
    expect(call[0].join('')).toContain("detail->>'workspaceId' =");
    expect(call[0].join('')).toContain("detail->>'targetId' =");
    expect(call.slice(1)).toEqual(['w', 't', to, 101]);
    const base = { period: { start: '2026-10-01', end: '2026-10-01' }, allMetrics: [], audience: null, publishing: { published: 0, scheduled: 0, failed: 0 } };
    for (const locale of ['en', 'fr'] as const) {
      const out = renderReport(base as never, { channelName: 'Channel', sections: ['responseTime'], generatedAt: to, responseTime: report }, { maxRows: 100, maxBytes: 50000 }, reportDocumentCopyDefaults[locale], locale);
      expect(out.csv).toContain('historical_resolve_minutes'); expect(out.csv).toContain('reopening_events');
      expect(out.json).toContain('stored_messages_read'); expect(out.json).toContain('history_coverage');
      expect(out.html).toContain(locale === 'en' ? 'Historical resolution cycles: 1 measured' : 'Cycles de résolution historiques : 1 mesurés');
      expect(out.text).toContain(locale === 'en' ? 'completeness on the connected platform is unknown' : 'son exhaustivité sur la plateforme connectée est inconnue');
    }
  });
  it('falls back explicitly when workflow history is absent', async () => {
    db.$queryRaw.mockImplementation(async () => []);
    const report = await readResponseTime('w', 't', { start: '2026-10-01', end: '2026-10-01' });
    expect(report.coverage?.snapshotFallbackItems).toBe(1); expect(report.history?.measuredCycles).toBe(0);
  });
  it('suppresses all resolution durations if event history is truncated', async () => {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? Array.from({ length: 101 }, () => event(3, true)) : []);
    const report = await readResponseTime('w', 't', { start: '2026-10-01', end: '2026-10-01' });
    expect(report).toMatchObject({ partial: true, coverage: { eventsTruncated: true, eventsRead: 100 }, history: { measuredCycles: 0, medianMs: null }, resolve: { medianMs: null } });
  });
  it('does not read workflow or message records for an out-of-workspace channel', async () => {
    db.target.findFirst.mockResolvedValue(null);
    await readResponseTime('w', 'other', { start: '2026-10-01', end: '2026-10-01' });
    expect(db.$queryRaw).not.toHaveBeenCalled(); expect(db.conversationMessage.findMany).not.toHaveBeenCalled();
  });
});

it('excludes a safety-cut conversation rather than inventing a response or resolution', async () => {
  db.conversationMessage.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ conversationId: 'c', createdTime: at(i / 100), fromId: 'visitor', sentById: null, conversation: { resolvedAt: at(3) } })));
  const report = await readResponseTime('w', 't', { start: '2026-10-01', end: '2026-10-01' });
  expect(report).toMatchObject({ answered: 0, unanswered: 0, coverage: { messagesTruncated: true, incompleteGroupsExcluded: 1 }, history: { measuredCycles: 0 } });
});

it('applies comment workflow history by local root id, without mixing remote ids or nested replies', async () => {
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [event(3, true, { kind: 'comment', itemId: 'local-root' })] : []);
  db.conversationMessage.findMany.mockResolvedValue([]);
  db.postComment.findMany.mockResolvedValue([
    { id: 'local-root', postTargetId: 'post', remoteId: 'remote-root', parentRemoteId: null, fromId: 'visitor', sentById: null, createdTime: at(1), resolvedAt: null },
    { id: 'reply', postTargetId: 'post', remoteId: 'remote-reply', parentRemoteId: 'remote-root', fromId: 'channel', sentById: null, createdTime: at(2), resolvedAt: null },
  ]);
  const report = await readResponseTime('w', 't', { start: '2026-10-01', end: '2026-10-01' });
  expect(report).toMatchObject({ comments: { answered: 1, unanswered: 0 }, resolve: { resolved: 1, medianMs: 2 * 3600000 }, history: { measuredCycles: 1, medianMs: 2 * 3600000 } });
});


it('keeps French report guidance when a customized stored UI catalog predates the new copy', async () => {
  const { uiCopy, reportCopyDefaults } = await import('../src/modules/analytics/ui/reports/copy');
  const key = Object.keys(reportCopyDefaults).find(key => key.startsWith('Response reports separate'))!;
  expect(uiCopy('fr', {})(key)).toContain('Les rapports distinguent');
});
