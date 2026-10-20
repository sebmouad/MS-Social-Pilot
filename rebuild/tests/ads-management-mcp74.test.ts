import { beforeEach, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ describeAdsManagement: vi.fn(), readAdsCreativeImage: vi.fn(), listAdsCreatives: vi.fn(), listAdsOperations: vi.fn(), performAdsManagement: vi.fn(), previewAdsManagement: vi.fn(), resolveAdsOperation: vi.fn() }));
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

it('exposes the same management capabilities and image preview as HTTP without dropping key ceilings', async () => {
  service.describeAdsManagement.mockResolvedValue({ canManage: false, operations: [] });
  await expect(executeAdsManagementTool(actor, 'get_ads_management_options', { adAccountId: 'account' }, 5)).resolves.toMatchObject({ operations: [] });
  expect(service.describeAdsManagement).toHaveBeenCalledWith(actor, 'account');
  service.readAdsCreativeImage.mockResolvedValue({ bytes: Buffer.from('image'), mimeType: 'image/png' });
  await expect(executeAdsManagementTool(actor, 'get_ads_creative_image', { adAccountId: 'account', mediaId: 'image.png' }, 5)).resolves.toEqual({ mimeType: 'image/png', byteLength: 5, base64: 'aW1hZ2U=' });
  expect(service.readAdsCreativeImage).toHaveBeenCalledWith(actor, { adAccountId: 'account', mediaId: 'image.png' });
  await expect(executeAdsManagementTool(actor, 'get_ads_creative_image', { adAccountId: 'account' }, 5)).rejects.toMatchObject({ code: 'invalid_request' });
});
