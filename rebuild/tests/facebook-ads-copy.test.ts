import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(), runtimeSecret: vi.fn() }));
import { runtimeConfig } from '@/server/config/store';
import { FACEBOOK_ADS_COPY, FACEBOOK_ADS_COPY_SCHEMA, facebookAdsText } from '@/platforms/facebook/ads-copy';
import { FACEBOOK_ADS_CREATION_UI_SCHEMA, FACEBOOK_ADS_UI_DEFAULTS } from '@/platforms/facebook/ads-ui-config';
import { configuredFacebookAdsOps, createFacebookAdsOps, facebookAdsConfirmation, validateFacebookAdsOperation } from '@/platforms/facebook/ads-ops';
import { defaultAdsCatalogs, localizeAdsMessage } from '@/modules/ads/copy';

const operation = { type: 'ad.create', objectType: 'ad', parentId: 'set1', creativeId: 'creative1', name: 'Printemps' } as const;
describe('Facebook Ads Root copy', () => {
  it('validates both languages and preserves confirmation binding placeholders', () => {
    expect(FACEBOOK_ADS_COPY_SCHEMA.safeParse(FACEBOOK_ADS_COPY).success).toBe(true);
    const copy = structuredClone(FACEBOOK_ADS_COPY);
    copy.confirmAdCreate.fr = copy.confirmAdCreate.fr.replace('{creativeId}', '');
    expect(FACEBOOK_ADS_COPY_SCHEMA.safeParse(copy).success).toBe(false);
    copy.confirmAdCreate.fr = FACEBOOK_ADS_COPY.confirmAdCreate.fr + ' {unknown}';
    expect(FACEBOOK_ADS_COPY_SCHEMA.safeParse(copy).success).toBe(false);
  });
  it('resolves runtime copy into the same host for labels, validation and exact confirmation', async () => {
    const copy = structuredClone(FACEBOOK_ADS_COPY);
    copy.adCreateLabel.fr = 'Ajouter une publicité en pause';
    vi.mocked(runtimeConfig).mockResolvedValue(copy as never);
    const host = await configuredFacebookAdsOps('fr');
    expect(runtimeConfig).toHaveBeenCalledWith('meta.adsCopy');
    expect(host.operations.find(item => item.id === 'ad.create')?.label).toBe(copy.adCreateLabel.fr);
    expect(host.confirmation(operation, { adAccountId: 'account1', currency: null })).toContain('AVEC LE VISUEL creative1');
    expect(() => host.validate({ ...operation, name: '\u0001' })).toThrow('caractères imprimables');
  });
  it('keeps quoted names literal while replacing only template placeholders', () => {
    const phrase = facebookAdsConfirmation({ ...operation, name: '{adAccountId} "quoted"' }, { adAccountId: 'account1', currency: null }, facebookAdsText(FACEBOOK_ADS_COPY, 'fr'));
    expect(phrase).toContain(JSON.stringify('{adAccountId} "quoted"'));
    expect(phrase).toContain('DU COMPTE account1');
  });
  it('declares complete ad creation metadata and rejects missing labels', () => {
    expect(FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(FACEBOOK_ADS_UI_DEFAULTS).success).toBe(true);
    expect(FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse({ ...FACEBOOK_ADS_UI_DEFAULTS, ad: { ...FACEBOOK_ADS_UI_DEFAULTS.ad, creativeLabel: '' } }).success).toBe(false);
  });
  it('localizes existing pure validator errors through the customer catalog', () => {
    expect(() => validateFacebookAdsOperation({ ...operation, name: '' })).toThrow('printable characters');
    expect(localizeAdsMessage(defaultAdsCatalogs, 'fr', 'Names must contain 1 to 100 printable characters.')).toBe('Les noms doivent contenir de 1 à 100 caractères imprimables.');
  });
});
