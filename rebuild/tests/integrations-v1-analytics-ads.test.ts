import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshotRead = vi.hoisted(() => vi.fn());
vi.mock('@/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: snapshotRead }));
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('@/server/mcp/server', () => ({ handleMcpMessage: dispatch }));
const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  /** The viewer the bearer check resolves; null means an invalid, revoked or expired key. */
  key: null as null | Record<string, unknown>,
  postStatus: 'draft' as string,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), post: { findFirst: vi.fn() } }));
const publishing = vi.hoisted(() => ({ createPost: vi.fn(), readPublishingPostList: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async () => ({}), canUseFeature: () => true, entitledPlatformIds: () => ['facebook'] }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => null }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: (p: { features: Record<string, { read: boolean; write: boolean }> }, feature: string, access = 'read') => Boolean(p.features?.[feature]?.[access as 'read' | 'write']) }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({}) }));
vi.mock('@/server/client-ip', () => ({ clientIp: (request: Request) => request.headers.get('x-test-ip') ?? 'ip-1' }));
vi.mock('@/server/mcp/bearer', () => ({ authenticateBearerHeader: async () => state.key }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ createPost: publishing.createPost }));
vi.mock('@/modules/publishing/server/read', () => ({ readPublishingPostList: publishing.readPublishingPostList }));

import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));
import { reset as resetRateLimit } from '../src/server/rate-limit';
import * as analyticsRoute from '../src/app/api/v1/analytics/[operation]/route';
import * as adsRoute from '../src/app/api/v1/ads/[operation]/route';
import { ANALYTICS_MCP } from '../src/modules/analytics/mcp';
import { ADS_MCP } from '../src/modules/ads/mcp';

