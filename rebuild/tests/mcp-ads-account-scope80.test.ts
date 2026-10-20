import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    membership: { findUnique: vi.fn(), findFirst: vi.fn() },
    target: { findMany: vi.fn() },
    adAccount: { findFirst: vi.fn(), findMany: vi.fn() },
    adInsight: { findFirst: vi.fn(), findMany: vi.fn() },
    workspaceDataPurge: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  platformAds: vi.fn(),
  perform: vi.fn(),
  entitlements: vi.fn(),
  permissions: vi.fn(),
  config: vi.fn(),
  readPolicy: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: vi.fn(async () => ({ workspaceId: 'w1', invalidatedAt: null })) }));
vi.mock('../src/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: mocks.readPolicy }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: mocks.platformAds }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: () => true, hasPlatformCapability: () => true, entitledPlatformIds: () => ['facebook'] }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: () => 'token' }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn(async () => undefined) }));
vi.mock('../src/server/platforms/resource-lock', () => ({ lockSelectedResources: vi.fn(), withSelectedResourceOperation: vi.fn() }));
vi.mock('../src/modules/ads/management/server', async importOriginal => {
  const real = await importOriginal<typeof import('../src/modules/ads/management/server')>();
  return { ...real, performAdsManagement: mocks.perform };
});

import { getAdsAccountWhere, getAdsAccounts, getAdsDataset } from '@/modules/ads/server/queries';
import { authorizeAdsRead } from '../src/modules/ads/server/access';
import { canManageWorkspaceAds, canReadWorkspaceAds, campaignCreationConfirmation, createWorkspaceAdCampaign, readWorkspaceAdObject, updateWorkspaceAd } from '@/modules/ads/server/actions';

const base = { userId: 'u1', workspaceId: 'w1' };
const filters = { since: new Date('2026-10-01'), until: new Date('2026-10-08') } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readPolicy.mockResolvedValue({ maxRows: 100, pageSize: 10 });
  mocks.prisma.target.findMany.mockResolvedValue([{ socialAccountId: 'sa1' }]);
  mocks.prisma.adAccount.findMany.mockResolvedValue([{ id: 'acct-a' }]);
  mocks.prisma.adInsight.findMany.mockResolvedValue([]);
  mocks.prisma.adAccount.findFirst.mockResolvedValue(null);
  mocks.prisma.user.findUnique.mockResolvedValue({ disabledAt: null });
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'owner' });
  mocks.prisma.membership.findFirst.mockResolvedValue({ role: 'owner' });
  mocks.entitlements.mockResolvedValue({ workspaceId: 'w1' });
  mocks.permissions.mockResolvedValue({ pageScope: { all: true } });
  mocks.config.mockImplementation(async(key:string)=>key==='ads.managementPolicy'?{historyPageLimit:50,creativePageLimit:25,nameMaxCharacters:100,maxBudgetMinor:100000000}:true);
});

describe('Ads account ceiling in queries', () => {
  it('adds the id ceiling independently of channel authority; undefined adds nothing', async () => {
    const restricted = await getAdsAccountWhere('w1', ['t1'], ['facebook'], ['acct-a']);
    expect(restricted).toMatchObject({ socialAccountId: { in: ['sa1'] }, id: { in: ['acct-a'] } });
    const open = await getAdsAccountWhere('w1', ['t1'], ['facebook']);
    expect(open).not.toHaveProperty('id');
  });

  it('explicit empty list matches no account while undefined preserves access', async () => {
    await getAdsAccounts('w1', undefined, ['facebook'], []);
    expect(mocks.prisma.adAccount.findMany.mock.calls[0]![0].where.id).toEqual({ in: [] });
    mocks.prisma.adAccount.findMany.mockClear();
    await getAdsAccounts('w1', undefined, ['facebook'], undefined);
    expect(mocks.prisma.adAccount.findMany.mock.calls[0]![0].where).not.toHaveProperty('id');
  });

  it('dataset never reads insights of a sibling account the ceiling excludes', async () => {
    mocks.prisma.adAccount.findMany.mockResolvedValue([{ id: 'acct-a' }]);
    await getAdsDataset('w1', { ...(filters as object), accountId: 'acct-b' } as never, undefined, ['facebook'], { allowedAdAccountIds: ['acct-a'] });
    expect(mocks.prisma.adInsight.findMany.mock.calls[0]![0].where.adAccount.id).toEqual({ in: [] });
    mocks.prisma.adInsight.findMany.mockClear();
    await getAdsDataset('w1', filters, undefined, ['facebook'], { allowedAdAccountIds: [] });
    expect(mocks.prisma.adAccount.findMany.mock.calls.at(-1)![0].where.id).toEqual({ in: [] });
  });
});

