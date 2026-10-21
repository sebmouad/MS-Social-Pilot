vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  prisma: {
    target: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, adAccount: { findFirst: vi.fn(), findMany: vi.fn() }, adInsight: { findFirst: vi.fn() },
    $executeRaw: vi.fn(), $queryRaw: vi.fn(), $transaction: vi.fn(),
  },
  image: vi.fn(), images: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), canUse: vi.fn(), canAccess: vi.fn(), hasPlatform: vi.fn(), purge: vi.fn(), config: vi.fn(), platformAds: vi.fn(), decrypt: vi.fn(), selectedLock: vi.fn(), selectedOperation: vi.fn(),
  validateManageScopes: vi.fn(),
}));
vi.mock('../src/modules/publishing/server/media/storage', () => ({ readWorkspaceImage: state.image, listWorkspaceImages: state.images }));
vi.mock('../src/server/data', () => ({ prisma: state.prisma }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: state.decrypt }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.canUse, hasPlatformCapability: state.hasPlatform }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.canAccess }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: state.platformAds }));
vi.mock('../src/server/platforms/resource-lock', () => ({ lockSelectedResources: state.selectedLock, withSelectedResourceOperation: state.selectedOperation }));

import { clearAdsOpsHosts, registerAdsOpsHost } from '../src/modules/ads/management/registry';
import { ADS_MANAGEMENT_DEFAULT_POLICY } from '../src/modules/ads/management/config';
import { describeAdsManagement, parseNeutralOperation, performAdsManagement, previewAdsManagement } from '../src/modules/ads/management/server';
import { executeAdsManagementTool } from '../src/modules/ads/management/mcp';
import { defaultAdsCatalogs, localizeAdsMessage } from '../src/modules/ads/copy';
import type { AdsNeutralOperation, AdsOpsHost } from '../src/modules/ads/management/types';
import { OperationError } from '../src/lib/operation-error';

const actor = { userId: 'u1', workspaceId: 'w1' };
const adOp: AdsNeutralOperation = { type: 'ad.create', objectType: 'ad', parentId: 's1', name: 'Spring ad', creativeId: 'cr1' };
const CONFIRM = 'CREATE PAUSED AD Spring ad UNDER s1 WITH cr1';
const execute = vi.fn();
const host: AdsOpsHost = {
  provider: 'testnet',
  operations: [{ id: 'ad.create', objectTypes: ['ad'], spendChanging: true, label: 'Create paused ad' }],
  validate: () => undefined,
  confirmation: op => op.type === 'ad.create' ? `CREATE PAUSED AD ${op.name} UNDER ${op.parentId} WITH ${op.creativeId}` : 'OTHER',
  execute: (...args) => execute(...args), classifyFailure: () => 'uncertain',
  listCreatives: vi.fn(async () => ({ items: [], next: null })),
};

beforeEach(() => {
  vi.clearAllMocks(); clearAdsOpsHosts(); registerAdsOpsHost(host);
  state.prisma.user.findUnique.mockResolvedValue({ disabledAt: null });
  state.prisma.membership.findUnique.mockResolvedValue({ role: 'admin' });
  state.entitlements.mockResolvedValue({ workspaceId: 'w1' });
  state.permissions.mockResolvedValue({ pageScope: { all: true, ids: [] } });
  state.canUse.mockReturnValue(true); state.canAccess.mockReturnValue(true); state.hasPlatform.mockReturnValue(true); state.purge.mockResolvedValue(undefined);
  state.selectedLock.mockResolvedValue(undefined);
  state.selectedOperation.mockImplementation(async (_w: string, _r: unknown, run: (tx: typeof state.prisma, signal: AbortSignal) => Promise<unknown>) => run(state.prisma, new AbortController().signal));
  state.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : ADS_MANAGEMENT_DEFAULT_POLICY);
  state.decrypt.mockReturnValue('token');
  state.prisma.adAccount.findFirst.mockResolvedValue({ id: 'acc1', actId: 'act_1', currency: 'USD', socialAccount: { provider: 'testnet', accessToken: 'enc', scopes: 'ads_management', invalidatedAt: null, tokenExpiresAt: null } });
  state.prisma.adInsight.findFirst.mockResolvedValue({ id: 'i1' });
  state.validateManageScopes.mockReset();
  state.platformAds.mockResolvedValue({ isReady: async () => true, manageScopes: async () => ['ads_management'], readScopes: async () => ['ads_read'], validateManageScopes: state.validateManageScopes, hasReadScopes: () => true });
  state.prisma.$executeRaw.mockResolvedValue(1);
  state.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => /FOR UPDATE/.test(strings.join('?')) ? [{ status: 'pending', remoteId: null }] : []);
  state.prisma.$transaction.mockImplementation(async (arg: unknown) => typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(state.prisma) : Promise.all(arg as Promise<unknown>[]));
  execute.mockResolvedValue({ remoteId: 'ad-new' });
});

