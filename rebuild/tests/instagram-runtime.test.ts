import { describe, expect, it, vi } from 'vitest';
const settings = vi.hoisted(() => ({ runtimeConfig: vi.fn(), runtimeSecret: vi.fn() }));
vi.mock('@/server/config/store', () => settings);
import { INSTAGRAM_POLICY_DEFAULTS } from '../src/platforms/instagram/config';
import { configuredInstagramAdapter, configuredInstagramCollector, configuredInstagramDiscovery } from '../src/platforms/instagram/runtime';
import { PLATFORM_CONFIG, PLATFORM_MODULES, instagramModule } from '../src/platforms';

describe('Instagram runtime integration boundary', () => {
  it('builds from Root values and reads secrets through the secret reader', async () => {
    settings.runtimeConfig.mockResolvedValue({ ...INSTAGRAM_POLICY_DEFAULTS, carouselMax: 3, copy: { ...INSTAGRAM_POLICY_DEFAULTS.copy, carousel: { en: 'Custom album', fr: 'Album personnalisé' } } });
    settings.runtimeSecret.mockResolvedValue('fixture-secret');
    const adapter = await configuredInstagramAdapter('fr');
    expect(adapter.publishingFormats?.find(format => format.id === 'carousel')).toMatchObject({ label: 'Album personnalisé', media: { maxImages: 3 } });
    expect(settings.runtimeConfig).toHaveBeenCalledWith('instagram.policy');
    expect(settings.runtimeSecret).toHaveBeenCalledWith('instagram.appSecret');
    expect(await configuredInstagramCollector()).toHaveProperty('post');
    expect(await configuredInstagramCollector()).toHaveProperty('media');
    expect(await configuredInstagramDiscovery()).toBeTypeOf('function');
  });
  it('installs the host catalog while keeping activation off by default', () => {
    expect(PLATFORM_CONFIG.some(setting => setting.key === 'instagram.policy')).toBe(true);
    expect(PLATFORM_MODULES.some(module => String(module.id) === instagramModule.id)).toBe(true);
    expect(PLATFORM_CONFIG.find(setting => setting.key === 'platforms.instagram.enabled')?.defaultValue).toBe(false);
  });
  it('fails closed for invalid Root policy', async () => {
    settings.runtimeConfig.mockResolvedValue({ ...INSTAGRAM_POLICY_DEFAULTS, pollAttempts: 0 });
    await expect(configuredInstagramAdapter()).rejects.toThrow();
  });
});