describe('Ads read authorization forwards the ceiling', () => {
  it('returns the explicit empty ceiling and omits it when undefined', async () => {
    const restricted = await authorizeAdsRead({ ...base, allowedAdAccountIds: [] });
    expect(restricted.allowedAdAccountIds).toEqual([]);
    expect(restricted.actor).toMatchObject({ allowedAdAccountIds: [] });
    const open = await authorizeAdsRead(base);
    expect(open.allowedAdAccountIds).toBeUndefined();
    expect(open.actor).not.toHaveProperty('allowedAdAccountIds');
  });
});

describe('Ads actions refuse sibling accounts before any lookup or provider call', () => {
  it('read/manage gates refuse accounts outside the ceiling, including empty', async () => {
    expect(await canReadWorkspaceAds({ ...base, allowedAdAccountIds: ['acct-a'] }, 'acct-b')).toBe(false);
    expect(await canReadWorkspaceAds({ ...base, allowedAdAccountIds: [] }, 'acct-a')).toBe(false);
    expect(await canManageWorkspaceAds({ ...base, allowedAdAccountIds: ['acct-a'] }, 'acct-b')).toBe(false);
    expect(await canManageWorkspaceAds({ ...base, allowedAdAccountIds: [] }, 'acct-a')).toBe(false);
    expect(mocks.prisma.adAccount.findFirst).not.toHaveBeenCalled();
    expect(mocks.platformAds).not.toHaveBeenCalled();
  });

  it('live object read and creation confirmation refuse and never reach the provider', async () => {
    await expect(readWorkspaceAdObject({ ...base, allowedAdAccountIds: ['acct-a'] }, { adAccountId: 'acct-b', objectId: 'o1', objectType: 'campaign' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(readWorkspaceAdObject({ ...base, allowedAdAccountIds: [] }, { adAccountId: 'acct-a', objectId: 'o1', objectType: 'campaign' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(campaignCreationConfirmation('w1', 'acct-b', 'n', 'o', ['acct-a'])).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.platformAds).not.toHaveBeenCalled();
  });

  it('live object read for an allowed account is scoped by an AND id ceiling, not an overriding id', async () => {
    mocks.prisma.adAccount.findFirst.mockResolvedValueOnce({socialAccount:{provider:'facebook',scopes:'ads_read',invalidatedAt:null,tokenExpiresAt:null}}).mockResolvedValueOnce(null);
    mocks.platformAds.mockResolvedValue({isReady:async()=>true,readScopes:async()=>['ads_read'],hasReadScopes:()=>true});
    await readWorkspaceAdObject({ ...base, allowedAdAccountIds: ['acct-a'] }, { adAccountId: 'acct-a', objectId: 'o1', objectType: 'campaign' }).catch(() => undefined);
    for (const [arg] of mocks.prisma.adAccount.findFirst.mock.calls) expect(arg.where.id).toBe('acct-a');
    expect(mocks.prisma.adAccount.findFirst.mock.calls.some(([arg]) => JSON.stringify(arg.where.AND) === JSON.stringify([{ id: { in: ['acct-a'] } }]))).toBe(true);
  });

  it('writes forward the ceiling into the management service, including explicit empty', async () => {
    mocks.perform.mockResolvedValue({ outcome: 'rejected', operationId: 'x', message: 'm' });
    await updateWorkspaceAd({ ...base, allowedAdAccountIds: [] }, { adAccountId: 'acct-a', objectId: 'o1', objectType: 'campaign', status: 'paused', confirmation: 'c', requestId: 'request-0001' });
    expect(mocks.perform.mock.calls[0]![0]).toMatchObject({ allowedAdAccountIds: [] });
    await createWorkspaceAdCampaign({ ...base, allowedAdAccountIds: ['acct-a'] }, { adAccountId: 'acct-a', name: 'n', objective: 'o', confirmation: 'c', requestId: 'request-0002' });
    expect(mocks.perform.mock.calls[1]![0]).toMatchObject({ allowedAdAccountIds: ['acct-a'] });
    await updateWorkspaceAd(base, { adAccountId: 'acct-a', objectId: 'o1', objectType: 'campaign', status: 'paused', confirmation: 'c', requestId: 'request-0003' });
    expect(mocks.perform.mock.calls[2]![0]).not.toHaveProperty('allowedAdAccountIds');
  });
});

describe('Ads management service applies the ceiling (real service, provider never called)', () => {
  it('preview, describe, history and creatives refuse or hide sibling accounts', async () => {
    const real = await vi.importActual<typeof import('../src/modules/ads/management/server')>('../src/modules/ads/management/server');
    const empty = { ...base, allowedAdAccountIds: [] as string[] };
    mocks.prisma.adAccount.findFirst.mockImplementation(async ({ where }: { where: { id: string; AND?: Array<{ id: { in: string[] } }> } }) => (where.AND?.[0]?.id.in.includes(where.id) ? { id: where.id } : null));
    await expect(real.previewAdsManagement(empty, { adAccountId: 'acct-a', operation: { type: 'status.set', objectType: 'campaign', objectId: 'o1', status: 'paused' } })).rejects.toMatchObject({ code: 'reconnect_required' });
    await expect(real.listAdsCreatives({ ...base, allowedAdAccountIds: ['acct-a'] }, { adAccountId: 'acct-b' })).rejects.toMatchObject({ code: 'reconnect_required' });
    expect(mocks.platformAds).not.toHaveBeenCalled();

    mocks.prisma.adAccount.findMany.mockResolvedValue([]);
    const page = await real.listAdsOperations(empty);
    expect(page.items).toEqual([]);
    expect(mocks.prisma.adAccount.findMany.mock.calls.at(-1)![0].where.AND).toEqual([{ id: { in: [] } }]);
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();

    await real.listAdsOperations(base);
    expect(mocks.prisma.adAccount.findMany.mock.calls.at(-1)![0].where).not.toHaveProperty('AND');
  });

  it('history resolution of a sibling account change is not found and never writes', async () => {
    const real = await vi.importActual<typeof import('../src/modules/ads/management/server')>('../src/modules/ads/management/server');
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: 'op1', adAccountId: 'acct-b', status: 'uncertain' }]);
    mocks.prisma.adAccount.findFirst.mockResolvedValue(null);
    await expect(real.resolveAdsOperation({ ...base, allowedAdAccountIds: ['acct-a'] }, { operationId: 'op1', resolution: 'applied', confirmation: real.resolutionConfirmation('op1', 'applied') })).rejects.toMatchObject({ code: 'not_found' });
    expect(mocks.prisma.adAccount.findFirst.mock.calls[0]![0].where.AND).toEqual([{ id: { in: ['acct-a'] } }]);
    expect(mocks.platformAds).not.toHaveBeenCalled();
  });
});

it('intersects the credential platform ceiling with fresh service entitlements', async () => {
 const denied=await authorizeAdsRead({...base,allowedPlatformIds:[]});
 expect(denied.allowedProviders).toEqual([]);
 const allowed=await authorizeAdsRead({...base,allowedPlatformIds:['facebook']});
 expect(allowed.allowedProviders).toEqual(['facebook']);
});
