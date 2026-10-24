import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), query: vi.fn(), config: vi.fn(), assertRoot: vi.fn(), read: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $executeRaw: mocks.exec, $queryRaw: mocks.query } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/modules/root/server/admin/authz', () => ({ assertRootActor: mocks.assertRoot }));
vi.mock('@/server/platforms', () => ({ PLATFORM_HOSTS: { facebook: { apiUsage: { read: mocks.read } }, instagram: {} } }));

import { graphUsageSnapshots, readFacebookGraphUsage, recordFacebookGraphUsage, withGraphUsageRecording } from '@/platforms/facebook/graph-usage';
import { FACEBOOK_GRAPH_USAGE_COPY, FACEBOOK_GRAPH_USAGE_POLICY } from '@/platforms/facebook/graph-usage-config';
import { readRootApiUsage } from '@/modules/root/server/api-usage';
import { executeRootMonitoringTool, rootMonitoringResources } from '@/modules/root/mcp';

const headers = (values: Record<string, unknown>) => new Headers(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)])));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockImplementation(async (key: string) => key === 'meta.graphUsagePolicy' ? FACEBOOK_GRAPH_USAGE_POLICY : key === 'meta.graphUsageCopy' ? FACEBOOK_GRAPH_USAGE_COPY : key === 'root.apiUsagePolicy' ? { scopeLimit: 50 } : undefined);
  mocks.assertRoot.mockResolvedValue(undefined);
});

describe('Graph usage recorder (G1)', () => {
  it('parses app, ad-account and business-use-case headers into neutral scopes', () => {
    const rows = graphUsageSnapshots(headers({
      'x-app-usage': { call_count: 12, total_time: 3, total_cputime: 4 },
      'x-ad-account-usage': { acc_id_util_pct: 55.5, reset_time_duration: 300 },
      'x-business-use-case-usage': { '123': [{ type: 'ads_management', call_count: 9, total_time: 1, total_cputime: 2, estimated_time_to_regain_access: 0 }] },
    }), new Date('2026-10-22T10:00:00Z'));
    expect(rows.map(row => row.key)).toEqual(['app', 'ad-account', 'business-use-case:123:ads_management']);
    expect(rows[0]!.snapshot.metrics).toEqual([{ key: 'call_count', value: 12 }, { key: 'total_time', value: 3 }, { key: 'total_cputime', value: 4 }]);
  });

  it('ignores malformed or oversized headers and non-numeric values', () => {
    expect(graphUsageSnapshots(new Headers({ 'x-app-usage': 'not json', 'x-ad-account-usage': '{"acc_id_util_pct":"high"}', 'x-business-use-case-usage': 'x'.repeat(9000) }), new Date())).toEqual([]);
  });

  it('writes one upsert per scope, throttled by the Root interval, and honours the off switch', async () => {
    const h = headers({ 'x-app-usage': { call_count: 1 } });
    await recordFacebookGraphUsage(h, new Date('2026-10-22T10:00:00Z'));
    await recordFacebookGraphUsage(h, new Date('2026-10-22T10:00:10Z'));
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    await recordFacebookGraphUsage(h, new Date('2026-10-22T10:01:00Z'));
    expect(mocks.exec).toHaveBeenCalledTimes(2);
    mocks.config.mockImplementation(async () => ({ ...FACEBOOK_GRAPH_USAGE_POLICY, enabled: false }));
    await recordFacebookGraphUsage(h, new Date('2026-10-22T11:00:00Z'));
    expect(mocks.exec).toHaveBeenCalledTimes(2);
  });

  it('a recording failure never changes the response a Graph caller receives', async () => {
    mocks.config.mockRejectedValue(new Error('config down'));
    const wrapped = withGraphUsageRecording(async () => new Response('{"ok":true}', { headers: { 'x-app-usage': '{"call_count":1}' } }));
    expect(await (await wrapped('https://graph.example')).json()).toEqual({ ok: true });
  });

  it('reads recorded scopes with locale labels, warning and stale flags', async () => {
    mocks.query.mockResolvedValue([{ key: 'app', savedAt: new Date('2026-10-22T09:00:00Z'), snapshot: { capturedAt: '2026-10-22T09:00:00.000Z', metrics: [{ key: 'call_count', value: 85 }, { key: 'total_time', value: 10 }] } }]);
    const [scope] = await readFacebookGraphUsage(10, 'fr', new Date('2026-10-22T12:00:00Z'));
    expect(scope).toMatchObject({ scope: 'app', label: FACEBOOK_GRAPH_USAGE_COPY.fr.app, stale: true });
    expect(scope!.metrics.map(metric => metric.warning)).toEqual([true, false]);
  });
});

describe('Root API usage service, REST and MCP (G1)', () => {
  it('requires the installation owner and reads only platforms that declare the hook', async () => {
    mocks.read.mockResolvedValue([{ scope: 'app', label: 'App', capturedAt: 'x', stale: false, metrics: [] }]);
    const result = await readRootApiUsage('root', { locale: 'en' });
    expect(mocks.assertRoot).toHaveBeenCalled();
    expect(result.platforms.find(platform => platform.providerId === 'facebook')).toMatchObject({ unavailable: false });
    expect(result.platforms.find(platform => platform.providerId === 'instagram')).toMatchObject({ unavailable: true, scopes: [] });
    mocks.assertRoot.mockRejectedValue(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(readRootApiUsage('member')).rejects.toBeTruthy();
  });

  it('refuses an unknown platform and passes the MCP result cap', async () => {
    await expect(readRootApiUsage('root', { providerId: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    await executeRootMonitoringTool('root', 'get_root_api_usage', { providerId: 'facebook', locale: 'fr' }, 3);
    expect(mocks.read).toHaveBeenCalledWith(3, 'fr');
    await expect(executeRootMonitoringTool('root', 'get_root_api_usage', { x: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(rootMonitoringResources.some(resource => resource.tool === 'get_root_api_usage')).toBe(true);
  });
});
