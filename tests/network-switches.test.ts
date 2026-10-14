import { describe, expect, it } from 'vitest';

import { networkAvailable } from '@/lib/networks';
import { SETTING_DEFINITIONS } from '@/lib/settings/definitions';

describe('network switches', () => {
  it('has one switch per network, off until Root adds it', () => {
    for (const key of ['bluesky', 'mastodon', 'linkedin', 'threads', 'x', 'pinterest', 'telegram', 'youtube', 'tiktok']) {
      const definition = SETTING_DEFINITIONS.find((item) => item.key === `networks.${key}`);
      expect(definition?.default).toBe(false);
    }
  });

  it('does not offer networks before Root enables them', () => {
    expect(networkAvailable('bluesky')).toBe(false);
    expect(networkAvailable('mastodon')).toBe(false);
  });
});
