import { describe, expect, it } from 'vitest';
import { resolveEntitlements } from '@/server/entitlements';

const source = {
  workspace: { id: 'workspace-1', disabledModules: [] },
  membership: { userId: 'member-1', disabledModules: [] },
  planFeatures: null,
};

describe('Root installation availability', () => {
  it('does not grant uninstalled providers named by plan features', () => {
    const access = resolveEntitlements({ ...source, planFeatures: ['platform_uninstalled-network'] });
    expect(access.platformCapabilities['uninstalled-network']).not.toBe(true);
  });
  it('denies platform capabilities in a suspended customer workspace', () => {
    const access = resolveEntitlements({ ...source, workspace: { ...source.workspace, suspendedAt: new Date() } });
    expect(access.platformCapabilities.facebook).toBe(false);
  });
  it('applies installed platform Root enablement to platform entitlements', () => {
    const access = resolveEntitlements({ ...source, platformSettings: [{ key: 'platforms.facebook.enabled', value: false, encrypted: false }] });
    expect(access.platformCapabilities.facebook).toBe(false);
  });

  it('denies all customer modules in a suspended workspace while permitting private owner inspection', () => {
    const suspended = { ...source, workspace: { ...source.workspace, suspendedAt: new Date() } };
    expect(Object.values(resolveEntitlements(suspended).modules).every(enabled => !enabled)).toBe(true);
    expect(Object.values(resolveEntitlements(suspended).features).every(enabled => !enabled)).toBe(true);
    expect(resolveEntitlements({ ...suspended, isInstanceOwner: true }).modules.publishing).toBe(true);
  });
  it('keeps unset controls available and denies a disabled feature', () => {
    const access = resolveEntitlements({ ...source, installationAvailability: { 'entitlements.features.analytics/overview': false, 'entitlements.features.analytics/reports': false } });
    expect(access.features['analytics/overview']).toBe(false);
    expect(access.features['analytics/reports']).toBe(false);
    expect(access.modules.analytics).toBe(true);
  });

  it('honors Root and plan gates independently for reusable publishing templates', () => {
    expect(resolveEntitlements(source).features['publishing/templates']).toBe(true);
    expect(resolveEntitlements({ ...source, installationAvailability: { 'entitlements.features.publishing/templates': false } }).features['publishing/templates']).toBe(false);
    expect(resolveEntitlements({ ...source, planFeatures: ['product_v2', 'publishing/posts'] }).features['publishing/templates']).toBe(false);
  });

  it('removes every child feature when a module is disabled', () => {
    const access = resolveEntitlements({ ...source, installationAvailability: { 'entitlements.modules.ads': false } });
    expect(access.modules.ads).toBe(false);
    expect(access.features['ads/overview']).toBe(false);
    expect(access.features['ads/campaigns']).toBe(false);
  });
});
