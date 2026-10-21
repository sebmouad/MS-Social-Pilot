import { describe, expect, it } from 'vitest';
import { settingsManifest } from '@/modules/settings/manifest';
import { SHARING_TOOL_ACCESS } from '@/modules/sharing/semantics';
import { sharingToolDefinitions, sharingWriteTools } from '@/modules/sharing/mcp';
import { resolvePermissions } from '@/server/permissions';
import { resolveEntitlements } from '@/server/entitlements';
import { safeConfigShape } from '@/lib/config/registry';
const source = { workspace: { id: 'w', disabledModules: [] as string[] }, membership: { userId: 'u', disabledModules: [] as string[] }, planFeatures: null as string[] | null };
describe('Client sharing and bio host boundaries', () => {
  it('exposes separate pages and Root ownership', () => {
    expect(settingsManifest.pages.find(p => p.id === 'settings/sharing')?.href).toBe('/settings/sharing');
    expect(settingsManifest.pages.find(p => p.id === 'settings/bio')?.href).toBe('/settings/bio');
    for (const key of ['sharing.defaultExpiryDays','sharing.maxTargetsPerLink','sharing.presentationPolicy','bio.maxLinks']) expect(safeConfigShape().find(s => s.key === key)).toMatchObject({ owner: { kind: 'product', id: 'settings' }, consumption: 'active' });
  });
  it('requires manager authority for both features', () => {
    for (const role of ['owner','admin','editor','contributor','viewer','client','unknown']) {
      const p = resolvePermissions({ role, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] });
      for (const feature of ['settings/sharing','settings/bio'] as const) expect(p.features[feature]).toEqual({ read: ['owner','admin'].includes(role), write: ['owner','admin'].includes(role) });
    }
  });
  it('keeps installation, plan and member feature grants independent', () => {
    const plan = resolveEntitlements({ ...source, planFeatures: ['product_v2','settings/sharing'] });
    expect(plan.features['settings/sharing']).toBe(true); expect(plan.features['settings/bio']).toBe(false);
    const member = resolveEntitlements({ ...source, membership: { ...source.membership, disabledModules: ['settings/sharing'] } });
    expect(member.features['settings/sharing']).toBe(false); expect(member.features['settings/bio']).toBe(true);
    const root = resolveEntitlements({ ...source, installationAvailability: { 'entitlements.features.settings/bio': false } });
    expect(root.features['settings/bio']).toBe(false); expect(root.features['settings/sharing']).toBe(true);
  });
  it('declares all MCP tool features and write gates', () => {
    expect(new Set(sharingToolDefinitions.map(t => t.name))).toEqual(new Set(Object.keys(SHARING_TOOL_ACCESS)));
    for (const [name, rule] of Object.entries(SHARING_TOOL_ACCESS)) {
      expect(sharingWriteTools.has(name)).toBe(rule.mode === 'write');
      expect(rule.feature).toBe(name.includes('bio') ? 'settings/bio' : 'settings/sharing');
    }
  });
});
