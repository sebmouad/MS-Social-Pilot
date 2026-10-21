import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdsHost } from '@/server/platforms/host';
import type { AdsOpsHost } from '@/modules/ads/management/types';
const state = vi.hoisted(() => ({ config: vi.fn(), factory: vi.fn(), hosts: {} as Record<string, { ads: PlatformAdsHost }> }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config, runtimeSecret: vi.fn() }));
vi.mock('@/platforms', async importOriginal => ({ ...await importOriginal<typeof import('@/platforms')>(), PLATFORM_MODULES: [], platformModule: (id: string) => id === 'testnet' ? { enabledKey: 'testnet.enabled', capabilities: { ads: 'supported' } } : null }));
vi.mock('@/server/platforms/index', () => ({ PLATFORM_HOSTS: state.hosts }));
import { platformAds } from '@/server/platforms/registry';
import { platformAdsLocale, withPlatformAdsLocale } from '@/server/platforms/host';
import { withAdsErrorBoundary, adsErrorResponse } from '@/modules/ads/server/errors';
import { adsServiceText } from '@/modules/ads/server/copy';
import { defaultAdsCatalogs, bilingualCatalog } from '@/modules/ads/copy';
import { configuredFacebookAdsOps } from '@/platforms/facebook/ads-ops';
import { FACEBOOK_ADS_COPY } from '@/platforms/facebook/ads-copy';
import { OperationError } from '@/lib/operation-error';
import { AdsNoDispatchError } from '@/modules/ads/management/errors';

beforeEach(() => {
  vi.clearAllMocks();
  state.config.mockResolvedValue(true);
  state.hosts.testnet = { ads: { configuredOperations: state.factory } as unknown as PlatformAdsHost };
});

describe('configured Ads factory through the neutral host', () => {
  it('resolves current copy for both locales without mutating the installed host', async () => {
    const copy = structuredClone(FACEBOOK_ADS_COPY);
    copy.adCreateLabel.en = 'Add an advertisement';
    copy.adCreateLabel.fr = 'Ajouter une publicité';
    state.config.mockImplementation(async (key: string) => key === 'meta.adsCopy' ? structuredClone(copy) : true);
    state.factory.mockImplementation(configuredFacebookAdsOps);
    const [en, fr] = await Promise.all([platformAds('testnet', 'en'), platformAds('testnet', 'fr')]);
    expect(en?.operations?.operations.find(item => item.id === 'ad.create')?.label).toBe(copy.adCreateLabel.en);
    expect(fr?.operations?.operations.find(item => item.id === 'ad.create')?.label).toBe(copy.adCreateLabel.fr);
    expect(state.hosts.testnet!.ads.operations).toBeUndefined();
    const operation = { type: 'ad.create', objectType: 'ad', parentId: 'set1', name: 'Spring', creativeId: 'creative1' } as const;
    expect(fr?.operations?.confirmation(operation, { adAccountId: 'account1', currency: null })).toContain('AVEC LE VISUEL creative1');
    expect(() => fr?.operations?.validate({ ...operation, name: '' })).toThrow('caractères imprimables');
    copy.adCreateLabel.fr = 'Nouvelle annonce';
    expect((await platformAds('testnet', 'fr'))?.operations?.operations.find(item => item.id === 'ad.create')?.label).toBe('Nouvelle annonce');
  });

  it('carries isolated locale scopes through nested service calls', async () => {
    state.factory.mockImplementation(async locale => ({ provider: locale } as AdsOpsHost));
    const run = (locale: 'en' | 'fr') => withAdsErrorBoundary(async () => {
      await Promise.resolve();
      return withAdsErrorBoundary(async () => (await platformAds('testnet'))?.operations?.provider);
    }, locale);
    expect(await Promise.all([run('fr'), run('en')])).toEqual(['fr', 'en']);
    expect(platformAdsLocale()).toBe('en');
    await expect(withPlatformAdsLocale('fr', async () => { throw new Error('failure'); })).rejects.toThrow('failure');
    expect(platformAdsLocale()).toBe('en');
  });

  it('does not resolve factories for disabled or unknown modules', async () => {
    state.config.mockResolvedValue(false);
    expect(await platformAds('testnet', 'fr')).toBeNull();
    expect(await platformAds('unknown', 'fr')).toBeNull();
    expect(state.factory).not.toHaveBeenCalled();
  });

  it('never falls back to static copy after a configured factory fails', async () => {
    state.hosts.testnet!.ads.operations = { provider: 'static' } as AdsOpsHost;
    state.factory.mockRejectedValueOnce(new Error('copy unavailable'));
    await expect(platformAds('testnet', 'fr')).rejects.toThrow('copy unavailable');
  });

  it('keeps modules without a factory compatible', async () => {
    delete state.hosts.testnet!.ads.configuredOperations;
    expect(await platformAds('testnet')).toBe(state.hosts.testnet!.ads);
  });
});

describe('Ads service runtime locale', () => {
  it('uses the same Root locale for service messages and no-dispatch error responses', async () => {
    const catalogs = structuredClone(defaultAdsCatalogs);
    catalogs.customer.service011 = { en: 'Choose an account.', fr: 'Choisissez votre compte publicitaire.' };
    state.config.mockImplementation(async (key: string) => ({ 'ads.customerCopy': catalogs.customer, 'ads.analysisCopy': bilingualCatalog(catalogs.analysis), 'ads.creativeCopy': bilingualCatalog(catalogs.creative) })[key]);
    await withPlatformAdsLocale('fr', async () => {
      expect(await adsServiceText('service011')).toBe(catalogs.customer.service011.fr);
      const error = new AdsNoDispatchError('invalid_request', catalogs.customer.service011.en);
      await expect(withAdsErrorBoundary(async () => { throw error; })).rejects.toMatchObject({ message: catalogs.customer.service011.fr });
      const response = await adsErrorResponse(new OperationError('invalid_request', catalogs.customer.service011.en), 'invalid');
      expect(await response.json()).toMatchObject({ code: 'invalid_request', error: catalogs.customer.service011.fr });
    });
  });
});
