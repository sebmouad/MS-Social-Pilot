import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ target: { findFirst: vi.fn() }, $queryRaw: vi.fn(), conversationMessage: { findMany: vi.fn() }, postComment: { findMany: vi.fn() }, user: { findMany: vi.fn() }, memberLimit: 25, events: [] as unknown[] }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { responseTimeCopyDefaults } = await import('../src/modules/analytics/reports/generation/response-copy');
  return { runtimeConfig: async (key: string) => key === 'analytics.reports.responseMemberLimit' ? db.memberLimit : key.startsWith('analytics.reports.response') && key.endsWith('Limit') ? 100 : responseTimeCopyDefaults };
});
import { readResponseTime } from '@/modules/analytics/reports/generation/response-time';
import { renderReport } from '@/modules/analytics/reports/generation/document';
import { reportDocumentCopyDefaults, reportDocumentCopySchema, reportDocumentCatalogDefaults } from '@/modules/analytics/reports/generation/copy';
import { responseTimeCopyDefaults } from '@/modules/analytics/reports/generation/response-copy';
const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const event = (hour: number, resolved: boolean, kind: 'message' | 'comment', itemId = 'same') => ({ itemId, kind, createdAt: at(hour), resolved });
const snapshot = { period: { start: '2026-10-01', end: '2026-10-01' }, allMetrics: [], audience: null, publishing: { published: 0, scheduled: 0, failed: 0 } };
const read = (locale: 'en' | 'fr' = 'en') => readResponseTime('workspace', 'target', snapshot.period, locale);
beforeEach(() => {
  vi.clearAllMocks(); db.memberLimit = 25;
  db.target.findFirst.mockResolvedValue({ providerId: 'channel' });
  db.user.findMany.mockResolvedValue([{ id: 'member', name: '<Team>' }]);
  db.events = [event(12, true, 'message'), event(13, true, 'message'), event(14, false, 'message'), event(15, false, 'message', 'no-visitor-history'), event(21, true, 'comment')];
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? db.events : [{ timezone: 'UTC', businessDays: [4], businessStart: 9, businessEnd: 18 }]);
  db.conversationMessage.findMany.mockResolvedValue([
    { conversationId: 'same', createdTime: at(8), fromId: 'visitor', sentById: null, conversation: { resolvedAt: null } },
    { conversationId: 'same', createdTime: at(10), fromId: 'channel', sentById: 'member', conversation: { resolvedAt: null } },
  ]);
  db.postComment.findMany.mockResolvedValue([
    { id: 'same', postTargetId: 'post', remoteId: 'root', parentRemoteId: null, fromId: 'visitor', sentById: null, createdTime: at(17), resolvedAt: null },
    { id: 'reply', postTargetId: 'post', remoteId: 'reply', parentRemoteId: 'root', fromId: 'channel', sentById: 'member', createdTime: at(20), resolvedAt: null },
    { id: 'other', postTargetId: 'post', remoteId: 'other', parentRemoteId: null, fromId: 'visitor', sentById: null, createdTime: at(20), resolvedAt: null },
    { id: 'outside-reply', postTargetId: 'post', remoteId: 'outside-reply', parentRemoteId: 'other', fromId: 'channel', sentById: null, createdTime: at(21), resolvedAt: null },
  ]);
});

