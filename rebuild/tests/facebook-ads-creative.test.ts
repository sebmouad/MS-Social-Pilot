import { beforeEach, describe, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => vi.fn());
vi.mock('@/server/config/store', () => ({ runtimeConfig: config, runtimeSecret: vi.fn() }));
import { createFacebookAdsOps } from '@/platforms/facebook/ads-ops';
import type { AdsNeutralOperation, AdsOpsContext } from '@/modules/ads/management/types';
import { FacebookAdsOpsError } from '@/platforms/facebook/ads-ops/transport';
const creative: Extract<AdsNeutralOperation, { type: 'creative.create' }> = { type: 'creative.create', objectType: 'creative', name: 'Spring', targetId: 'channel', mediaId: 'image-id', format: 'link', message: 'New season', title: 'Discover', linkUrl: 'https://example.test/' };
const hash = 'a'.repeat(32);
const context = (): AdsOpsContext => ({ accountId: 'act_123', credential: { accessToken: 'private-token' }, creative: { identityKind: 'page', identityId: '456', image: { bytes: Buffer.from('stored bytes'), mimeType: 'image/png' } }, recordReceipt: vi.fn(async () => {}) });
function harness() {
  const get = vi.fn();
  const post = vi.fn().mockResolvedValueOnce({ images: { image: { hash } } }).mockResolvedValueOnce({ id: '789' });
  return { post, get, ops: createFacebookAdsOps(async () => ({ post, get })) };
}
beforeEach(() => { vi.clearAllMocks(); config.mockImplementation(async key => key === 'meta.maxImageUploadBytes' ? 1024 : ['image/png']); });
describe('Facebook stored-media creative mapping (mock transport only)', () => {
  it.each(['link', 'image'] as const)('uploads bytes and creates an unattached %s creative with durable receipts', async format => {
    const { ops, post, get } = harness(); const ctx = context();
    const operation = format === 'link' ? creative : { ...creative, format, title: '', linkUrl: undefined };
    expect(await ops.execute(ctx, operation)).toEqual({ remoteId: '789' });
    expect(post.mock.calls[0]).toEqual(['act_123/adimages', 'private-token', { bytes: Buffer.from('stored bytes').toString('base64') }, undefined]);
    expect(ctx.recordReceipt).toHaveBeenNthCalledWith(1, { imageHash: hash, mediaId: creative.mediaId });
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ctx.recordReceipt!).mock.invocationCallOrder[0]!);
    expect(vi.mocked(ctx.recordReceipt!).mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[1]!);
    const body = post.mock.calls[1]![2];
    const story = JSON.parse(body.object_story_spec);
    expect(story.page_id).toBe('456');
    expect(format === 'link' ? story.link_data : story.photo_data).toMatchObject({ image_hash: hash });
    expect(JSON.stringify(post.mock.calls)).not.toMatch(/PAUSED|ACTIVE|adset_id|creative_id|image_url/);
    expect(get).not.toHaveBeenCalled();
    expect(post.mock.calls[1]![0]).toBe('act_123/adcreatives');
    expect(ctx.recordReceipt).toHaveBeenLastCalledWith({ imageHash: hash, creativeId: '789', mediaId: creative.mediaId });
  });
  it('refuses wrong identity kinds, unsupported MIME and oversize images before any write', async () => {
    for (const variant of ['kind', 'mime', 'size']) {
      const { ops, post } = harness(); const ctx = context();
      if (variant === 'kind') ctx.creative!.identityKind = 'another-channel';
      if (variant === 'mime') ctx.creative!.image.mimeType = 'video/mp4';
      if (variant === 'size') ctx.creative!.image.bytes = Buffer.alloc(1025);
      const error = await ops.execute(ctx, creative).catch(error => error);
      expect(ops.classifyFailure(error)).toBe('rejected'); expect(post).not.toHaveBeenCalled();
    }
  });
  it('holds a partial image upload even if the subsequent creative request is explicitly rejected', async () => {
    const { ops, post } = harness(); post.mockReset().mockResolvedValueOnce({ images: { image: { hash } } }).mockRejectedValueOnce(new FacebookAdsOpsError('Rejected', { status: 400, code: 100 }));
    const error = await ops.execute(context(), creative).catch(error => error);
    expect(ops.classifyFailure(error)).toBe('uncertain'); expect(post).toHaveBeenCalledTimes(2);
  });
  it('never sends the creative when persisting the image receipt fails', async () => {
    const { ops, post } = harness(); const ctx = context(); ctx.recordReceipt = vi.fn().mockRejectedValue(new Error('lost commit'));
    const error = await ops.execute(ctx, creative).catch(error => error);
    expect(ops.classifyFailure(error)).toBe('uncertain'); expect(post).toHaveBeenCalledTimes(1);
  });
  it('holds a confirmed creative when the final independent receipt cannot be persisted', async () => {
    const { ops, post } = harness(); const ctx = context();
    ctx.recordReceipt = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost final receipt'));
    expect(ops.classifyFailure(await ops.execute(ctx, creative).catch(error => error))).toBe('uncertain');
    expect(post).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { images: { image: { hash: 'invalid' } } }, { images: { a: { hash }, b: { hash } } }])('holds malformed upload receipts', async payload => {
    const { ops, post } = harness(); post.mockReset().mockResolvedValue(payload);
    expect(ops.classifyFailure(await ops.execute(context(), creative).catch(error => error))).toBe('uncertain');
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { id: '' }, { id: 'bad id' }])('holds an unconfirmed final creative identity', async final => {
    const { ops, post } = harness(); post.mockReset().mockResolvedValueOnce({ images: { image: { hash } } }).mockResolvedValueOnce(final);
    const ctx = context(); expect(ops.classifyFailure(await ops.execute(ctx, creative).catch(error => error))).toBe('uncertain');
    expect(ctx.recordReceipt).toHaveBeenCalledTimes(1);
  });
  it('marks assignment as spend changing and requires an exact account-specific creation confirmation', () => {
    const { ops } = harness();
    expect(ops.operations.find(op => op.id === 'creative.assign')?.spendChanging).toBe(true);
    expect(ops.operations.find(op => op.id === 'creative.create')?.spendChanging).toBe(false);
    const confirmation = ops.confirmation(creative, { adAccountId: 'account-db', currency: null });
    expect(confirmation).toContain('WITHOUT DELIVERY OR SPEND');
    expect(ops.confirmation({ ...creative, linkUrl: 'https://other.test/' }, { adAccountId: 'account-db', currency: null })).not.toBe(confirmation);
    expect(ops.confirmation({ ...creative, message: 'Changed content' }, { adAccountId: 'account-db', currency: null })).not.toBe(confirmation);
  });
});
