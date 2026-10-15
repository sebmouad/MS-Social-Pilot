import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runtimeConfig: vi.fn(), adapter: vi.fn(), oauth: vi.fn() }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig, runtimeSecret: vi.fn() }));
vi.mock('../src/server/platforms/facebook', () => ({
  configuredFacebookAdapter: mocks.adapter,
  configuredFacebookOAuth: mocks.oauth,
  configuredFacebookEngine: vi.fn(),
}));

import { PLATFORM_CONFIG, PLATFORM_MODULES } from '../src/platforms';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
import { PLATFORM_HOSTS } from '../src/server/platforms/index';
import { connectablePlatforms, connectionFlow, isPlatformEnabled, platformFor, platformStatuses } from '../src/server/platforms/registry';

const enabled = new Map<string, boolean>();
beforeEach(() => {
  vi.clearAllMocks();
  enabled.clear();
  mocks.runtimeConfig.mockImplementation((key: string) => Promise.resolve(enabled.get(key) ?? false));
  mocks.adapter.mockResolvedValue({ id: 'facebook', capabilities: { connection: 'supported', publishing: 'supported', inbox: 'unsupported' } });
  mocks.oauth.mockResolvedValue({ appId: 'a', appSecret: 's', redirectUri: 'https://x.test/cb', scopes: ['pages_show_list'] });
});

describe('platform modules', () => {
  it('every installed module has server wiring, an on/off switch and its own settings group', () => {
    for (const module of PLATFORM_MODULES) {
      expect(PLATFORM_HOSTS[module.id]).toBeDefined();
      expect(module.enabledKey).toBe(`platforms.${module.id}.enabled`);
      expect(CONFIG_BY_KEY.get(module.enabledKey)?.kind).toBe('boolean');
      for (const key of module.requiredSettings) expect(CONFIG_BY_KEY.has(key)).toBe(true);
    }
    for (const entry of PLATFORM_CONFIG) expect(entry.group.startsWith('Facebook · ')).toBe(true);
  });

  it('a switched-off module behaves as if it were not installed', async () => {
    expect(await isPlatformEnabled('facebook')).toBe(false);
    expect(await platformFor('facebook', 'publishing')).toBeNull();
    expect(await connectionFlow('facebook')).toBeNull();
    expect(await connectablePlatforms()).toEqual([]);
    expect(mocks.adapter).not.toHaveBeenCalled();
  });

  it('a switched-on module answers only for the capabilities its engine supports', async () => {
    enabled.set('platforms.facebook.enabled', true);
    expect(await platformFor('facebook', 'publishing')).not.toBeNull();
    expect(await platformFor('facebook', 'inbox')).toBeNull();
    expect((await connectablePlatforms()).map((module) => module.id)).toEqual(['facebook']);
  });

  it('a module that is on but not set up is not offered to customers', async () => {
    enabled.set('platforms.facebook.enabled', true);
    mocks.oauth.mockRejectedValue(new Error('Meta connection is not configured.'));
    expect(await connectablePlatforms()).toEqual([]);
    expect((await platformStatuses())[0]).toMatchObject({ enabled: true, ready: false });
  });

  it('unknown platforms are refused', async () => {
    expect(await isPlatformEnabled('unknown')).toBe(false);
    expect(await platformFor('unknown', 'publishing')).toBeNull();
    expect(await connectionFlow('unknown')).toBeNull();
  });
});
