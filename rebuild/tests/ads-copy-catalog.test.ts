import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ADS_MODULE_CONFIG } from '../src/modules/ads/config';
import { adsCustomerCopy, adsCustomerCopySchema, bilingualCatalog, defaultAdsCatalogs, localizeAdsMessage } from '../src/modules/ads/copy';
import { AdsCopyProvider } from '../src/modules/ads/ui/AdsCopyProvider';
import { AdsFilterForm } from '../src/modules/ads/ui/AdsFilterForm';
import { ADS_REPORT_DEFAULT_POLICY } from '../src/modules/ads/report-policy';
const config = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: config.read }));
import { loadAdsCopy, adsServiceText, withAdsCopySnapshot } from '../src/modules/ads/server/copy';

describe('Root Ads bilingual catalogs', () => {
  it('registers active validated catalogs with complete French and English fields', () => {
    const entries = ADS_MODULE_CONFIG.filter(entry => ['ads.customerCopy', 'ads.analysisCopy', 'ads.creativeCopy'].includes(entry.key));
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.consumption).toBe('active');
      expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
    }
    for (const pair of Object.values(adsCustomerCopy)) {
      expect(pair.en.trim().length).toBeGreaterThan(0);
      expect(pair.fr.trim().length).toBeGreaterThan(0);
      for (const match of pair.fr.matchAll(/\{(\w+)\}/g)) expect(pair.en).toContain(`{${match[1]}}`);
    }
    const missingFrench = structuredClone(adsCustomerCopy) as unknown as Record<string, Record<string, string>>;
    delete missingFrench.text001.fr;
    expect(adsCustomerCopySchema.safeParse(missingFrench).success).toBe(false);
    expect(adsCustomerCopySchema.safeParse({ ...adsCustomerCopy, unknown: { en: 'Unknown', fr: 'Inconnu' } }).success).toBe(false);
  });
  it('loads Root values for services and interactive customer controls', async () => {
    const catalogs = structuredClone(defaultAdsCatalogs);
    catalogs.customer.text080 = { en: 'Choose your report', fr: 'Choisissez votre rapport' };
    catalogs.customer.service011 = { en: 'Pick your account.', fr: 'Choisissez votre compte.' };
    config.read.mockImplementation(async (key: string) => ({ 'ads.customerCopy': catalogs.customer, 'ads.analysisCopy': bilingualCatalog(catalogs.analysis), 'ads.creativeCopy': bilingualCatalog(catalogs.creative) })[key]);
    config.read.mockClear();
    await withAdsCopySnapshot(async () => {
      const [first, second] = await Promise.all([loadAdsCopy(), withAdsCopySnapshot(() => loadAdsCopy())]);
      expect(first).toBe(second);
      expect(first).toEqual(catalogs);
      expect(await adsServiceText('service011')).toBe('Pick your account.');
    });
    expect(config.read).toHaveBeenCalledTimes(3);
    expect(await adsServiceText('service011', {}, 'fr')).toBe('Choisissez votre compte.');
    const html = renderToStaticMarkup(createElement(AdsCopyProvider, { catalogs, locale: 'fr', children: createElement(AdsFilterForm, { accounts: [], values: { period: '30d', since: '', until: '', account: 'all' }, action: '/ads', policy: ADS_REPORT_DEFAULT_POLICY }) }));
    expect(html).toContain('Choisissez votre rapport');
    expect(html).toContain('Appliquer les filtres');
  });
  it('localizes parser defaults and current service text without changing unknown messages', () => {
    const catalogs = structuredClone(defaultAdsCatalogs);
    catalogs.customer.validation069.fr = 'Période autorisée : {value0} jours.';
    expect(localizeAdsMessage(catalogs, 'fr', 'Choose a date range of 14 days or fewer.')).toBe('Période autorisée : 14 jours.');
    catalogs.customer.service011.en = 'Pick your account.';
    catalogs.customer.service011.fr = 'Choisissez votre compte.';
    expect(localizeAdsMessage(catalogs, 'fr', 'Pick your account.')).toBe('Choisissez votre compte.');
    expect(localizeAdsMessage(catalogs, 'fr', 'Unknown safe provider explanation')).toBe('Unknown safe provider explanation');
  });
});
