import { beforeEach, describe, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => vi.fn());
vi.mock('@/server/config/store', () => ({ runtimeConfig: config }));
import { loadMediaPresentationPolicy } from '@/modules/publishing/server/media/policy';
import { mediaPresentationPolicy, mediaPresentationPolicySchema } from '@/modules/publishing/server/media/config';

beforeEach(() => { config.mockReset(); });
describe('media presentation Root policy', () => {
  it('uses runtimeConfig and validates non-default policy', async () => {
    const changed = { holdersPerImage: 2, fileNameMaxCharacters: 12, usagePreviewMaxCharacters: 1, fallbackFileName: 'photo' };
    config.mockResolvedValue(changed);
    await expect(loadMediaPresentationPolicy()).resolves.toEqual(changed);
    expect(config).toHaveBeenCalledWith('storage.mediaPresentationPolicy');
  });
  it('keeps shipped bounds when configuration cannot yet load', async () => {
    config.mockRejectedValue(new Error('Unknown non-secret configuration key.'));
    await expect(loadMediaPresentationPolicy()).resolves.toEqual(mediaPresentationPolicy);
  });
  it.each([
    { holdersPerImage: 0 }, { holdersPerImage: 101 }, { fileNameMaxCharacters: 256 },
    { usagePreviewMaxCharacters: 0 }, { fallbackFileName: '../image' }, { fallbackFileName: 'a\u0000b' },
  ])('rejects invalid bounds or unsafe fallback names: %j', async override => {
    const value = { ...mediaPresentationPolicy, ...override };
    expect(mediaPresentationPolicySchema.safeParse(value).success).toBe(false);
    config.mockResolvedValue(value);
    await expect(loadMediaPresentationPolicy()).rejects.toThrow();
  });
});
