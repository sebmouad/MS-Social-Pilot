import { describe, expect, it } from 'vitest';

import { networkAvailable } from '@/lib/networks';
import { SETTING_DEFINITIONS } from '@/lib/settings/definitions';

describe('network switches', () => {
  it('has one switch per network, on by default', () => {
    for (const key of ['bluesky', 'mastodon', 'linkedin', 'threads', 'x', 'pinterest']) {
      const definition = SETTING_DEFINITIONS.find((item) => item.key === `networks.${key}`);
      expect(definition?.default).toBe(true);
    }
  });

  it('keeps networks that need no app keys available while switched on', () => {
    expect(networkAvailable('bluesky')).toBe(true);
    expect(networkAvailable('mastodon')).toBe(true);
  });
});