const TOKEN = `mcp_${'a'.repeat(43)}`;
const origin = 'https://app.test';
const keyed = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => new Request(`${origin}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });

const grants = (read: boolean, write: boolean) => ({ 'publishing/posts': { read, write } });
const viewer = (over: Record<string, unknown> = {}, features: Record<string, { read: boolean; write: boolean }> = grants(true, true), pageScope: { all: boolean; ids: string[] } = { all: true, ids: [] }) => ({
  scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role: 'owner', apiKeyId: 'mcpkey_1', entitlements: { workspaceId: 'workspace-a' },
  workspace: { id: 'workspace-a', name: 'Acme', timezone: 'UTC' }, maxResultItems: 100, resourceRestricted: !pageScope.all,
  permissions: { pageScope, features }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks(); resetRateLimit();
  Object.assign(state, { config: {}, key: viewer(), postStatus: 'draft' });
  db.$queryRaw.mockImplementation(async () => []);
  db.$executeRaw.mockImplementation(async () => 1);
  db.post.findFirst.mockImplementation(async () => ({ status: state.postStatus, scheduledAt: null }));
  publishing.createPost.mockImplementation(async () => ({ id: 'post-1' }));
  publishing.readPublishingPostList.mockImplementation(async () => []);
});


for (const [prefix, route, groups] of [['analytics', analyticsRoute, ANALYTICS_MCP], ['ads', adsRoute, ADS_MCP]] as const) {
  for (const group of groups) for (const tool of group.tools) {
    const write = [...(group.writeTools ?? [])].includes(tool.name);
    const feature = group.features[tool.name]!;
    const context = { params: Promise.resolve({ operation: tool.name }) };
    const call = (input: unknown = {}, method = write ? 'POST' : 'GET') => {
      const path = `/api/v1/${prefix}/${tool.name}`;
      return route[method as 'GET' | 'POST'](keyed(method === 'GET' ? `${path}?input=${encodeURIComponent(JSON.stringify(input))}` : path, method, method === 'GET' ? undefined : input), context);
    };
    describe(`${prefix}/${tool.name}`, () => {
      beforeEach(() => {
        state.key = viewer({}, { [feature]: { read: true, write: true } });
        dispatch.mockImplementation(async () => Response.json({ result: { structuredContent: { ok: true, mcpAuditRecorded: true } } }));
      });
      it('rejects invalid credentials and missing feature grants before dispatch', async () => {
        state.key = null;
        expect((await call()).status).toBe(401);
        state.key = viewer({}, {});
        expect((await call()).status).toBe(403);
        expect(dispatch).not.toHaveBeenCalled();
      });
      it('forwards complete key ceilings and exact input; returns the shared receipt', async () => {
        state.key = viewer({ allowedAdAccountIds: [], adAccountTargetScope: { all: false, ids: ['ad-target'] }, maxResultItems: 7 }, { [feature]: { read: true, write: true } }, { all: false, ids: ['channel-a'] });
        const input = { confirmation: 'exact confirmation', requestId: 'stable-request' };
        const response = await call(input);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, mcpAuditRecorded: true });
        expect(dispatch).toHaveBeenCalledWith(state.key, { jsonrpc: '2.0', id: tool.name, method: 'tools/call', params: { name: tool.name, arguments: input } });
      });
      it('rejects non-object input before dispatch', async () => {
        expect((await call([])).status).toBe(400);
        expect(dispatch).not.toHaveBeenCalled();
      });
      it('preserves shared scope/validation failures and Ads attempt metadata', async () => {
        for (const [code, status] of [['forbidden', 403], ['invalid_request', 400], ['conflict', 409]] as const) {
          const failure = { code, error: 'Shared refusal', attempt: 'not_dispatched' };
          dispatch.mockImplementation(async () => Response.json({ result: { isError: true, structuredContent: failure } }));
          const response = await call();
          expect(response.status).toBe(status);
          expect(await response.json()).toEqual(failure);
        }
      });
      if (write) it('requires write access, refuses GET, preserves confirmation refusals', async () => {
        state.key = viewer({}, { [feature]: { read: true, write: false } });
        expect((await call()).status).toBe(403);
        state.key = viewer({}, { [feature]: { read: true, write: true } });
        expect((await call({}, 'GET')).status).toBe(400);
        expect(dispatch).not.toHaveBeenCalled();
        dispatch.mockImplementation(async () => Response.json({ result: { isError: true, structuredContent: { code: 'invalid_request', error: 'Exact confirmation required.' } } }));
        expect((await call({ confirmation: 'wrong' })).status).toBe(400);
      });
    });
  }
}
it('refuses Root tools, unknown filters, repeated input and malformed JSON', async () => {
  expect((await analyticsRoute.POST(keyed('/api/v1/analytics/set_root_config', 'POST', {}), { params: Promise.resolve({ operation: 'set_root_config' }) })).status).toBe(404);
  state.key = viewer({}, { 'analytics/overview': { read: true, write: true } });
  const context = { params: Promise.resolve({ operation: 'get_analytics_overview' }) };
  for (const suffix of ['?extra=1', '?input={}&input={}', '?input=bad']) expect((await analyticsRoute.GET(keyed(`/api/v1/analytics/get_analytics_overview${suffix}`), context)).status).toBe(400);
  expect(dispatch).not.toHaveBeenCalled();
});
it('applies the existing Root byte cap to GET and POST input', async () => {
  state.config['integrations.api.postsBodyMaxBytes'] = 1024;
  state.key = viewer({}, { 'analytics/overview': { read: true, write: true } });
  const context = { params: Promise.resolve({ operation: 'get_analytics_overview' }) };
  const input = { search: 'x'.repeat(1025) };
  expect((await analyticsRoute.POST(keyed('/api/v1/analytics/get_analytics_overview', 'POST', input), context)).status).toBe(400);
  expect((await analyticsRoute.GET(keyed(`/api/v1/analytics/get_analytics_overview?input=${encodeURIComponent(JSON.stringify(input))}`), context)).status).toBe(400);
  expect(dispatch).not.toHaveBeenCalled();
});

describe('v1 through the actual MCP host', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../src/server/mcp/server')>('../src/server/mcp/server');
    dispatch.mockImplementation(actual.handleMcpMessage);
  });
  it('refuses workspace-wide report templates for a resource-limited key', async () => {
    state.key = viewer({}, { 'analytics/reports': { read: true, write: true } }, { all: false, ids: ['channel-a'] });
    const response = await analyticsRoute.GET(keyed('/api/v1/analytics/list_report_templates'), { params: Promise.resolve({ operation: 'list_report_templates' }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
  });
  it('enforces manager-only Ads reads inside shared dispatch', async () => {
    state.key = viewer({ role: 'member' }, { 'ads/campaigns': { read: true, write: true } });
    const response = await adsRoute.GET(keyed('/api/v1/ads/get_ad_creation_options?input=%7B%22adAccountId%22%3A%22account-a%22%7D'), { params: Promise.resolve({ operation: 'get_ad_creation_options' }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
  });
  it('runs Analytics validation through shared dispatch', async () => {
    state.key = viewer({}, { 'analytics/overview': { read: true, write: true } });
    const response = await analyticsRoute.GET(keyed('/api/v1/analytics/get_analytics_metric_details'), { params: Promise.resolve({ operation: 'get_analytics_metric_details' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
  });
  it('returns snapshot previousPoints and comparisons from the shared Analytics service', async () => {
    state.key = viewer({ maxResultItems: 1, allowedAdAccountIds: ['account-a'] }, { 'analytics/overview': { read: true, write: true } }, { all: false, ids: ['channel-a'] });
    const metric = { key: 'reach', points: [{ date: '2026-10-20', value: 3 }], rows: [] };
    snapshotRead.mockResolvedValue({
      period: { range: {}, start: '2026-10-20', end: '2026-10-20' },
      allMetrics: [metric], comparisons: { reach: { previous: 2 } },
      previousPoints: { reach: [{ date: '2026-10-19', value: 2 }] },
      audience: { entries: [], total: null }, selected: { channelIds: ['channel-a'], adAccountIds: ['account-a'] },
      options: { channels: [{ id: 'channel-a', type: 'channel', name: 'Example' }] }, publishing: {},
    });
    const response = await analyticsRoute.GET(keyed('/api/v1/analytics/get_analytics_overview'), { params: Promise.resolve({ operation: 'get_analytics_overview' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ metrics: [{ previousPoints: [{ date: '2026-10-19', value: 2 }], comparison: { previous: 2 } }] });
    expect(snapshotRead).toHaveBeenCalledWith(state.key, {}, { allowedChannelIds: ['channel-a'] });
  });
  it('does not let an Ads creation omit its confirmation', async () => {
    state.key = viewer({}, { 'ads/campaigns': { read: true, write: true } });
    const response = await adsRoute.POST(keyed('/api/v1/ads/create_ad_campaign', 'POST', { adAccountId: 'account-a', name: 'Example', objective: 'traffic' }), { params: Promise.resolve({ operation: 'create_ad_campaign' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request', error: 'confirmation is required.' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});
