import { describe, expect, it } from 'vitest';
import { resolveEntitlements } from '@/server/entitlements';
import { resolvePermissions } from '@/server/permissions';
import { CONFIG_BY_KEY, safeConfigShape } from '@/lib/config/registry';
import { moduleManifests } from '@/modules';
import { PRODUCT_PLAN_FEATURES } from '@/modules/root/server/admin/shared';
const source = { workspace: { id: 'w', disabledModules: [] as string[] }, membership: { userId: 'u', disabledModules: [] as string[] }, planFeatures: null as string[] | null };
describe('Agency host authority and Root controls', () => {
  it('declares separate pages and Root configuration ownership', () => {
    expect(moduleManifests.find(m => m.id === 'agency')?.pages.map(p => p.href)).toEqual(['/agency', '/agency/clients']);
    expect(safeConfigShape().find(k => k.key === 'agency.workspaceLimit')).toMatchObject({ consumption: 'active', owner: { kind: 'product', id: 'agency' } });
    expect(CONFIG_BY_KEY.get('agency.workspaceLimit')!.schema.safeParse(0).success).toBe(false);
    expect(PRODUCT_PLAN_FEATURES.find(g => g.id === 'agency')?.features.map(f => f.key)).toEqual(['agency/overview','agency/clients']);
  });
  it('allows only manager roles to read and grants no Agency writes', () => {
    for (const role of ['owner','admin','editor','contributor','viewer','client','unknown']) {
      const p = resolvePermissions({ role, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] });
      expect(p.features['agency/overview']).toEqual({ read: ['owner','admin'].includes(role), write: false });
      expect(p.features['agency/clients']).toEqual({ read: ['owner','admin'].includes(role), write: false });
    }
  });
  it('honors installation, plan and workspace/member switches independently', () => {
    expect(resolveEntitlements(source).features['agency/overview']).toBe(true);
    expect(resolveEntitlements({ ...source, planFeatures: ['product_v2'] }).features['agency/overview']).toBe(false);
    expect(resolveEntitlements({ ...source, planFeatures: ['product_v2','agency/clients'] }).features['agency/clients']).toBe(true);
    expect(resolveEntitlements({ ...source, installationAvailability: { 'entitlements.modules.agency': false } }).modules.agency).toBe(false);
    expect(resolveEntitlements({ ...source, workspace: { ...source.workspace, disabledModules: ['agency'] } }).features['agency/overview']).toBe(false);
    expect(resolveEntitlements({ ...source, membership: { ...source.membership, disabledModules: ['agency/clients'] } }).features['agency/clients']).toBe(false);
    const p = resolvePermissions({ role: 'owner', workspaceDisabledModules: ['agency'], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] });
    expect(p.modules.agency.read).toBe(false);
  });
});
