import { describe, expect, it } from 'vitest';
import { moduleManifests } from '@/modules';
import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { configurationOwner } from '@/lib/config/ownership';
import { installedMcpGroups } from '@/modules/installed-mcp';

describe('installed writing agents and asynchronous Posts exports', () => {
 it('exposes the module and its real Root-managed policies', () => {
  expect(moduleManifests.find(module => module.id === 'agents')).toMatchObject({ href: '/content/agents', pages: [expect.objectContaining({ id: 'agents/library', href: '/content/agents' })] });
  for (const key of ['agents.policy', 'agents.copy']) {
   const definition = CONFIG_BY_KEY.get(key)!;
   expect(definition.schema.safeParse(definition.defaultValue).success).toBe(true);
   expect(configurationOwner(key)).toEqual({ kind: 'product', id: 'agents' });
  }
  for (const key of ['entitlements.modules.agents', 'entitlements.features.agents/library']) expect(CONFIG_BY_KEY.get(key)?.kind).toBe('boolean');
 });
 it('installs a scheduled export job with validated module-owned settings', () => {
  const module = moduleManifests.find(module => module.id === 'publishing')!;
  expect(module.jobs).toContainEqual({ name: 'postExports', label: 'Background Posts CSV exports', configKey: 'publishing.asyncExportSchedule' });
  for (const key of ['publishing.asyncExportPolicy', 'publishing.asyncExportCopy', 'publishing.asyncExportSchedule']) {
   const definition = CONFIG_BY_KEY.get(key)!;
   expect(definition.schema.safeParse(definition.defaultValue).success).toBe(true);
   expect(configurationOwner(key)).toEqual({ kind: 'product', id: 'publishing' });
  }
  expect(CONFIG_BY_KEY.get('publishing.asyncExportSchedule')!.schema.safeParse('invalid').success).toBe(false);
 });
 it('registers the two service-owning MCP groups with separate scope classifications', () => {
  const groups = installedMcpGroups();
  expect(groups.find(group => group.id === 'agents')?.scope?.workspaceTools).toContain('writing_agents');
  expect(groups.find(group => group.id === 'publishing-export-jobs')?.scope?.resourceTools).toContain('posts_export_job');
 });
});
