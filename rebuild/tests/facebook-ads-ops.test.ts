import { FACEBOOK_ADS_UI_DEFAULTS } from '../src/platforms/facebook/ads-ui-config';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(), runtimeSecret: vi.fn() }));

import { createFacebookAdsTransport, classifyFacebookAdsFailure, FacebookAdsOpsError } from '../src/platforms/facebook/ads-ops/transport';
import { FACEBOOK_ADS_OPERATIONS, createFacebookAdsOps, facebookAdsConfirmation, validateFacebookAdsOperation } from '../src/platforms/facebook/ads-ops';
import type { AdsNeutralOperation } from '../src/modules/ads/management/types';

const config = {
  graphBaseUrl: 'https://graph.example.test', oauthBaseUrl: 'https://www.example.test', graphVersion: 'v99.0', requestTimeoutMs: 5000, maxPages: 2, pageSize: 25,
  pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1000, allowedImageMimeTypes: ['image/png'], appSecretProofEnabled: true, appSecret: 'secret',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ctx = { credential: { accessToken: 'tok' }, accountId: 'act_1' };

function harness(responses: Array<Response | Error>) {
  const fetchImpl = vi.fn(async (..._args: unknown[]) => { const next = responses.shift(); if (next instanceof Error) throw next; return next ?? json({ success: true }); });
  const ops = createFacebookAdsOps(async () => createFacebookAdsTransport(config, fetchImpl as unknown as typeof fetch), async () => FACEBOOK_ADS_UI_DEFAULTS);
  return { ops, fetchImpl, bodyOf: (index: number) => new URLSearchParams(String((fetchImpl.mock.calls[index]![1] as RequestInit).body)), urlOf: (index: number) => String(fetchImpl.mock.calls[index]![0]) };
}
const owned = (id: string) => json({ id, account_id: '1' });

describe('Facebook ads operations', () => {
  it('enforces current Root creation choices and name limits before any provider request', async () => {
    const ui = structuredClone(FACEBOOK_ADS_UI_DEFAULTS);
    ui.campaign.options = [{ value: 'OUTCOME_TRAFFIC', label: 'Visitors' }];
    ui.campaign.defaultOption = 'OUTCOME_TRAFFIC'; ui.campaign.nameMaxLength = 4;
    const fetchImpl = vi.fn();
    const ops = createFacebookAdsOps(async () => createFacebookAdsTransport(config, fetchImpl), async () => ui);
    const unsupported = { type: 'campaign.create', objectType: 'campaign', name: 'Sale', objective: 'OUTCOME_SALES' } as const;
    await expect(ops.validateCurrent!(unsupported)).rejects.toThrow('current creation option');
    await expect(ops.execute(ctx, { ...unsupported, objective: 'OUTCOME_TRAFFIC', name: 'Too long' })).rejects.toThrow('current creation option');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends no provider request when the enclosing resource operation already aborted', async () => {
    const fetchImpl = vi.fn();
    const transport = createFacebookAdsTransport(config, fetchImpl);
    const controller = new AbortController(); controller.abort();
    const error = await transport.post('object', 'token', { status: 'PAUSED' }, controller.signal).catch(error => error);
    expect(classifyFacebookAdsFailure(error)).toBe('rejected');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps an in-flight aborted write uncertain', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new Error('request aborted');
    });
    const transport = createFacebookAdsTransport(config, fetchImpl as typeof fetch);
    const error = await transport.post('object', 'token', { status: 'PAUSED' }, controller.signal).catch(error => error);
    expect(classifyFacebookAdsFailure(error)).toBe('uncertain');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('advertises exactly the implemented operations', () => {
    expect(FACEBOOK_ADS_OPERATIONS.map(op => op.id).sort()).toEqual(['adset.create', 'budget.set', 'campaign.create', 'creative.assign', 'delete', 'rename', 'status.set']);
    expect(FACEBOOK_ADS_OPERATIONS.find(op => op.id === 'budget.set')!.objectTypes).not.toContain('ad');
    expect(FACEBOOK_ADS_OPERATIONS.filter(op => op.spendChanging).map(op => op.id).sort()).toEqual(['adset.create', 'budget.set', 'campaign.create', 'status.set']);
  });

  it('verifies ownership with a signed read, then sends one signed form write', async () => {
    const h = harness([owned('c1'), json({ success: true })]);
    const result = await h.ops.execute(ctx, { type: 'status.set', objectType: 'campaign', objectId: 'c1', status: 'active' });
    expect(result).toEqual({ remoteId: 'c1' });
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    expect(h.urlOf(0)).toContain('/v99.0/c1?');
    expect(h.urlOf(0)).toContain('appsecret_proof=');
    expect((h.fetchImpl.mock.calls[1]![1] as RequestInit).method).toBe('POST');
    expect(Object.fromEntries(h.bodyOf(1))).toMatchObject({ status: 'ACTIVE', access_token: 'tok' });
    expect(h.bodyOf(1).get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [{ type: 'status.set', objectType: 'ad', objectId: 'x', status: 'paused' }, { status: 'PAUSED' }],
    [{ type: 'budget.set', objectType: 'adset', objectId: 'x', budget: { kind: 'daily', minor: 1500 } }, { daily_budget: '1500' }],
    [{ type: 'budget.set', objectType: 'campaign', objectId: 'x', budget: { kind: 'lifetime', minor: 90000 } }, { lifetime_budget: '90000' }],
    [{ type: 'rename', objectType: 'campaign', objectId: 'x', name: 'New name' }, { name: 'New name' }],
    [{ type: 'delete', objectType: 'ad', objectId: 'x' }, { status: 'DELETED' }],
  ] as Array<[AdsNeutralOperation, Record<string, string>]>)('maps %j to the expected write', async (operation, expected) => {
    const h = harness([owned('x'), json({ success: true })]);
    await h.ops.execute(ctx, operation);
    expect(Object.fromEntries(h.bodyOf(1))).toMatchObject(expected);
  });

  it('assigns a creative only when both the ad and the creative belong to the account', async () => {
    const h = harness([owned('ad1'), owned('cr1'), json({ success: true })]);
    await h.ops.execute(ctx, { type: 'creative.assign', objectType: 'ad', objectId: 'ad1', creativeId: 'cr1' });
    expect(JSON.parse(h.bodyOf(2).get('creative')!)).toEqual({ creative_id: 'cr1' });
    const foreign = harness([owned('ad1'), json({ id: 'cr9', account_id: '999' })]);
    await expect(foreign.ops.execute(ctx, { type: 'creative.assign', objectType: 'ad', objectId: 'ad1', creativeId: 'cr9' })).rejects.toBeInstanceOf(FacebookAdsOpsError);
    expect(foreign.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses objects of another account before any write', async () => {
    const h = harness([json({ id: 'c1', account_id: '777' })]);
    const error = await h.ops.execute(ctx, { type: 'rename', objectType: 'campaign', objectId: 'c1', name: 'n' }).catch(e => e);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(classifyFacebookAdsFailure(error)).toBe('rejected');
  });

  it('treats timeouts, 5xx, uncoded 4xx, transient and unconfirmed writes as uncertain; explicit Graph rejections as rejected', async () => {
    const op: AdsNeutralOperation = { type: 'status.set', objectType: 'campaign', objectId: 'c1', status: 'paused' };
    const run = async (write: Response | Error) => { const h = harness([owned('c1'), write]); return classifyFacebookAdsFailure(await h.ops.execute(ctx, op).catch(e => e)); };
    expect(await run(new Error('network'))).toBe('uncertain');
    expect(await run(json({ error: { message: 'x' } }, 500))).toBe('uncertain');
    expect(await run(json({ error: { message: 'x' } }, 400))).toBe('uncertain');
    expect(await run(json({ error: { code: 100, message: 'x', is_transient: true } }, 400))).toBe('uncertain');
    expect(await run(json({ ok: 1 }, 200))).toBe('uncertain');
    expect(await run(json({ error: { code: 100, message: 'bad param' } }, 400))).toBe('rejected');
    expect(await run(json({ error: { code: 190, message: 'token' } }, 401))).toBe('rejected');
    expect(classifyFacebookAdsFailure(new Error('unknown'))).toBe('uncertain');
  });

  it('never leaks provider text or tokens in thrown messages', async () => {
    const h = harness([owned('c1'), json({ error: { code: 100, message: 'token tok is bad' } }, 400)]);
    const error = await h.ops.execute(ctx, { type: 'rename', objectType: 'campaign', objectId: 'c1', name: 'n' }).catch(e => e as Error) as Error;
    expect(error.message).not.toContain('tok');
  });

  it('validates input and produces module-owned confirmations with spend warnings', () => {
    expect(() => validateFacebookAdsOperation({ type: 'rename', objectType: 'ad', objectId: 'a', name: 'x'.repeat(101) })).toThrow();
    expect(() => validateFacebookAdsOperation({ type: 'rename', objectType: 'ad', objectId: 'a', name: 'bad\nname' })).toThrow();
    expect(() => validateFacebookAdsOperation({ type: 'budget.set', objectType: 'ad' as never, objectId: 'a', budget: { kind: 'daily', minor: 1 } })).toThrow();
    expect(() => validateFacebookAdsOperation({ type: 'budget.set', objectType: 'campaign', objectId: 'a', budget: { kind: 'daily', minor: 0 } })).toThrow();
    const context = { adAccountId: 'acc1', currency: 'USD' };
    expect(facebookAdsConfirmation({ type: 'status.set', objectType: 'adset', objectId: 'a', status: 'active' }, context)).toBe('RESUME FACEBOOK AD SET a ALLOWING DELIVERY AND SPEND IN ACCOUNT acc1');
    expect(facebookAdsConfirmation({ type: 'budget.set', objectType: 'campaign', objectId: 'a', budget: { kind: 'daily', minor: 500 } }, context)).toBe('SET FACEBOOK CAMPAIGN a DAILY BUDGET TO 500 MINOR UNITS USD IN ACCOUNT acc1');
    expect(facebookAdsConfirmation({ type: 'delete', objectType: 'ad', objectId: 'a' }, context)).toContain('PERMANENTLY');
  });

  it('applies Root limits that are stricter than the protocol constant and advertises neutral input metadata', () => {
    const limits = { nameMaxCharacters: 20, maxBudgetMinor: 10_000 };
    expect(() => validateFacebookAdsOperation({ type: 'rename', objectType: 'ad', objectId: 'a', name: 'x'.repeat(21) }, limits)).toThrow();
    expect(() => validateFacebookAdsOperation({ type: 'rename', objectType: 'ad', objectId: 'a', name: 'x'.repeat(20) }, limits)).not.toThrow();
    expect(() => validateFacebookAdsOperation({ type: 'rename', objectType: 'ad', objectId: 'a', name: 'x'.repeat(101) }, { nameMaxCharacters: 500, maxBudgetMinor: 1 })).toThrow();
    expect(() => validateFacebookAdsOperation({ type: 'budget.set', objectType: 'campaign', objectId: 'a', budget: { kind: 'daily', minor: 10_001 } }, limits)).toThrow();
    expect(() => validateFacebookAdsOperation({ type: 'budget.set', objectType: 'campaign', objectId: 'a', budget: { kind: 'daily', minor: 10_000 } }, limits)).not.toThrow();
    const byId = Object.fromEntries(FACEBOOK_ADS_OPERATIONS.map(op => [op.id, op]));
    expect(byId['budget.set']!.inputs).toEqual([{ name: 'budget', kind: 'money-minor', budgetKinds: ['daily', 'lifetime'] }]);
    expect(byId.delete!.irreversible).toBe(true);
    expect(byId.delete!.inputs).toBeUndefined();
    expect(JSON.stringify(FACEBOOK_ADS_OPERATIONS)).not.toMatch(/ads_management|graph/i);
    // Provider objective values appear only as option values of the creation choice input.
    expect(JSON.stringify(FACEBOOK_ADS_OPERATIONS.filter(op => op.id !== 'campaign.create'))).not.toMatch(/OUTCOME_/);
  });

  it('lists creatives with safe fields, https thumbnails and a cursor only when more exist', async () => {
    const h = harness([json({ data: [{ id: 'cr1', name: 'A', status: 'ACTIVE', title: 't', body: 'b', thumbnail_url: 'https://cdn.test/x.png' }, { id: 'bad id', name: 'x' }, { id: 'cr2', thumbnail_url: 'http://insecure' }], paging: { cursors: { after: 'CUR' }, next: 'https://next' } })]);
    const page = await h.ops.listCreatives!(ctx, { limit: 25 });
    expect(h.urlOf(0)).toContain('/act_1/adcreatives?');
    expect(h.urlOf(0)).toContain('limit=25');
    expect(page.items.map(item => item.id)).toEqual(['cr1', 'cr2']);
    expect(page.items[1]!.thumbnailUrl).toBeNull();
    expect(page.next).toBe('CUR');
    const last = harness([json({ data: [], paging: { cursors: { after: 'CUR' } } })]);
    expect((await last.ops.listCreatives!(ctx, { limit: 5 })).next).toBeNull();
  });

  describe('paused creation', () => {
    const campaign = { type: 'campaign.create', objectType: 'campaign', name: ' Spring ', objective: 'OUTCOME_TRAFFIC' } as AdsNeutralOperation;
    const adset = { type: 'adset.create', objectType: 'adset', parentId: 'c1', name: 'Set', dailyBudgetMinor: 1500, countryCode: 'US', optimizationGoal: 'LINK_CLICKS' } as AdsNeutralOperation;
    const limits = { nameMaxCharacters: 20, maxBudgetMinor: 10_000 };

    it('creates a campaign paused with one signed write and returns the validated id', async () => {
      const h = harness([json({ id: '123' })]);
      expect(await h.ops.execute(ctx, { ...campaign, status: 'ACTIVE' } as unknown as AdsNeutralOperation)).toEqual({ remoteId: '123' });
      expect(h.fetchImpl).toHaveBeenCalledTimes(1);
      expect(h.urlOf(0)).toContain('/v99.0/act_1/campaigns');
      expect(Object.fromEntries(h.bodyOf(0))).toMatchObject({ name: 'Spring', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: '[]', access_token: 'tok' });
      expect(h.bodyOf(0).get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies the parent campaign belongs to the account, then creates a paused ad set', async () => {
      const h = harness([json({ id: 'c1', account_id: '1', objective: 'OUTCOME_TRAFFIC' }), json({ id: '456' })]);
      expect(await h.ops.execute(ctx, adset)).toEqual({ remoteId: '456' });
      expect(h.urlOf(0)).toContain('/v99.0/c1?');
      expect(h.urlOf(1)).toContain('/act_1/adsets');
      const body = Object.fromEntries(h.bodyOf(1));
      expect(body).toMatchObject({ campaign_id: 'c1', name: 'Set', daily_budget: '1500', optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS', status: 'PAUSED' });
      expect(JSON.parse(body.targeting!).geo_locations.countries).toEqual(['US']);
    });

    it('refuses foreign, non-campaign or unreadable parents before any write', async () => {
      for (const parent of [json({ id: 'c1', account_id: '777', objective: 'X' }), json({ id: 'c1', account_id: '1' }), json({ id: 'other', account_id: '1', objective: 'X' })]) {
        const h = harness([parent]);
        const error = await h.ops.execute(ctx, adset).catch(e => e);
        expect(h.fetchImpl).toHaveBeenCalledTimes(1);
        expect(classifyFacebookAdsFailure(error)).toBe('rejected');
      }
    });

    it('treats a missing or unsafe success id as uncertain, an explicit rejection as rejected', async () => {
      for (const reply of [json({}), json({ id: 'bad id' }), json({ id: 5 }), json({ success: true })]) {
        const h = harness([reply]);
        expect(classifyFacebookAdsFailure(await h.ops.execute(ctx, campaign).catch(e => e))).toBe('uncertain');
      }
      expect(classifyFacebookAdsFailure(await harness([new Error('net')]).ops.execute(ctx, campaign).catch(e => e))).toBe('uncertain');
      expect(classifyFacebookAdsFailure(await harness([json({ error: { code: 100, message: 'x' } }, 400)]).ops.execute(ctx, campaign).catch(e => e))).toBe('rejected');
    });

    it('honors an already aborted signal without any request', async () => {
      const h = harness([]);
      const controller = new AbortController(); controller.abort();
      const error = await h.ops.execute({ ...ctx, signal: controller.signal }, campaign).catch(e => e);
      expect(h.fetchImpl).not.toHaveBeenCalled();
      expect(classifyFacebookAdsFailure(error)).toBe('rejected');
    });

    it('validates inputs against protocol sets and Root limits', () => {
      const bad = (op: Record<string, unknown>) => expect(() => validateFacebookAdsOperation({ ...adset, ...op } as AdsNeutralOperation, limits)).toThrow();
      expect(() => validateFacebookAdsOperation(campaign, limits)).not.toThrow();
      expect(() => validateFacebookAdsOperation(adset, limits)).not.toThrow();
      expect(() => validateFacebookAdsOperation({ ...campaign, objective: 'NOPE' } as AdsNeutralOperation)).toThrow();
      expect(() => validateFacebookAdsOperation({ ...campaign, name: '   ' } as AdsNeutralOperation)).toThrow();
      expect(() => validateFacebookAdsOperation({ ...campaign, name: 'x'.repeat(21) } as AdsNeutralOperation, limits)).toThrow();
      expect(() => validateFacebookAdsOperation({ ...campaign, name: 'a\nb' } as AdsNeutralOperation)).toThrow();
      bad({ parentId: 'bad id' }); bad({ parentId: '' }); bad({ dailyBudgetMinor: 0 }); bad({ dailyBudgetMinor: 1.5 }); bad({ dailyBudgetMinor: 10_001 });
      bad({ countryCode: 'us' }); bad({ countryCode: 'ZZ' }); bad({ optimizationGoal: 'REACH' }); bad({ objectType: 'campaign' });
    });

    it('produces exact deterministic confirmations stating paused and the spend consequence', () => {
      const context = { adAccountId: 'act_1', currency: 'USD' };
      expect(facebookAdsConfirmation(campaign, context)).toBe('CREATE PAUSED FACEBOOK CAMPAIGN "Spring" IN ACCOUNT act_1 WITH OBJECTIVE OUTCOME_TRAFFIC');
      expect(facebookAdsConfirmation(adset, context)).toBe('CREATE PAUSED FACEBOOK AD SET "Set" UNDER CAMPAIGN c1 IN ACCOUNT act_1 WITH DAILY BUDGET 1500 MINOR UNITS USD TARGETING US OPTIMIZED FOR LINK_CLICKS');
      expect(facebookAdsConfirmation(adset, { adAccountId: 'act_1', currency: null })).not.toContain('null');
    });

    it('advertises choice options with unique values and country labels', () => {
      const inputs = (id: string) => FACEBOOK_ADS_OPERATIONS.find(op => op.id === id)!.inputs!;
      const choice = (id: string, name: string) => (inputs(id).find(i => i.name === name) as unknown as { options: { value: string; label: string }[] }).options;
      expect(choice('campaign.create', 'objective').map(o => o.value)).toContain('OUTCOME_TRAFFIC');
      expect(choice('adset.create', 'optimizationGoal').map(o => o.value)).toEqual(['LINK_CLICKS', 'IMPRESSIONS']);
      const countries = choice('adset.create', 'countryCode');
      expect(new Set(countries.map(o => o.value)).size).toBe(countries.length);
      expect(countries.every(o => /^[A-Z]{2}$/.test(o.value))).toBe(true);
      expect(countries.find(o => o.value === 'US')!.label).toMatch(/United States/);
      expect(inputs('adset.create').find(i => i.name === 'budget')).toEqual({ name: 'budget', kind: 'money-minor', budgetKinds: ['daily'] });
    });
  });

  it('requires an app secret when signing is enabled', () => {
    const { appSecret: _unused, ...unsigned } = config;
    void _unused;
    expect(() => createFacebookAdsTransport(unsigned as never)).toThrow();
  });
});
