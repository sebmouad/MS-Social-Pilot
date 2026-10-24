vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), update: vi.fn(), campaign: vi.fn(), adSet: vi.fn(), read: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('@/modules/ads/server/actions', () => ({ updateWorkspaceAd: mocks.update, createWorkspaceAdCampaign: mocks.campaign, createWorkspaceAdSet: mocks.adSet, readWorkspaceAdObject: mocks.read }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));
import { POST as update } from '../src/app/api/ads/actions/route';
import { POST as campaign } from '../src/app/api/ads/campaigns/route';
import { POST as adSet } from '../src/app/api/ads/adsets/route';
import { POST as read } from '../src/app/api/ads/object/route';
import { OperationError } from '../src/lib/operation-error';

const cases = [
  { name: 'update', route: update, run: mocks.update, body: { adAccountId: 'account', objectId: 'object', objectType: 'campaign', status: 'paused', confirmation: 'exact', requestId: 'request-0001' } },
  { name: 'campaign', route: campaign, run: mocks.campaign, body: { adAccountId: 'account', name: 'Example', objective: 'example', confirmation: 'exact', requestId: 'request-0002' } },
  { name: 'ad set', route: adSet, run: mocks.adSet, body: { adAccountId: 'account', campaignId: 'campaign', name: 'Example', dailyBudgetMinor: 100, countryCode: 'MA', optimizationGoal: 'example', confirmation: 'exact', requestId: 'request-0003' } },
  { name: 'read', route: read, run: mocks.read, body: { adAccountId: 'account', objectId: 'object', objectType: 'campaign' } },
];
const request = (body: unknown, origin = 'http://localhost') => new Request('http://localhost/api/ads/action', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace', permissions: { pageScope: { all: true } } }); });

describe.each(cases)('Ads $name error boundary', ({ route, run, body }) => {
  it('returns a module-owned public error with its stable code and status', async () => {
    run.mockRejectedValueOnce(new OperationError('reconnect_required', 'Reconnect this advertising connection and allow advertising changes.'));
    const response = await route(request(body));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'reconnect_required', error: 'Reconnect this advertising connection and allow advertising changes.' });
  });
  it('never trusts provider/configuration text that happens to contain an old recognized phrase', async () => {
    run.mockRejectedValueOnce(new Error('Root has not configured this unavailable provider. Internal credential: private-example'));
    const response = await route(request(body));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toMatch(/Root|private-example|provider/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('refuses cross-origin calls before invoking the service', async () => {
    expect((await route(request(body, 'https://another-origin.invalid'))).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects malformed input before invoking the service', async () => {
    expect((await route(request({}))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe.each(cases.filter(item => item.name === 'campaign' || item.name === 'ad set'))('Ads $name creation route contract', ({ route, run, body }) => {
  it('requires a well-formed request ID', async () => {
    const { requestId: _omit, ...withoutId } = body as typeof body & { requestId: string };
    expect((await route(request(withoutId))).status).toBe(400);
    expect((await route(request({ ...body, requestId: 'short' }))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it('returns the structured outcome unchanged and forwards the request identity', async () => {
    const outcome = { outcome: 'uncertain', operationId: 'adsop_1', message: 'unknown' };
    run.mockResolvedValueOnce(outcome);
    const response = await route(request(body));
    expect(await response.json()).toEqual(outcome);
    expect(run.mock.calls[0][0]).toEqual({ userId: 'user', workspaceId: 'workspace' });
    expect(run.mock.calls[0][1]).toEqual(body);
  });
});

describe('Ads ad set route scope guard', () => {
  it('passes the viewer page-scope flag to the service', async () => {
    mocks.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace', permissions: { pageScope: { all: false } } });
    mocks.adSet.mockResolvedValueOnce({ outcome: 'rejected', operationId: 'x', message: 'no' });
    await adSet(request(cases[2].body));
    expect(mocks.adSet.mock.calls[0][2]).toBe(false);
  });
});

describe('Ads update route contract', () => {
  const body = { adAccountId: 'account', objectId: 'object', objectType: 'campaign', status: 'paused', confirmation: 'exact', requestId: 'request-0001' };
  it('requires a request ID', async () => {
    const { requestId: _omit, ...withoutId } = body;
    expect((await update(request(withoutId))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('returns the structured service outcome and forwards the request identity', async () => {
    const outcome = { outcome: 'uncertain', operationId: 'adsop_1', message: 'unknown' };
    mocks.update.mockResolvedValueOnce(outcome);
    const response = await update(request(body));
    expect(await response.json()).toEqual(outcome);
    expect(mocks.update).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace' }, body);
  });
});