describe('source-specific response report workflows', () => {
  it('attributes first replies separately with current workspace names and actual per-source waits', async () => {
    const result = await read();
    expect(result.conversations?.members).toEqual([{ memberId: 'member', name: '<Team>', answered: 1, medianMs: 7200000, businessMedianMs: 3600000 }]);
    expect(result.comments?.members).toContainEqual({ memberId: 'member', name: '<Team>', answered: 1, medianMs: 10800000, businessMedianMs: 3600000 });
    expect(result.comments?.members).toContainEqual({ memberId: null, name: 'Outside the app', answered: 1, medianMs: 3600000, businessMedianMs: 0 });
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['member'] }, memberships: { some: { workspaceId: 'workspace' } } } }));
  });
  it('keeps cycle durations distinct from duplicate resolution and missing-visitor event counts', async () => {
    const result = await read();
    expect(result.conversations?.history).toEqual({ resolved: 2, reopened: 2, measuredCycles: 1, medianMs: 14400000, businessMedianMs: 10800000 });
    expect(result.comments?.history).toEqual({ resolved: 1, reopened: 0, measuredCycles: 1, medianMs: 14400000, businessMedianMs: 3600000 });
    expect(result.history?.businessMedianMs).toBe(7200000);
    expect(result.resolve?.resolved).toBe(1); // currently reopened conversation is distinct from its earlier completed cycle
  });
  it('applies the member row ceiling independently and retains translated outside/former attribution', async () => {
    db.memberLimit = 1; db.user.findMany.mockResolvedValue([]);
    const result = await read('fr');
    expect(result.conversations?.members?.[0]?.name).toBe('Ancien membre');
    expect(result.comments?.members).toHaveLength(1);
    expect(result.comments?.membersOmitted).toBe(1);
    expect(result.conversations?.membersOmitted).toBe(0);
  });
  it('suppresses source resolution durations when audit history is safety-cut', async () => {
    db.events = Array.from({ length: 101 }, () => event(12, true, 'message'));
    const result = await read();
    expect(result.partial).toBe(true);
    for (const source of [result.comments, result.conversations]) expect(source?.history).toMatchObject({ measuredCycles: 0, medianMs: null, businessMedianMs: null });
    expect(result.conversations?.history?.resolved).toBe(100);
  });
  it('returns unknown durations and zero observed event counts for empty stored sources', async () => {
    db.events = []; db.conversationMessage.findMany.mockResolvedValue([]); db.postComment.findMany.mockResolvedValue([]);
    const result = await read();
    for (const source of [result.comments, result.conversations]) expect(source).toMatchObject({ members: [], membersOmitted: 0, history: { measuredCycles: 0, medianMs: null, businessMedianMs: null, resolved: 0, reopened: 0 } });
  });
  it.each(['en', 'fr'] as const)('carries all three capabilities through shared download artifacts (%s)', async locale => {
    const responseTime = await read(locale);
    const out = renderReport(snapshot as never, { channelName: 'Example', sections: ['responseTime'], generatedAt: at(24), responseTime }, { maxRows: 200, maxBytes: 100000 }, reportDocumentCopyDefaults[locale], locale, responseTimeCopyDefaults);
    const records = JSON.parse(out.json!).records;
    const value = (key: string) => records.find((r: { metric_key: string }) => r.metric_key === key)?.value;
    expect(value('comment_historical_resolution_cycles')).toBe(1);
    expect(value('conversation_resolution_events')).toBe(2);
    expect(value('conversation_reopening_events')).toBe(2);
    expect(value('conversation_historical_resolve_business_minutes')).toBe(180);
    expect(value('comment_historical_resolve_business_minutes')).toBe(60);
    expect(value('conversation_member_answered_waits')).toBe(1);
    expect(out.csv).toContain('comment_member_first_response_business_minutes');
    expect(out.html).toContain('&lt;Team&gt;'); expect(out.html).not.toContain('<Team>');
    for (const content of [out.html, out.text]) {
      expect(content).toContain(locale === 'fr' ? 'Commentaires : 1 cycles de résolution enregistrés' : 'Comments: 1 recorded resolution cycles');
      expect(content).toContain(locale === 'fr' ? 'Conversations : 2 événements de résolution, 2 de réouverture' : 'Conversations: 2 resolution events, 2 reopening events');
      expect(content).toContain(locale === 'fr' ? 'premières réponses' : 'first replies');
    }
    const bounded = renderReport(snapshot as never, { channelName: 'Example', sections: ['responseTime'], generatedAt: at(24), responseTime }, { maxRows: 3, maxBytes: 1000 });
    expect(JSON.parse(bounded.json!).truncated).toBe(true);
    for (const content of [bounded.csv, bounded.html, bounded.json!, bounded.text]) expect(Buffer.byteLength(content)).toBeLessThanOrEqual(1000);
  });
  it('validates added English/French Root copy and rejects a catalog predating the extension', () => {
    expect(reportDocumentCopySchema.safeParse(reportDocumentCatalogDefaults).success).toBe(true);
    const old = { ...reportDocumentCatalogDefaults } as Record<string, unknown>;
    delete old['Responding members not listed'];
    expect(reportDocumentCopySchema.safeParse(old).success).toBe(false);
  });
});

it('keeps unset business hours unknown for source members and cycles', async () => {
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? db.events : []);
  const result = await read();
  for (const source of [result.comments, result.conversations]) {
    expect(source?.history?.businessMedianMs).toBeNull();
    expect(source?.members?.every(member => member.businessMedianMs === null)).toBe(true);
  }
});

it('discloses each source member omission in all artifact formats', async () => {
  db.memberLimit = 1;
  const responseTime = await read('fr');
  const out = renderReport(snapshot as never, { channelName: 'Example', sections: ['responseTime'], generatedAt: at(24), responseTime }, { maxRows: 200, maxBytes: 100000 }, reportDocumentCopyDefaults.fr, 'fr');
  const records = JSON.parse(out.json!).records;
  expect(records.find((r: { metric_key: string }) => r.metric_key === 'comment_members_omitted').value).toBe(1);
  expect(records.find((r: { metric_key: string }) => r.metric_key === 'conversation_members_omitted').value).toBe(0);
  expect(out.csv).toContain('comment_members_omitted');
  for (const content of [out.html, out.text]) expect(content).toContain('Commentaires : 1 autres membres ayant répondu non affichés.');
});
