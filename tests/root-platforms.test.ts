import { describe, expect, it } from 'vitest';

import { SETTING_DEFINITIONS } from '../src/lib/settings/definitions';
import { configSection } from '../src/lib/root-config-sections';
import { platformSettingsHref, settingSection } from '../src/lib/root-platforms';

describe('root platform and settings sections', () => {
  it('puts Meta settings in Meta and each network’s keys in its own section', () => {
    expect(settingSection('facebook.appSecret', 'facebook')).toBe('meta');
    expect(settingSection('features.ads', 'features')).toBe('meta');
    expect(settingSection('networks.bluesky', 'networks')).toBe('bluesky');
    expect(settingSection('tiktok.clientKey', 'networks')).toBe('tiktok');
    expect(settingSection('ai.apiKey', 'ai')).toBeNull();
  });

  it('leaves no platform setting on the generic screens and loses none', () => {
    for (const entry of SETTING_DEFINITIONS) {
      if (entry.group === 'networks' || entry.group === 'facebook') expect(settingSection(entry.key, entry.group), entry.key).not.toBeNull();
    }
    const app = SETTING_DEFINITIONS.filter((entry) => settingSection(entry.key, entry.group) === null);
    expect(app.filter((entry) => configSection(entry.key, entry.group) === 'ai').map((e) => e.key)).toContain('ai.apiKey');
    expect(configSection('app.url', 'general')).toBe('url');
    expect(configSection('security.twoStep', 'general')).toBe('security');
    expect(configSection('media.dir', 'media')).toBe('storage');
  });

  it('sends root to the right section to set up an app', () => {
    expect(platformSettingsHref('page')).toBe('/root/meta');
    expect(platformSettingsHref('linkedin')).toBe('/root/platforms/linkedin');
  });
});
