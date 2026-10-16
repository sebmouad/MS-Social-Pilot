import { describe, expect, it } from 'vitest';
import { configurationOwner } from '../src/lib/config/ownership';
import { CONFIG_BY_KEY, safeConfigShape } from '../src/lib/config/registry';
import { rootManifest } from '../src/modules/root/manifest';
import { moduleManifests } from '../src/modules';
import { PLATFORM_MODULES, PLATFORM_CONFIG } from '../src/platforms';

describe('Root module organization', () => {
  it('groups shared controls, product modules and platform modules in the existing sidebar', () => {
    expect(rootManifest.sections.map(section => section.title)).toEqual(['Shared controls', 'Product modules', 'Platform modules']);
    expect(rootManifest.sections[1].pages.map(page => page.href)).toEqual(['/root/modules', ...moduleManifests.map(module => `/root/modules/${module.id}`)]);
    expect(rootManifest.sections[2].pages.map(page => page.href)).toEqual(['/root/platforms', ...PLATFORM_MODULES.map(module => `/root/platforms/${module.id}`)]);
  });
  it('assigns every registered platform setting to its platform before product prefixes', () => {
    for (const setting of PLATFORM_CONFIG) {
      expect(configurationOwner(setting.key)).toEqual(setting.owner);
      expect(PLATFORM_MODULES.some(module => module.id === setting.owner.id)).toBe(true);
    }
    // The provider-owned reply policy must never enter the shared Inbox module.
    expect(configurationOwner('inbox.messengerReplyWindowHours')).toEqual({ kind: 'platform', id: 'facebook' });
  });
  it('validates explicitly claimed keys and keeps module schedules with their owners', () => {
    for (const module of moduleManifests) for (const key of module.rootSettingKeys) expect(CONFIG_BY_KEY.has(key)).toBe(true);
    expect(configurationOwner('sync.posts.schedule')).toEqual({ kind: 'product', id: 'publishing' });
    expect(configurationOwner('sync.inbox.schedule')).toEqual({ kind: 'product', id: 'inbox' });
    expect(configurationOwner('sync.analytics.schedule')).toEqual({ kind: 'product', id: 'analytics' });
    expect(configurationOwner('sync.workerHeartbeatSeconds')).toEqual({ kind: 'shared' });
  });
  it('keeps module availability, child features and module-specific settings together', () => {
    for (const module of moduleManifests) {
      expect(configurationOwner(`entitlements.modules.${module.id}`)).toEqual({ kind: 'product', id: module.id });
      for (const page of module.pages) expect(configurationOwner(`entitlements.features.${page.id}`)).toEqual({ kind: 'product', id: module.id });
    }
    expect(configurationOwner('publishing.maxMessageCharacters')).toEqual({ kind: 'product', id: 'publishing' });
    expect(configurationOwner('ads.managementEnabled')).toEqual({ kind: 'product', id: 'ads' });
    expect(configurationOwner('analytics.reportExportRows')).toEqual({ kind: 'product', id: 'analytics' });
    expect(configurationOwner('auth.sessionDays')).toEqual({ kind: 'shared' });
    expect(configurationOwner('root.userSearchMaxCharacters')).toEqual({ kind: 'shared' });
  });
  it('gives every safe definition one owner and never adds saved secret values', () => {
    for (const definition of safeConfigShape()) {
      expect(definition.owner).toEqual(configurationOwner(definition.key));
      expect(definition).not.toHaveProperty('value');
    }
  });
});
