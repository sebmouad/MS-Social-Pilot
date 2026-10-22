import { linkedinModule } from '@/platforms/linkedin/manifest';
import { pinterestModule } from '@/platforms/pinterest/manifest';
import { manifest as blueskyManifest } from '@/platforms/bluesky/manifest';
import { manifest as telegramManifest } from '@/platforms/telegram/manifest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runtimeConfig: vi.fn(), adapter: vi.fn(), oauth: vi.fn() }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig, runtimeSecret: vi.fn() }));
vi.mock('../src/platforms/facebook/runtime', () => ({
  configuredFacebookAdapter: mocks.adapter,
  configuredFacebookOAuth: mocks.oauth,
  configuredFacebookEngine: vi.fn(),
}));

import { PLATFORM_CONFIG, PLATFORM_MODULES, STAGED_PLATFORM_MODULES, STAGED_PLATFORM_IDS } from '../src/platforms';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
import { PLATFORM_HOSTS } from '../src/server/platforms/index';
import { analyticsPlatformIds, connectablePlatforms, connectionFlow, inboxPlatformIds, isPlatformEnabled, platformAnalytics, platformFor, platformInbox, platformStatuses } from '../src/server/platforms/registry';

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
    for (const entry of PLATFORM_CONFIG) {
      const owner = [...PLATFORM_MODULES, ...STAGED_PLATFORM_MODULES, blueskyManifest, telegramManifest, linkedinModule, pinterestModule].find(module => module.id === entry.owner.id);
      expect(owner).toBeDefined();
      expect(entry.group.startsWith(`${owner!.name} · `)).toBe(true);
    }
  });

  it('registers staged settings without exposing unfinished providers even if Root enables their switch', async () => {
    expect(STAGED_PLATFORM_IDS).toEqual(['mastodon', 'threads', 'x', 'bluesky', 'telegram', 'linkedin', 'pinterest']);
    for (const module of STAGED_PLATFORM_MODULES) {
      expect(CONFIG_BY_KEY.get(module.enabledKey)?.defaultValue).toBe(false);
      for (const key of module.requiredSettings) expect(CONFIG_BY_KEY.has(key)).toBe(true);
      const entries = PLATFORM_CONFIG.filter(entry => entry.owner.id === module.id);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
      enabled.set(module.enabledKey, true);
      expect(await isPlatformEnabled(module.id)).toBe(false);
      expect(await connectionFlow(module.id)).toBeNull();
      expect(await platformFor(module.id, 'publishing')).toBeNull();
    }
    expect(await connectablePlatforms(STAGED_PLATFORM_IDS)).toEqual([]);
  });

  it('a switched-off module behaves as if it were not installed', async () => {
    expect(await isPlatformEnabled('facebook')).toBe(false);
    expect(await platformFor('facebook', 'publishing')).toBeNull();
    expect(await connectionFlow('facebook')).toBeNull();
    expect(await connectablePlatforms(['facebook'])).toEqual([]);
    expect(mocks.adapter).not.toHaveBeenCalled();
  });

  it('lists inbox providers only when an installed inbox host is enabled', async () => {
    expect(await inboxPlatformIds()).toEqual([]);
    expect(await platformInbox('facebook')).toBeNull();
    enabled.set('platforms.facebook.enabled', true);
    expect(await inboxPlatformIds()).toEqual(['facebook']);
    expect(await platformInbox('facebook')).toBe(PLATFORM_HOSTS.facebook.inbox);
  });

  it('does not expose an installed analytics loader until its module is enabled', async () => {
    expect(await analyticsPlatformIds()).toEqual([]);
    expect(await platformAnalytics('facebook')).toBeNull();
    expect(await platformAnalytics('unknown')).toBeNull();
    enabled.set('platforms.facebook.enabled', true);
    expect(await analyticsPlatformIds()).toEqual(['facebook']);
    expect(await platformAnalytics('facebook')).toBe(PLATFORM_HOSTS.facebook.analytics);
  });

  it('a switched-on module answers only for the capabilities its engine supports', async () => {
    enabled.set('platforms.facebook.enabled', true);
    expect(await platformFor('facebook', 'publishing')).not.toBeNull();
    expect(await platformFor('facebook', 'inbox')).toBeNull();
    expect((await connectablePlatforms(['facebook'])).map((module) => module.id)).toEqual(['facebook']);
  });

  it('a module that is on but not set up is not offered to customers', async () => {
    enabled.set('platforms.facebook.enabled', true);
    mocks.oauth.mockRejectedValue(new Error('Meta connection is not configured.'));
    expect(await connectablePlatforms(['facebook'])).toEqual([]);
    expect((await platformStatuses())[0]).toMatchObject({ enabled: true, ready: false });
  });

  it('omits a configured provider from connection choices without workspace access', async () => {
    enabled.set('platforms.facebook.enabled', true);
    expect(await connectablePlatforms([])).toEqual([]);
  });

  it('unknown platforms are refused', async () => {
    expect(await isPlatformEnabled('unknown')).toBe(false);
    expect(await platformFor('unknown', 'publishing')).toBeNull();
    expect(await connectionFlow('unknown')).toBeNull();
  });
});
