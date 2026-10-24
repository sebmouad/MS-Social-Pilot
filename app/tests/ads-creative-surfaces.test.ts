import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ viewer: vi.fn(), readAdsCreativeImage: vi.fn(), listAdsCreativeSources: vi.fn(), describeAdsManagement: vi.fn(), listAdsCreatives: vi.fn(), listAdsOperations: vi.fn(), performAdsManagement: vi.fn(), previewAdsManagement: vi.fn(), resolveAdsOperation: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock('@/modules/ads/management/server', () => state);
import { GET, POST } from '@/app/api/ads/management/route';
import { adsManagementToolDefinitions, executeAdsManagementTool } from '@/modules/ads/management/mcp';
import { AdsNoDispatchError } from '@/modules/ads/management/errors';
const actor = { userId: 'user', workspaceId: 'workspace' };
const operation = { type: 'creative.create', objectType: 'creative', name: 'Summer', targetId: 'channel', mediaId: 'stored-image', format: 'image', title: '', message: 'New season' };
const payload = { adAccountId: 'account', operation, requestId: 'creative-request', confirmation: 'EXACT' };
const request = (action = 'apply', origin = 'https://app.test') => new Request('https://app.test/api/ads/management', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
beforeEach(() => { vi.resetAllMocks(); state.viewer.mockResolvedValue({ user: { id: actor.userId }, workspaceId: actor.workspaceId }); });
it('HTTP and MCP forward the same neutral reviewed payload to one service', async () => {
  const result = { outcome: 'succeeded', recorded: true, created: { objectType: 'creative', remoteId: 'creative-remote' } };
  state.performAdsManagement.mockResolvedValue(result);
  const response = await POST(request());
  expect(await response.json()).toEqual(result);
  expect(response.headers.get('cache-control')).toBe('no-store');
  await expect(executeAdsManagementTool(actor, 'apply_ads_change', payload)).resolves.toEqual(result);
  expect(state.performAdsManagement).toHaveBeenNthCalledWith(1, actor, payload);
  expect(state.performAdsManagement).toHaveBeenNthCalledWith(2, actor, payload);
});
it('rejects cross-origin and unauthenticated HTTP before dispatch', async () => {
  expect((await POST(request('apply', 'https://foreign.test'))).status).toBe(403);
  state.viewer.mockRejectedValue(new Error('no session'));
  expect((await POST(request())).status).not.toBe(200);
  expect(state.performAdsManagement).not.toHaveBeenCalled();
});
it('preserves the single-send no-dispatch marker without exposing raw failures', async () => {
  state.performAdsManagement.mockRejectedValueOnce(new AdsNoDispatchError('forbidden', 'Channel access changed.'));
  expect(await (await POST(request())).json()).toMatchObject({ attempt: 'not_dispatched', code: 'forbidden' });
  state.performAdsManagement.mockRejectedValueOnce(new Error('secret-provider-token'));
  const data = await (await POST(request())).json();
  expect(data.attempt).toBeUndefined(); expect(JSON.stringify(data)).not.toContain('secret-provider-token');
});
it('HTTP and MCP source discovery preserve key scope and enforce source result ceilings', async () => {
  const sources = { targets: [{ id: 'channel' }], images: [{ id: 'image' }] };
  state.listAdsCreativeSources.mockResolvedValue(sources);
  const url = 'https://app.test/api/ads/management?view=creative-sources&adAccountId=account&targetOffset=25&imageAfter=cursor';
  expect(await (await GET(new Request(url))).json()).toEqual(sources);
  expect(state.listAdsCreativeSources).toHaveBeenCalledWith(actor, { adAccountId: 'account', targetOffset: 25, imageAfter: 'cursor' });
  const keyActor = { ...actor, allowedAdAccountIds: ['account'], allowedTargetIds: ['channel'] };
  await expect(executeAdsManagementTool(keyActor, 'list_ads_creative_sources', { adAccountId: 'account' }, 1)).resolves.toEqual(sources);
  expect(state.listAdsCreativeSources).toHaveBeenLastCalledWith(keyActor, { adAccountId: 'account', limit: 1 });
  state.listAdsCreativeSources.mockResolvedValue({ ...sources, images: [{}, {}] });
  await expect(executeAdsManagementTool(keyActor, 'list_ads_creative_sources', { adAccountId: 'account' }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
  expect(adsManagementToolDefinitions.find(tool => tool.name === 'list_ads_creative_sources')).toBeDefined();
});

it('serves private stored-image previews through the same account authorization service', async () => {
  state.readAdsCreativeImage.mockResolvedValue({ bytes: Buffer.from('image'), mimeType: 'image/png' });
  const response = await GET(new Request('https://app.test/api/ads/management?view=creative-image&adAccountId=account&mediaId=image'));
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.text()).toBe('image');
  expect(state.readAdsCreativeImage).toHaveBeenCalledWith(actor, { adAccountId: 'account', mediaId: 'image' });
});
