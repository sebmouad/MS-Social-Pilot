import { beforeEach, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ listAdsCreatives: vi.fn(), listAdsOperations: vi.fn(), performAdsManagement: vi.fn(), previewAdsManagement: vi.fn(), resolveAdsOperation: vi.fn() }));
vi.mock('@/modules/ads/management/server', () => service);
import { adsManagementToolDefinitions, executeAdsManagementTool } from '@/modules/ads/management/mcp';
const actor = { userId: 'user', workspaceId: 'workspace', allowedTargetIds: ['allowed'] };
beforeEach(() => vi.clearAllMocks());
it('requires a stable request ID in advertised write input', () => {
  expect(adsManagementToolDefinitions.find(tool => tool.name === 'apply_ads_change')?.inputSchema.required).toContain('requestId');
});
it('passes authenticated key scope and request identity unchanged', async () => {
  const input = { adAccountId: 'account', operation: { type: 'rename', objectType: 'ad', objectId: 'object', name: 'Name' }, requestId: 'request-identity', confirmation: 'confirmed' };
  await executeAdsManagementTool(actor, 'apply_ads_change', input, 5);
  expect(service.performAdsManagement).toHaveBeenCalledWith(actor, input);
});
it('bounds list pages before invoking a service and refuses oversized complete output', async () => {
  await expect(executeAdsManagementTool(actor, 'list_ads_changes', { limit: 6 }, 5)).rejects.toMatchObject({ code: 'invalid_request' });
  expect(service.listAdsOperations).not.toHaveBeenCalled();
  service.listAdsOperations.mockResolvedValue({ items: Array.from({ length: 6 }, () => ({ id: 'item' })) });
  await expect(executeAdsManagementTool(actor, 'list_ads_changes', {}, 5)).rejects.toMatchObject({ code: 'invalid_request' });
  expect(service.listAdsOperations).toHaveBeenCalledWith(actor, { limit: 5 });
});
it('applies the same ceiling to creative browsing', async () => {
  service.listAdsCreatives.mockResolvedValue({ items: [{ id: 'creative' }], next: null });
  await expect(executeAdsManagementTool(actor, 'list_ads_creatives', { adAccountId: 'account' }, 1)).resolves.toMatchObject({ items: [{ id: 'creative' }] });
  expect(service.listAdsCreatives).toHaveBeenCalledWith(actor, { adAccountId: 'account', limit: 1 });
});
