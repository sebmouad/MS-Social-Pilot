import { describe, expect, it } from 'vitest';
import { adsCustomerCopy, adsCustomerCopySchema } from '../src/modules/ads/copy';
import { isManageDirectoryLevel, manageTabHref, parseManageLevel } from '../src/modules/ads/ui/objects/manage-tabs';

describe('manage tab routing', () => {
  it('defaults unknown levels to campaigns and accepts the adgroup alias', () => {
    expect(parseManageLevel(undefined)).toBe('campaign');
    expect(parseManageLevel('bogus')).toBe('campaign');
    expect(parseManageLevel(['ad'])).toBe('ad');
    expect(parseManageLevel('campaign')).toBe('campaign');
    expect(parseManageLevel('adset')).toBe('adset');
    expect(parseManageLevel('adgroup')).toBe('adset');
    expect(parseManageLevel('ad')).toBe('ad');
    expect(parseManageLevel('creative')).toBe('creative');
  });

  it('knows creatives are not a directory level', () => {
    expect(isManageDirectoryLevel('campaign')).toBe(true);
    expect(isManageDirectoryLevel('adset')).toBe(true);
    expect(isManageDirectoryLevel('ad')).toBe(true);
    expect(isManageDirectoryLevel('creative')).toBe(false);
  });

  it('keeps report and search state across tabs, restarts paging and drops inapplicable parents', () => {
    const shared = { period: '30d', since: undefined, until: undefined, account: 'a1', q: 'Spring', parentId: 'c1', offset: '20' };
    expect(manageTabHref(shared, 'campaign')).toBe('/ads/manage?period=30d&account=a1&q=Spring&level=campaign');
    expect(manageTabHref(shared, 'adset')).toBe('/ads/manage?period=30d&account=a1&q=Spring&parentId=c1&level=adset');
    expect(manageTabHref(shared, 'ad')).toBe('/ads/manage?period=30d&account=a1&q=Spring&parentId=c1&level=ad');
    expect(manageTabHref(shared, 'creative')).toBe('/ads/manage?period=30d&account=a1&q=Spring&level=creative');
    expect(manageTabHref({}, 'campaign')).toBe('/ads/manage?level=campaign');
  });
});

describe('manage tab copy', () => {
  const keys = ['manageTabsLabel', 'manageTabCreatives', 'manageMoreTabs', 'manageStatus', 'manageSynced',
    'manageNoCampaigns', 'manageNoAdSets', 'manageCreateAdSetNote', 'manageCreativesList',
    'manageCreativesEmpty', 'manageCreativesReadOnly', 'manageCreativePreview'] as const;
  it('covers every new key in English and French with matching placeholders', () => {
    for (const key of keys) {
      expect(adsCustomerCopy[key].en.trim().length).toBeGreaterThan(0);
      expect(adsCustomerCopy[key].fr.trim().length).toBeGreaterThan(0);
      for (const match of adsCustomerCopy[key].fr.matchAll(/\{(\w+)\}/g)) expect(adsCustomerCopy[key].en).toContain(`{${match[1]}}`);
    }
    expect(adsCustomerCopySchema.safeParse(adsCustomerCopy).success).toBe(true);
  });
});
