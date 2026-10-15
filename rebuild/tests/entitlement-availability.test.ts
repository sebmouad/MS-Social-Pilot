import { describe, expect, it } from 'vitest';
import { resolveEntitlements } from '@/server/entitlements';

const source = {
  workspace: { id: 'workspace-1', disabledModules: [] },
  membership: { userId: 'member-1', disabledModules: [] },
  planFeatures: null,
};

describe('Root installation availability', () => {
  it('keeps unset controls available and denies a disabled feature', () => {
    const access = resolveEntitlements({ ...source, installationAvailability: { 'entitlements.features.analytics/reports': false } });
    expect(access.features['analytics/overview']).toBe(true);
    expect(access.features['analytics/reports']).toBe(false);
    expect(access.modules.analytics).toBe(true);
  });

  it('removes every child feature when a module is disabled', () => {
    const access = resolveEntitlements({ ...source, installationAvailability: { 'entitlements.modules.ads': false } });
    expect(access.modules.ads).toBe(false);
    expect(access.features['ads/overview']).toBe(false);
    expect(access.features['ads/campaigns']).toBe(false);
  });
});
