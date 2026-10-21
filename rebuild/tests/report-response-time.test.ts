import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), target: { findFirst: vi.fn() }, conversationMessage: { findMany: vi.fn() }, postComment: { findMany: vi.fn(async () => []) }, user: { findMany: vi.fn(async (_args: { where?: unknown; select?: unknown }): Promise<Array<{ id: string; name: string }>> => []) } }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { responseTimeCopyDefaults } = await import('../src/modules/analytics/reports/generation/response-copy');
  return { runtimeConfig: async (key: string) => key === 'analytics.reports.responseMessageLimit' ? 20000 : key === 'analytics.reports.responseEventLimit' ? 100 : key === 'analytics.reports.responseMemberLimit' ? 25 : responseTimeCopyDefaults };
});

import { formatDuration, readResponseTime, summarizeResponseTimes, MEMBER_ROWS_CAP, RESPONSE_TIME_MESSAGE_CAP } from '../src/modules/analytics/reports/generation/response-time';
import { renderReport } from '../src/modules/analytics/reports/generation/document';

const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 0, min));

describe('response time arithmetic', () => {
  it('measures each wait from the first visitor message to the next channel reply', () => {
    const s = summarizeResponseTimes([
      { conversationId: 'a', createdTime: at(0), fromChannel: false },
      { conversationId: 'a', createdTime: at(5), fromChannel: false },
      { conversationId: 'a', createdTime: at(10), fromChannel: true },
      { conversationId: 'a', createdTime: at(11), fromChannel: true },
      { conversationId: 'a', createdTime: at(20), fromChannel: false },
      { conversationId: 'a', createdTime: at(50), fromChannel: true },
      { conversationId: 'b', createdTime: at(0), fromChannel: true },
      { conversationId: 'b', createdTime: at(1), fromChannel: false },
      { conversationId: 'c', createdTime: at(3), fromChannel: false },
    ]);
    expect(s).toMatchObject({ answered: 2, unanswered: 2,medianMs: 20 * 60_000, businessMedianMs: null, businessHours: null, partial: false });
  });
  it('reports no data as not available, never zero', () => {
    expect(summarizeResponseTimes([]).medianMs).toBeNull();
    expect(formatDuration(null)).toBe('Not available');
    expect(formatDuration(90 * 60_000)).toBe('1 h 30 min');
  });
});

describe('response time reader', () => {
  it('scopes to the workspace channel, treats app-sent or own-identity messages as replies and flags the cap', async () => {
    db.target.findFirst.mockResolvedValue({ providerId: 'PAGE' });
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [] : [{ timezone: 'UTC', businessDays: [], businessStart: 9, businessEnd: 18 }]);
    const rows = [
      { conversationId: 'a', createdTime: at(0), fromId: 'visitor', sentById: null },
      { conversationId: 'a', createdTime: at(4), fromId: 'PAGE', sentById: null },
      { conversationId: 'a', createdTime: at(6), fromId: 'visitor', sentById: null },
      { conversationId: 'a', createdTime: at(8), fromId: null, sentById: 'u1' },
    ];
    db.conversationMessage.findMany.mockResolvedValue(rows);
    const s = await readResponseTime('w1', 't1', { start: '2026-10-01', end: '2026-10-01' });
    expect(s).toMatchObject({ answered: 2, unanswered: 0,medianMs: 3 * 60_000, businessMedianMs: null, businessHours: null, partial: false });
    const call = db.conversationMessage.findMany.mock.calls[0]![0];
    expect(call.where.conversation).toEqual({ targetId: 't1', target: { workspaceId: 'w1' } });
    expect(call.where.createdTime.lt.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(call.take).toBe(RESPONSE_TIME_MESSAGE_CAP + 1);
    expect(db.target.findFirst.mock.calls[0]![0].where).toEqual({ id: 't1', workspaceId: 'w1' });
  });
  it('returns empty for a channel outside the workspace', async () => {
    db.target.findFirst.mockResolvedValue(null); db.conversationMessage.findMany.mockClear();
    expect((await readResponseTime('w1', 'x', { start: '2026-10-01', end: '2026-10-02' })).answered).toBe(0);
    expect(db.conversationMessage.findMany).not.toHaveBeenCalled();
  });
});

