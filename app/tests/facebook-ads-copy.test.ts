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

describe('Facebook Ads validation identities and safe provider failures', () => {
  const campaign = { type: 'campaign.create', objectType: 'campaign', name: 'Spring', objective: 'OUTCOME_TRAFFIC' } as const;
  it.each([
    [{ ...operation, parentId: '' }, 'parentAdSetInvalid'],
    [{ ...operation, creativeId: '' }, 'creativeInvalid'],
    [{ ...operation, name: '' }, 'nameInvalid'],
    [{ ...campaign, objective: 'unsupported' }, 'objectiveInvalid'],
    [{ type: 'rename', objectType: 'campaign', objectId: '', name: 'Spring' }, 'objectInvalid'],
    [{ type: 'budget.set', objectType: 'campaign', objectId: '123', budget: { kind: 'daily', minor: -1 } }, 'budgetInvalid'],
    [{ type: 'creative.create', objectType: 'creative', name: 'Spring', targetId: '123', mediaId: 'img', format: 'link', message: '', title: '', linkUrl: 'http://example.test' }, 'destinationCredentialsInvalid'],
  ] as const)('uses Root French copy and a stable issue for %j', (invalid, key) => {
    const copy = structuredClone(FACEBOOK_ADS_COPY);
    copy[key].fr = key === 'nameInvalid' ? 'Nom refusé : {max} caractères.' : `Message personnalisé : ${key}`;
    const host = createFacebookAdsOps(vi.fn(), undefined, facebookAdsText(copy, 'fr'));
    try {
      host.validate(invalid as unknown as Parameters<typeof host.validate>[0]);
      expect.fail('Expected validation to refuse this operation');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_request', issueCode: key, message: facebookAdsText(copy, 'fr')(key, { max: 100 }) });
    }
  });
  it('maps legacy campaign and ad-set validators through the same catalog', async () => {
    const { validateFacebookCampaign, validateFacebookAdSet } = await import('@/platforms/facebook/ads');
    const text = facebookAdsText(FACEBOOK_ADS_COPY, 'fr');
    expect(() => validateFacebookCampaign('Spring', 'unsupported', text)).toThrow(FACEBOOK_ADS_COPY.objectiveInvalid.fr);
    expect(() => validateFacebookAdSet({ name: 'Spring', dailyBudgetMinor: 100, countryCode: 'bad', optimizationGoal: 'LINK_CLICKS' }, text)).toThrow(FACEBOOK_ADS_COPY.countryCodeInvalid.fr);
  });
  it('classifies current policy refusals independently of translated wording', async () => {
    const copy = structuredClone(FACEBOOK_ADS_COPY);
    copy.creationOptionInvalid.fr = 'Autre choix requis.';
    const ui = structuredClone(FACEBOOK_ADS_UI_DEFAULTS);
    ui.campaign.options = [{ value: 'OUTCOME_SALES', label: 'Sales' }];
    const host = createFacebookAdsOps(vi.fn(), async () => ui, facebookAdsText(copy, 'fr'));
    await expect(host.validateCurrent!(campaign)).rejects.toMatchObject({ code: 'invalid_request', issueCode: 'creationOptionInvalid', message: 'Autre choix requis.' });
  });
  it('maps unavailable policy by code even with unrelated diagnostic wording', async () => {
    const { FacebookAdsOpsError } = await import('@/platforms/facebook/ads-ops/transport');
    const host = createFacebookAdsOps(vi.fn(), async () => { throw new FacebookAdsOpsError('Private diagnostic', { status: 0, beforeWrite: true }, 'creationPolicyUnavailable'); }, facebookAdsText(FACEBOOK_ADS_COPY, 'fr'));
    await expect(host.validateCurrent!(campaign)).rejects.toMatchObject({ code: 'unavailable', issueCode: 'creationPolicyUnavailable', message: FACEBOOK_ADS_COPY.creationPolicyUnavailable.fr });
  });
  it('falls back safely when a stored catalog predates the added error fields', async () => {
    const copy = structuredClone(FACEBOOK_ADS_COPY) as Partial<typeof FACEBOOK_ADS_COPY>;
    delete copy.parentAdSetInvalid;
    vi.mocked(runtimeConfig).mockResolvedValue(copy as never);
    const host = await configuredFacebookAdsOps('fr');
    expect(() => host.validate({ ...operation, parentId: '' })).toThrow(FACEBOOK_ADS_COPY.parentAdSetInvalid.fr);
  });
  it('keeps Graph details out of customer messages without weakening rejection evidence', async () => {
    const { createFacebookAdsTransport, classifyFacebookAdsFailure } = await import('@/platforms/facebook/ads-ops/transport');
    const config = { graphBaseUrl: 'https://graph.example.test', oauthBaseUrl: 'https://oauth.example.test', graphVersion: 'v99.0', requestTimeoutMs: 1000, maxPages: 1, pageSize: 1, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1000, allowedImageMimeTypes: ['image/png'], appSecretProofEnabled: false };
    const copy = structuredClone(FACEBOOK_ADS_COPY);
    copy.providerFailure.fr = 'Demande refusée. Vérifiez votre compte.';
    for (const [status, code, expected] of [[400, 100, 'rejected'], [503, 100, 'uncertain'], [400, undefined, 'uncertain']] as const) {
      const transport = createFacebookAdsTransport(config, vi.fn(async () => new Response(JSON.stringify({ error: { message: 'private-token raw provider detail', code } }), { status })), facebookAdsText(copy, 'fr'));
      const error = await transport.post('123', 'secret', {}).catch(error => error);
      expect(error).toMatchObject({ issueCode: 'providerFailure', message: copy.providerFailure.fr, detail: { status } });
      expect(classifyFacebookAdsFailure(error)).toBe(expected);
      expect(error.message).not.toMatch(/private-token|raw provider|secret/);
    }
  });
});
