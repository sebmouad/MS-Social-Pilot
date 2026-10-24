import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ config: vi.fn(), list: vi.fn(), viewer: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: (request: Request) => new URL(request.url).origin }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock('@/modules/ads/management/server', () => ({
  describeAdsManagement: vi.fn(), readAdsCreativeImage: vi.fn(), listAdsCreativeSources: vi.fn(), listAdsCreatives: vi.fn(),
  listAdsOperations: state.list, performAdsManagement: vi.fn(), previewAdsManagement: vi.fn(), resolveAdsOperation: vi.fn(),
}));
import { GET, POST } from '../src/app/api/ads/management/route';
import { adsCustomerCopy, adsAnalysisCatalog, adsCreativeCatalog } from '../src/modules/ads/copy';

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace' });
  state.config.mockImplementation(async (key: string) => ({ 'ads.customerCopy': adsCustomerCopy, 'ads.analysisCopy': adsAnalysisCatalog, 'ads.creativeCopy': adsCreativeCatalog })[key]);
});
const request = (suffix: string, body?: string, origin = 'https://example.test') => new Request(`https://example.test/api/ads/management${suffix}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'accept-language': 'fr', origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body }) });

it('localizes invalid view and request transport branches from the Ads catalog', async () => {
  const view = await GET(request('?view=invalid'));
  expect(view.status).toBe(400);
  expect((await view.json()).error).toBe(adsCustomerCopy.managementInvalidView.fr);
  const invalid = await POST(request('', 'null'));
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error).toBe(adsCustomerCopy.managementInvalidRequest.fr);
});
it('uses customized Root transport copy for a French request', async () => {
  const custom = structuredClone(adsCustomerCopy);
  custom.managementInvalidView.fr = 'Choisissez votre affichage personnalisé.';
  state.config.mockImplementation(async (key: string) => key === 'ads.customerCopy' ? custom : key === 'ads.analysisCopy' ? adsAnalysisCatalog : adsCreativeCatalog);
  expect((await (await GET(request('?view=invalid'))).json()).error).toBe(custom.managementInvalidView.fr);
});
it('localizes fallback failures and refuses cross-origin writes before authentication', async () => {
  state.list.mockRejectedValue(new Error('private provider diagnostic'));
  expect((await (await GET(request(''))).json()).error).toBe(adsCustomerCopy.managementLoadFailure.fr);
  state.viewer.mockClear();
  const denied = await POST(request('', '{}', 'https://other.test'));
  expect(denied.status).toBe(403);
  expect((await denied.json()).error).toBe(adsCustomerCopy.managementOriginDenied.fr);
  expect(state.viewer).not.toHaveBeenCalled();
});