describe('response time report section', () => {
  const snap = { period: { start: '2026-10-01', end: '2026-10-31' }, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
  it('renders in CSV, HTML and text and is no longer listed as not included', () => {
    const out = renderReport(snap as never, { channelName: 'P', sections: ['responseTime'], generatedAt: new Date(), responseTime: { answered: 3, unanswered: 1, medianMs: 12 * 60_000, businessMedianMs: null, businessHours: null, partial: true } }, { maxRows: 100, maxBytes: 20000 });
    expect(out.sections).toEqual(['responseTime']); expect(out.notIncluded).toEqual([]);
    expect(out.csv).toContain('"response_time","median_first_response_minutes"'); expect(out.csv).toContain('"12"');
    expect(out.html).toContain('<h2>Response time</h2>'); expect(out.html).toContain('12 min');
    expect(out.text).toContain('only the earliest messages were read');
  });
});

describe('response time by member and resolve time', () => {
  const names = new Map([['u1', 'Amal'], ['u2', 'Youssef']]);
  const thread = (id: string, resolvedAt: Date | null, ...steps: [number, string | null | 'v'][]) => steps.map(([min, who]) => ({
    conversationId: id, createdTime: at(min), fromChannel: who !== 'v', sentById: who === 'v' ? null : who, resolvedAt,
  }));
  const messages = [
    ...thread('a', at(60), [0, 'v'], [10, 'u1']),
    ...thread('b', at(100), [0, 'v'], [30, 'u1'], [40, 'v'], [50, 'u2']),
    ...thread('c', null, [0, 'v'], [4, null]),
    ...thread('d', null, [5, 'v']),
    ...thread('e', at(1), [20, 'v']),
  ];
  it('attributes each first reply to its member, counts replies outside the app and never invents a zero', () => {
    const s = summarizeResponseTimes(messages, false, null, names);
    expect(s.members).toEqual([
      { memberId: 'u1', name: 'Amal', answered: 2, medianMs: 20 * 60_000 },
      { memberId: null, name: 'Outside the app', answered: 1, medianMs: 4 * 60_000 },
      { memberId: 'u2', name: 'Youssef', answered: 1, medianMs: 10 * 60_000 },
    ]);
    expect(s.membersOmitted).toBe(0);
    expect(summarizeResponseTimes([]).members).toEqual([]);
    expect(summarizeResponseTimes([{ conversationId: 'x', createdTime: at(0), fromChannel: false }]).members).toEqual([]);
  });
  it('labels a sender who is no longer a member and keeps emails out of the summary', () => {
    const s = summarizeResponseTimes(thread('a', null, [0, 'v'], [5, 'gone']), false, null, names);
    expect(s.members).toEqual([{ memberId: 'gone', name: 'Former member', answered: 1, medianMs: 5 * 60_000 }]);
  });
  it('measures resolve time from the first visitor message and counts unresolved or earlier-resolved conversations separately', () => {
    const s = summarizeResponseTimes(messages, false, null, names);
    // a: 0→60, b: 0→100; c and d unresolved; e was resolved before its visitor message, so it has no valid duration.
    expect(s.resolve).toEqual({ resolved: 2, unresolved: 3, medianMs: 80 * 60_000 });
    expect(summarizeResponseTimes([]).resolve).toEqual({ resolved: 0, unresolved: 0, medianMs: null });
  });
  it('resolves names for workspace members only and reads resolvedAt with the messages', async () => {
    db.target.findFirst.mockResolvedValue({ providerId: 'PAGE' });
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [] : [{ timezone: 'UTC', businessDays: [], businessStart: 9, businessEnd: 18 }]);
    db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Amal' }]);
    db.conversationMessage.findMany.mockResolvedValue([
      { conversationId: 'a', createdTime: at(0), fromId: 'v', sentById: null, conversation: { resolvedAt: at(30) } },
      { conversationId: 'a', createdTime: at(5), fromId: null, sentById: 'u1', conversation: { resolvedAt: at(30) } },
    ]);
    const s = await readResponseTime('w1', 't1', { start: '2026-10-01', end: '2026-10-01' });
    expect(s.members).toEqual([{ memberId: 'u1', name: 'Amal', answered: 1, medianMs: 5 * 60_000 }]);
    expect(s.resolve).toEqual({ resolved: 1, unresolved: 0, medianMs: 30 * 60_000 });
    const q = db.user.findMany.mock.calls.at(-1)![0];
    expect(q.where).toEqual({ id: { in: ['u1'] }, memberships: { some: { workspaceId: 'w1' } } });
    expect(q.select).toEqual({ id: true, name: true });
  });
  it('renders members and resolve time in CSV, HTML and text, with Not available when nothing was resolved', () => {
    const base = { period: { start: '2026-10-01', end: '2026-10-31' }, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
    const rt = summarizeResponseTimes(messages, false, null, names);
    const out = renderReport(base as never, { channelName: 'P', sections: ['responseTime'], generatedAt: new Date(), responseTime: rt }, { maxRows: 100, maxBytes: 40000 });
    expect(out.csv).toContain('"member_first_response_minutes"'); expect(out.csv).toContain('Amal'); expect(out.csv).toContain('Outside the app');
    expect(out.csv).toContain('"median_resolve_minutes"'); expect(out.csv).toContain('"80"'); expect(out.csv).toContain('"unresolved_conversations"');
    expect(out.html).toContain('<li>Amal: 2 answered, median first response 20 min</li>');
    expect(out.html).toContain('Resolve time: median 1 h 20 min'); expect(out.html).toContain('2 resolved, 3 not resolved');
    expect(out.text).toContain('Outside the app: 1 answered'); expect(out.text).toContain('Resolve time: median 1 h 20 min');
    const none = summarizeResponseTimes(thread('z', null, [0, 'v']), false, null, names);
    const empty = renderReport(base as never, { channelName: 'P', sections: ['responseTime'], generatedAt: new Date(), responseTime: none }, { maxRows: 100, maxBytes: 40000 });
    expect(empty.text).toContain('Resolve time: median Not available'); expect(empty.text).toContain('0 resolved, 1 not resolved');
    expect(JSON.stringify(JSON.parse(empty.json ?? '{}').records)).toContain('median_resolve_minutes');
  });
  it('stays within the row and byte bounds and lists at most the member cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => thread(`c${i}`, null, [0, 'v'], [5, `m${i}`])).flat();
    const rt = summarizeResponseTimes(many);
    expect(rt.members).toHaveLength(MEMBER_ROWS_CAP); expect(rt.membersOmitted).toBe(15);
    const base = { period: { start: '2026-10-01', end: '2026-10-31' }, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
    const out = renderReport(base as never, { channelName: 'P', sections: ['responseTime'], generatedAt: new Date(), responseTime: rt }, { maxRows: 10, maxBytes: 3000 });
    expect(out.rowCount).toBeLessThanOrEqual(10); expect(out.bytes).toBeLessThanOrEqual(3000);
    expect(out.htmlBytes).toBeLessThanOrEqual(3000); expect(out.textBytes).toBeLessThanOrEqual(3000);
    expect(out.truncated).toBe(true);
  });
});

describe('response time with business hours', () => {
  const hours = { days: [1, 2, 3, 4, 5], start: 9, end: 18 };
  it('adds a business-hours median next to calendar time in the summary', () => {
    const asked = new Date('2026-10-02T15:30:00Z'); const replied = new Date('2026-10-05T08:00:00Z');
    const s = summarizeResponseTimes([
      { conversationId: 'a', createdTime: asked, fromChannel: false },
      { conversationId: 'a', createdTime: replied, fromChannel: true },
    ], false, { hours, timeZone: 'Europe/Paris' });
    expect(s.medianMs).toBe(replied.getTime() - asked.getTime());
    expect(s.businessMedianMs).toBe(90 * 60_000);
    expect(s.businessHours).toEqual({ ...hours, timeZone: 'Europe/Paris' });
  });
  it('reads the workspace hours and zone and applies them', async () => {
    db.target.findFirst.mockResolvedValue({ providerId: 'PAGE' });
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [] : [{ timezone: 'Europe/Paris', businessDays: [1, 2, 3, 4, 5], businessStart: 9, businessEnd: 18 }]);
    db.conversationMessage.findMany.mockResolvedValue([
      { conversationId: 'a', createdTime: new Date('2026-10-02T15:30:00Z'), fromId: 'v', sentById: null },
      { conversationId: 'a', createdTime: new Date('2026-10-05T08:00:00Z'), fromId: 'PAGE', sentById: null },
    ]);
    const s = await readResponseTime('w1', 't1', { start: '2026-10-01', end: '2026-10-05' });
    expect(s.businessMedianMs).toBe(90 * 60_000);
    expect(s.businessHours?.timeZone).toBe('Europe/Paris');
  });
  it('shows calendar time only, never invented hours, when none are set or the stored value is unusable', async () => {
    db.target.findFirst.mockResolvedValue({ providerId: 'PAGE' });
    db.conversationMessage.findMany.mockResolvedValue([]);
    for (const row of [{ timezone: 'UTC', businessDays: [], businessStart: 9, businessEnd: 18 }, { timezone: 'UTC', businessDays: [1], businessStart: 10, businessEnd: 10 }, { timezone: 'Not/AZone', businessDays: [1], businessStart: 9, businessEnd: 18 }]) {
      db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [] : [row]);
      const s = await readResponseTime('w1', 't1', { start: '2026-10-01', end: '2026-10-01' });
      expect(s.businessHours).toBeNull(); expect(s.businessMedianMs).toBeNull();
    }
  });
  const base = { period: { start: '2026-10-01', end: '2026-10-31' }, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
  const bounds = { maxRows: 100, maxBytes: 20000 };
  it('labels business hours and calendar time in CSV, JSON, HTML and text', () => {
    const rt = { answered: 3, unanswered: 1, medianMs: 600 * 60_000, businessMedianMs: 90 * 60_000, businessHours: { ...hours, timeZone: 'Europe/Paris' }, partial: false };
    const out = renderReport(base as never, { channelName: 'P', sections: ['responseTime'], generatedAt: new Date(), responseTime: rt }, bounds);
    expect(out.csv).toContain('median_first_response_business_minutes'); expect(out.csv).toContain('"90"'); expect(out.csv).toContain('"600"');
    expect(out.csv).toContain('Mon, Tue, Wed, Thu, Fri 09:00-18:00 (Europe/Paris)');
    expect(out.html).toContain('Business hours (Mon, Tue, Wed, Thu, Fri 09:00-18:00 (Europe/Paris)): median first response 1 h 30 min');
    expect(out.html).toContain('Calendar time: median first response 10 h');
    expect(out.text).toContain('Business hours'); expect(out.text).toContain('Calendar time');
    const json = JSON.parse(out.json ?? "{}");
    const keys = JSON.stringify(json.records);
    expect(keys).toContain('median_first_response_business_minutes'); expect(keys).toContain('median_first_response_minutes');
  });
  it('says business hours are not set and gives an empty business figure', () => {
    const rt = { answered: 1, unanswered: 0, medianMs: 12 * 60_000, businessMedianMs: null, businessHours: null, partial: false };
    const out = renderReport(base as never, { channelName: 'P', sections: ['responseTime'], generatedAt: new Date(), responseTime: rt }, bounds);
    expect(out.html).toContain('Business hours are not set for this workspace');
    expect(out.text).toContain('Business hours are not set');
    expect(out.csv).toContain('"median_first_response_business_minutes"'); expect(out.csv).toContain('not set');
    expect(out.html).not.toContain('Business hours (');
  });
});
