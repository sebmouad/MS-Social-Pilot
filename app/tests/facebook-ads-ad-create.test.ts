import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(), runtimeSecret: vi.fn() }));

import { FACEBOOK_ADS_UI_DEFAULTS } from '../src/platforms/facebook/ads-ui-config';
import { createFacebookAdsTransport, classifyFacebookAdsFailure } from '../src/platforms/facebook/ads-ops/transport';
import { createFacebookAdsOps, facebookAdsConfirmation, validateFacebookAdsOperation } from '../src/platforms/facebook/ads-ops';
import type { AdsNeutralOperation } from '../src/modules/ads/management/types';

const config = {
  graphBaseUrl: 'https://graph.example.test', oauthBaseUrl: 'https://www.example.test', graphVersion: 'v99.0', requestTimeoutMs: 5000, maxPages: 2, pageSize: 25,
  pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1000, allowedImageMimeTypes: ['image/png'], appSecretProofEnabled: true, appSecret: 'secret',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ctx = { credential: { accessToken: 'tok' }, accountId: 'act_1', recordReceipt: vi.fn(async () => undefined) };
const adOp: AdsNeutralOperation = { type: 'ad.create', objectType: 'ad', parentId: '222', name: 'Spring ad', creativeId: '333' };

function harness(responses: Array<Response | Error>) {
  const fetchImpl = vi.fn(async (..._args: unknown[]) => { const next = responses.shift(); if (next instanceof Error) throw next; return next ?? json({ success: true }); });
  const ops = createFacebookAdsOps(async () => createFacebookAdsTransport(config, fetchImpl as unknown as typeof fetch), async () => FACEBOOK_ADS_UI_DEFAULTS);
  const method = (index: number) => (fetchImpl.mock.calls[index]![1] as RequestInit).method;
  return { ops, fetchImpl, method, bodyOf: (index: number) => new URLSearchParams(String((fetchImpl.mock.calls[index]![1] as RequestInit).body)), urlOf: (index: number) => String(fetchImpl.mock.calls[index]![0]) };
}
// Responses are single-read, so every use needs a fresh one.
const adSet = () => json({ id: '222', account_id: '1', campaign_id: '111' });
const creative = () => json({ id: '333', account_id: '1' });

describe('Facebook paused ad creation', () => {
  it('verifies the ad set and creative, then sends one paused ad write with a provider-owned status', async () => {
    const h = harness([adSet(), creative(), json({ id: '444' })]);
    await expect(h.ops.execute(ctx, adOp)).resolves.toEqual({ remoteId: '444' });
    expect(h.fetchImpl).toHaveBeenCalledTimes(3);
    expect(h.method(0)).toBe('GET'); expect(h.urlOf(0)).toContain('/222'); expect(h.method(1)).toBe('GET'); expect(h.urlOf(1)).toContain('/333');
    expect(h.method(2)).toBe('POST'); expect(h.urlOf(2)).toContain('/act_1/ads');
    const body = h.bodyOf(2);
    expect(body.get('status')).toBe('PAUSED'); expect(body.get('adset_id')).toBe('222'); expect(body.get('name')).toBe('Spring ad');
    expect(JSON.parse(body.get('creative')!)).toEqual({ creative_id: '333' });
    expect(body.get('appsecret_proof')).toBeTruthy();
    expect(ctx.recordReceipt).toHaveBeenCalledWith({ remoteId: '444' });
  });

  it('refuses an ad set of another account, or an ad passed as the parent, before any write', async () => {
    for (const parent of [json({ id: '222', account_id: '999', campaign_id: '111' }), json({ id: '222', account_id: '1', campaign_id: '111', adset_id: '555' }), json({ id: '222', account_id: '1' })]) {
      const h = harness([parent]);
      const error = await h.ops.execute(ctx, adOp).catch(failure => failure);
      expect(error).toMatchObject({ message: expect.stringContaining('ad set') });
      expect(classifyFacebookAdsFailure(error)).toBe('rejected');
      expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses a creative of another account before any write', async () => {
    const h = harness([adSet(), json({ id: '333', account_id: '999' })]);
    const error = await h.ops.execute(ctx, adOp).catch(failure => failure);
    expect(classifyFacebookAdsFailure(error)).toBe('rejected');
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps an unconfirmed or failed write uncertain, and a definite Graph rejection rejected', async () => {
    const unconfirmed = await harness([adSet(), creative(), json({})]).ops.execute(ctx, adOp).catch(failure => failure);
    expect(classifyFacebookAdsFailure(unconfirmed)).toBe('uncertain');
    const timeout = await harness([adSet(), creative(), new Error('socket hang up')]).ops.execute(ctx, adOp).catch(failure => failure);
    expect(classifyFacebookAdsFailure(timeout)).toBe('uncertain');
    const rejected = await harness([adSet(), creative(), json({ error: { code: 100, message: 'Invalid parameter token' } }, 400)]).ops.execute(ctx, adOp).catch(failure => failure);
    expect(classifyFacebookAdsFailure(rejected)).toBe('rejected');
    expect(rejected.message).not.toContain('token');
  });

  it('validates input and produces the module-owned confirmation', () => {
    expect(() => validateFacebookAdsOperation(adOp)).not.toThrow();
    for (const bad of [{ ...adOp, name: '' }, { ...adOp, name: 'x'.repeat(101) }, { ...adOp, parentId: 'a/b' }, { ...adOp, creativeId: '' }, { ...adOp, name: 'bad\u0007' }]) {
      expect(() => validateFacebookAdsOperation(bad as AdsNeutralOperation), JSON.stringify(bad)).toThrow();
    }
    expect(() => validateFacebookAdsOperation(adOp, { nameMaxCharacters: 5, maxBudgetMinor: 100 })).toThrow();
    expect(facebookAdsConfirmation(adOp, { adAccountId: 'acc1', currency: 'USD' })).toBe('CREATE PAUSED FACEBOOK AD "Spring ad" UNDER AD SET 222 IN ACCOUNT acc1 WITH CREATIVE 333');
  });
});

describe('Facebook management operations on existing objects (fixtures, no live calls)', () => {
  const owned = (id: string) => json({ id, account_id: '1' });
  const cases: Array<[string, AdsNeutralOperation, Record<string, string>, Array<Response>]> = [
    ['pause', { type: 'status.set', objectType: 'campaign', objectId: '111', status: 'paused' }, { status: 'PAUSED' }, [owned('111')]],
    ['resume', { type: 'status.set', objectType: 'adset', objectId: '222', status: 'active' }, { status: 'ACTIVE' }, [owned('222')]],
    ['daily budget', { type: 'budget.set', objectType: 'adset', objectId: '222', budget: { kind: 'daily', minor: 2500 } }, { daily_budget: '2500' }, [owned('222')]],
    ['lifetime budget', { type: 'budget.set', objectType: 'campaign', objectId: '111', budget: { kind: 'lifetime', minor: 90000 } }, { lifetime_budget: '90000' }, [owned('111')]],
    ['rename', { type: 'rename', objectType: 'ad', objectId: '444', name: 'New name' }, { name: 'New name' }, [owned('444')]],
    ['delete', { type: 'delete', objectType: 'ad', objectId: '444' }, { status: 'DELETED' }, [owned('444')]],
  ];
  it.each(cases)('%s: one signed write after an ownership read', async (_label, operation, expected, reads) => {
    const h = harness([...reads, json({ success: true })]);
    await expect(h.ops.execute(ctx, operation)).resolves.toEqual({ remoteId: (operation as { objectId: string }).objectId });
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    for (const [key, value] of Object.entries(expected)) expect(h.bodyOf(1).get(key)).toBe(value);
  });

  it('spend-changing confirmations name the account, object and effect', () => {
    const where = { adAccountId: 'acc1', currency: 'USD' };
    expect(facebookAdsConfirmation(cases[1]![1], where)).toBe('RESUME FACEBOOK AD SET 222 ALLOWING DELIVERY AND SPEND IN ACCOUNT acc1');
    expect(facebookAdsConfirmation(cases[2]![1], where)).toBe('SET FACEBOOK AD SET 222 DAILY BUDGET TO 2500 MINOR UNITS USD IN ACCOUNT acc1');
    expect(facebookAdsConfirmation(cases[5]![1], where)).toBe('DELETE FACEBOOK AD 444 PERMANENTLY IN ACCOUNT acc1');
  });
});