describe('paused ad creation through the shared management service', () => {
  it('parses strictly: no objectId or status, safe ids, trimmed name', () => {
    expect(parseNeutralOperation({ ...adOp, name: ' Spring ad ' })).toEqual(adOp);
    for (const bad of [
      { ...adOp, objectId: 'x' }, { ...adOp, status: 'active' }, { ...adOp, objectType: 'adset' }, { ...adOp, parentId: 'bad id' }, { ...adOp, parentId: undefined },
      { ...adOp, creativeId: '' }, { ...adOp, creativeId: undefined }, { ...adOp, name: 5 },
    ]) expect(() => parseNeutralOperation(bad), JSON.stringify(bad)).toThrow(OperationError);
  });

  it('previews the module confirmation with a spend warning, verifying the ad set from stored history', async () => {
    const preview = await previewAdsManagement(actor, { adAccountId: 'acc1', operation: adOp });
    expect(preview).toMatchObject({ confirmation: CONFIRM, spendChanging: true, irreversible: false });
    expect(state.prisma.adInsight.findFirst).toHaveBeenCalledWith({ where: { adAccountId: 'acc1', level: 'adset', objectId: 's1' }, select: { id: true } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('journals one open creation per parent ad set, then returns created only after provider success', async () => {
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: adOp, confirmation: CONFIRM, requestId: 'request-0001' });
    expect(result).toMatchObject({ outcome: 'succeeded', recorded: true, remoteId: 'ad-new', created: { objectType: 'ad', remoteId: 'ad-new' } });
    const insert = state.prisma.$executeRaw.mock.calls[0] as unknown[];
    expect(insert).toContain('ad.create'); expect(insert).toContain('@create-ad:s1');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'act_1' }), adOp);
    expect(JSON.stringify(execute.mock.calls[0]![1])).not.toMatch(/status|objectId/);
  });

  it('requires the exact confirmation before any ledger write or provider call', async () => {
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: adOp, confirmation: 'yes', requestId: 'request-0001' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('refuses an ad set that is not in the account history, without a ledger write', async () => {
    state.prisma.adInsight.findFirst.mockResolvedValue(null);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: adOp, confirmation: CONFIRM, requestId: 'request-0001' })).rejects.toMatchObject({ code: 'not_found' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('refuses limited page scope and non-managers because the parent cannot be bounded to channels', async () => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['t1'] } });
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: adOp })).rejects.toMatchObject({ code: 'forbidden' });
    state.permissions.mockResolvedValue({ pageScope: { all: true, ids: [] } });
    await expect(previewAdsManagement({ ...actor, allowedTargetIds: ['t1'] }, { adAccountId: 'acc1', operation: adOp })).rejects.toMatchObject({ code: 'forbidden' });
    state.prisma.membership.findUnique.mockResolvedValue({ role: 'editor' });
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: adOp })).rejects.toMatchObject({ code: 'forbidden' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('is unavailable when the account module does not advertise it', async () => {
    clearAdsOpsHosts();
    registerAdsOpsHost({ ...host, operations: [{ id: 'rename', objectTypes: ['ad'], spendChanging: false, label: 'Rename' }] });
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: adOp })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('serves the same preview through the MCP tool', async () => {
    await expect(executeAdsManagementTool(actor, 'preview_ads_change', { adAccountId: 'acc1', operation: adOp })).resolves.toMatchObject({ confirmation: CONFIRM, spendChanging: true });
  });
});

describe('missing advertising-changes grant', () => {
  const missing = () => state.validateManageScopes.mockImplementation(() => { throw new OperationError('reconnect_required', 'Reconnect this advertising connection and allow advertising changes.'); });

  it('tells management clients to reconnect rather than showing a silent read-only state', async () => {
    missing();
    await expect(describeAdsManagement(actor, 'acc1')).resolves.toEqual({ canManage: false, needsReconnect: true, operations: [], canListCreatives: false });
  });

  it('detects a missing grant by code even when Root changes the English copy', async () => {
    state.validateManageScopes.mockImplementation(() => { throw new OperationError('reconnect_required', 'Autorisez les modifications depuis les paramètres.'); });
    await expect(describeAdsManagement(actor, 'acc1')).resolves.toMatchObject({ canManage: false, needsReconnect: true });
    state.validateManageScopes.mockImplementation(() => { throw new OperationError('unavailable', 'Reconnect this advertising connection and allow advertising changes.'); });
    await expect(describeAdsManagement(actor, 'acc1')).resolves.toMatchObject({ canManage: false, needsReconnect: false });
  });

  it('does not ask to reconnect when management is withheld for another reason', async () => {
    state.prisma.membership.findUnique.mockResolvedValue({ role: 'editor' });
    await expect(describeAdsManagement(actor, 'acc1')).resolves.toMatchObject({ canManage: false, needsReconnect: false });
  });

  it('refuses every write with reconnect_required before any ledger write or provider call', async () => {
    missing();
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: adOp })).rejects.toMatchObject({ code: 'reconnect_required' });
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: adOp, confirmation: CONFIRM, requestId: 'request-0001' })).rejects.toMatchObject({ code: 'reconnect_required' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('localizes the recovery message in French through the Ads catalog', () => {
    const english = 'Reconnect this advertising connection and allow advertising changes.';
    expect(localizeAdsMessage(defaultAdsCatalogs, 'en', english)).toBe(english);
    expect(localizeAdsMessage(defaultAdsCatalogs, 'fr', english)).toBe(defaultAdsCatalogs.customer.grantMissing.fr);
    expect(defaultAdsCatalogs.customer.grantMissing.fr).toMatch(/Reconnectez/);
  });
});
