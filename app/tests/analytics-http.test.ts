import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), read: vi.fn(), snapshot: vi.fn(), csv: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/modules/analytics/server/read', () => ({ readAnalytics: mocks.read, readAnalyticsSnapshot: mocks.snapshot }));
vi.mock('@/modules/analytics/server/reports', () => ({ analyticsSnapshotCsv: mocks.csv }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
import { GET } from '../src/app/api/analytics/route';
import { GET as exportCsv } from '../src/app/api/reports/export/route';
import { OperationError } from '../src/lib/operation-error';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace' });
  mocks.read.mockResolvedValue({ metrics: { items: [] } });
  mocks.snapshot.mockResolvedValue({ period: { start: '2026-10-01', end: '2026-10-14' } });
  mocks.csv.mockReturnValue({ csv: 'safe', rowCount: 3, truncated: true });
  mocks.config.mockResolvedValue(5000);
});
describe('Analytics HTTP boundaries', () => {
  it('passes repeated selections without collapsing them and reuses current scoped service', async () => {
    const result = await GET(new Request('http://localhost/api/analytics?filter=1&channel=a&channel=b&compare=previous'));
    expect(result.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace' }, { filter: '1', channel: ['a', 'b'], compare: 'previous' });
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('masks unexpected errors and keeps failed responses private', async () => {
    mocks.read.mockRejectedValue(new Error('database secret'));
    const result = await GET(new Request('http://localhost/api/analytics'));
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain('secret');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('preserves safe validation status from shared service', async () => {
    mocks.read.mockRejectedValue(new OperationError('invalid_request', 'Choose valid filters.'));
    expect((await GET(new Request('http://localhost/api/analytics?start=x'))).status).toBe(400);
  });
  it('exports the same snapshot with report permission and marks truncation', async () => {
    const result = await exportCsv(new Request('http://localhost/api/reports/export?adFilter=1&adAccount=x&compare=year'));
    expect(mocks.snapshot).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace' }, { adFilter: '1', adAccount: 'x', compare: 'year' }, { feature: 'analytics/reports' });
    expect(result.headers.get('content-disposition')).toContain('2026-10-01-2026-10-14');
    expect(result.headers.get('x-export-truncated')).toBe('true');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('denies missing browser identity before touching reads or exports', async () => {
    mocks.viewer.mockRejectedValue(new Error('redirect'));
    for (const fn of [GET, exportCsv]) {
      const result = await fn(new Request('http://localhost/api/analytics'));
      expect(result.status).toBe(401);
      expect(result.headers.get('cache-control')).toBe('no-store');
    }
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});
