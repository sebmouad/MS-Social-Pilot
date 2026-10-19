import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ target: { findFirst: vi.fn() }, conversationMessage: { findMany: vi.fn() } }));
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
    expect(s).toEqual({ answered: 2, unanswered: 2, medianMs: 20 * 60_000, partial: false });
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
    const rows = [
      { conversationId: 'a', createdTime: at(0), fromId: 'visitor', sentById: null },
      { conversationId: 'a', createdTime: at(4), fromId: 'PAGE', sentById: null },
      { conversationId: 'a', createdTime: at(6), fromId: 'visitor', sentById: null },
      { conversationId: 'a', createdTime: at(8), fromId: null, sentById: 'u1' },
    ];
    db.conversationMessage.findMany.mockResolvedValue(rows);
    const s = await readResponseTime('w1', 't1', { start: '2026-10-01', end: '2026-10-01' });
    expect(s).toEqual({ answered: 2, unanswered: 0, medianMs: 3 * 60_000, partial: false });
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
    const out = renderReport(snap as never, { channelName: 'P', sections: ['responseTime'], generatedAt: new Date(), responseTime: { answered: 3, unanswered: 1, medianMs: 12 * 60_000, partial: true } }, { maxRows: 100, maxBytes: 20000 });
    expect(out.sections).toEqual(['responseTime']); expect(out.notIncluded).toEqual([]);
    expect(out.csv).toContain('"response_time","median_first_response_minutes"'); expect(out.csv).toContain('"12"');
    expect(out.html).toContain('<h2>Response time</h2>'); expect(out.html).toContain('12 min');
    expect(out.text).toContain('only the earliest messages were read');
  });
});
