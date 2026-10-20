import { describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/modules/analytics/reports/server/access', () => ({ authorizeReport: async () => ({ scope: ['channel'], providers: ['example'] }), resultCeiling: () => undefined, usableChannelIds: async () => ['channel'] }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: async () => null }));
vi.mock('@/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: async () => ({
  selected: { channelIds: ['channel'] }, options: { channels: [{ id: 'channel', name: 'Example' }] },
  period: { start: '2026-10-01', end: '2026-10-31' }, allMetrics: [], audience: null,
  publishing: { published: 2, scheduled: 0, failed: 0 },
}) }));
import { createReportGenerator } from '../src/modules/analytics/reports/generation/document';
describe('short-link lifetime report counts', () => {
  it.each([null, 0, 17])('preserves %s as unknown or a recorded lifetime total', async clicks => {
    db.$queryRaw.mockReset();
    db.$queryRaw.mockResolvedValueOnce([{ name: 'Example', type: 'channel', provider: 'example' }])
      .mockResolvedValueOnce([{ posts: 2, shared: 1, clicks }]);
    const result = await createReportGenerator({ bounds: async () => ({ maxRows: 100, maxBytes: 50000 }) }).generate({
      actor: { userId: 'user', workspaceId: 'workspace' }, channelId: 'channel', sections: ['destinations'],
      period: { start: '2026-10-01', end: '2026-10-31' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const record = JSON.parse(result.output.json!).records.find((row: { metric_key: string }) => row.metric_key === 'link_clicks_lifetime');
    expect(record.value).toBe(clicks);
    expect(result.output.html).toContain(clicks === null ? 'Not available' : String(clicks));
    expect(result.output.html).toContain('lifetime');
    const sql = db.$queryRaw.mock.calls[1];
    expect(sql.slice(1)).toEqual(expect.arrayContaining(['workspace', 'channel']));
    expect(sql[0].join('')).toContain('sl."targetId" =');
    expect(sql[0].join('')).not.toContain('COALESCE(SUM');
  });
});
