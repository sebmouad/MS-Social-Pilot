import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), read: vi.fn(), export: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/modules/ads/server/report-read', () => ({ readAdsDailyRows: mocks.read }));
vi.mock('../src/modules/ads/server/export', () => ({ exportAdsReport: mocks.export }));

import { GET as readGET } from '../src/app/api/ads/report/rows/route';
import { GET as exportGET } from '../src/app/api/ads/report/export/route';
import { OperationError } from '../src/lib/operation-error';

const viewer = { user: { id: 'user-a' }, workspaceId: 'workspace-a', permissions: { pageScope: { all: false, ids: ['target-a'] } } };
const rows = { format: 'ms-social-pilot-ads-daily', version: 1, range: { from: '2026-10-01', to: '2026-10-02', endExclusive: true }, filters: {}, reportOptions: {}, resultCount: 1, rows: [{ id: 'row-a' }], offset: 0, limit: 25, nextOffset: null, generatedAt: '2026-10-17T12:00:00.000Z' };
const report = { format: 'ms-social-pilot-ads-csv', version: 1, csv: 'date,spend\r\n2026-10-02,3\r\n', fileName: 'ads-report.csv', rowCount: 1, byteLength: Buffer.byteLength('date,spend\r\n2026-10-02,3\r\n'), range: {}, filters: {}, generatedAt: '2026-10-17T12:00:00.000Z', sensitiveFieldsRedacted: 0 };
const request = (path: string, query = '') => new Request(`http://localhost${path}${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue(viewer);
  mocks.read.mockResolvedValue(rows);
  mocks.export.mockResolvedValue(report);
});

describe('Ads daily report HTTP', () => {
  it('requires channel-scoped Ads read and forwards the authorized target scope and canonical row query', async () => {
    const response = await readGET(request('/api/ads/report/rows', '?period=custom&start=2026-10-01&end=2026-10-02&accountId=account-a&level=campaign&objectId=campaign-a&offset=5&limit=20'));
    expect(mocks.viewer).toHaveBeenCalledWith({ feature: 'ads/campaigns', channelScoped: true });
    expect(mocks.read).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['target-a'] }, {
      period: 'custom', start: '2026-10-01', end: '2026-10-02', accountId: 'account-a', level: 'campaign', objectId: 'campaign-a', offset: 5, limit: 20,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(rows);
  });

  it('requires channel-scoped Ads read and returns the full dynamic CSV receipt', async () => {
    const response = await exportGET(request('/api/ads/report/export', '?period=custom&start=2026-10-01&end=2026-10-02&accountId=account-a'));
    expect(mocks.viewer).toHaveBeenCalledWith({ feature: 'ads/campaigns', channelScoped: true });
    expect(mocks.export).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['target-a'] }, {
      period: 'custom', start: '2026-10-01', end: '2026-10-02', accountId: 'account-a',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="ads-report.csv"');
    expect(response.headers.get('x-msp-export-format')).toBe('ads-daily-v1');
    expect(response.headers.get('x-msp-row-count')).toBe('1');
    expect(response.headers.get('x-msp-export-bytes')).toBe(String(report.byteLength));
    expect(await response.text()).toBe(report.csv);
  });

  it('rejects unknown, repeated and noncanonical paging query values before service reads', async () => {
    for (const query of ['?workspaceId=other', '?period=14d&period=30d', '?limit=01', '?offset=1e2', '?limit=2.5', '?offset=-1', '?level=provider']) {
      const response = await readGET(request('/api/ads/report/rows', query));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ code: 'invalid_request' });
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects paging on complete exports and never accepts unsafe service filenames', async () => {
    const paged = await exportGET(request('/api/ads/report/export', '?offset=10'));
    expect(paged.status).toBe(400);
    expect(mocks.export).not.toHaveBeenCalled();
    mocks.export.mockResolvedValueOnce({ ...report, fileName: '../private.csv' });
    const unsafe = await exportGET(request('/api/ads/report/export'));
    expect(unsafe.status).toBe(502);
    expect(JSON.stringify(await unsafe.json())).not.toMatch(/private|\.\.\//);
  });

  it('returns safe authorization failures and masks unexpected service details', async () => {
    mocks.viewer.mockRejectedValueOnce(new Error('session internals'));
    const unauthenticated = await readGET(request('/api/ads/report/rows'));
    expect(unauthenticated.status).toBe(401);
    expect(JSON.stringify(await unauthenticated.json())).not.toMatch(/session internals/);
    mocks.export.mockRejectedValueOnce(new OperationError('forbidden', 'Ads report access is unavailable.'));
    const denied = await exportGET(request('/api/ads/report/export'));
    expect(denied.status).toBe(403);
    mocks.read.mockRejectedValueOnce(new Error('provider access token=secret postgres://db'));
    const failed = await readGET(request('/api/ads/report/rows'));
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toMatch(/token=secret|postgres:/);
  });
});
