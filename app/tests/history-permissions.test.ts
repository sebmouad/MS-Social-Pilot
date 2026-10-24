import { describe, expect, it } from 'vitest';
import { canAccessFeature, resolvePermissions } from '../src/server/permissions';
import { resolveEntitlements, canUseFeature } from '../src/server/entitlements';
import { moduleManifests } from '../src/modules';

const source = (role: string) => ({ role, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] });

describe('settings/history feature (real permission and entitlement tables)', () => {
  it('is declared by the Settings manifest with its own href', () => {
    const settings = moduleManifests.find(module => module.id === 'settings')!;
    expect(settings.pages.some(page => page.id === 'settings/history' && page.href === '/settings/history')).toBe(true);
    expect(settings.rootSettingsPrefixes).toContain('history.');
  });
  it.each([['owner', true], ['admin', true], ['editor', false], ['contributor', false], ['viewer', false], ['client', false]] as const)('%s read access is %s and nobody can write', (role, read) => {
    const permissions = resolvePermissions(source(role));
    expect(canAccessFeature(permissions, 'settings/history', 'read')).toBe(read);
    expect(canAccessFeature(permissions, 'settings/history', 'write')).toBe(false);
  });
  it('a suspended workspace and a Root switch turn the feature off', () => {
    const base = { workspace: { id: 'w', disabledModules: [] as string[] }, membership: { userId: 'u', disabledModules: [] as string[] } };
    expect(canUseFeature(resolveEntitlements(base), 'settings/history')).toBe(true);
    expect(canUseFeature(resolveEntitlements({ ...base, workspace: { ...base.workspace, suspendedAt: new Date() } }), 'settings/history')).toBe(false);
    expect(canUseFeature(resolveEntitlements({ ...base, installationAvailability: { 'entitlements.features.settings/history': false } }), 'settings/history')).toBe(false);
  });
});
