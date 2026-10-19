import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), target: { findFirst: vi.fn() }, conversationMessage: { findMany: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));

import { formatDuration, readResponseTime, summarizeResponseTimes, RESPONSE_TIME_MESSAGE_CAP } from '../src/modules/analytics/reports/generation/response-time';
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
    expect(s).toEqual({ answered: 2, unanswered: 2, medianMs: 20 * 60_000, businessMedianMs: null, businessHours: null, partial: false });
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
    db.$queryRaw.mockResolvedValue([{ timezone: 'UTC', businessDays: [], businessStart: 9, businessEnd: 18 }]);
    const rows = [
      { conversationId: 'a', createdTime: at(0), fromId: 'visitor', sentById: null },
      { conversationId: 'a', createdTime: at(4), fromId: 'PAGE', sentById: null },
      { conversationId: 'a', createdTime: at(6), fromId: 'visitor', sentById: null },
      { conversationId: 'a', createdTime: at(8), fromId: null, sentById: 'u1' },
    ];
    db.conversationMessage.findMany.mockResolvedValue(rows);
    const s = await readResponseTime('w1', 't1', { start: '2026-10-01', end: '2026-10-01' });
    expect(s).toEqual({ answered: 2, unanswered: 0, medianMs: 3 * 60_000, businessMedianMs: null, businessHours: null, partial: false });
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
    db.$queryRaw.mockResolvedValue([{ timezone: 'Europe/Paris', businessDays: [1, 2, 3, 4, 5], businessStart: 9, businessEnd: 18 }]);
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
      db.$queryRaw.mockResolvedValue([row]);
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
