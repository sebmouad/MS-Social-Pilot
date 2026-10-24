import { describe, expect, it } from 'vitest';
import { moduleManifests } from '@/modules';
import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { configurationOwner } from '@/lib/config/ownership';
import { installedMcpGroups } from '@/modules/installed-mcp';

describe('installed AI studio and asynchronous Posts exports', () => {
 it('exposes the module, its tabs and its real Root-managed policies', () => {
  expect(moduleManifests.find(module => module.id === 'studio')).toMatchObject({ href: '/content/ai-studio', pages: [
   expect.objectContaining({ id: 'studio/ai-studio', href: '/content/ai-studio' }),
   expect.objectContaining({ id: 'studio/agents', href: '/content/agents' }),
   expect.objectContaining({ id: 'studio/tests', href: '/insights/tests' }),
  ] });
  for (const key of ['agents.policy', 'agents.copy', 'agents.scheduledRunsSchedule', 'ai.enabled', 'ai.toolsCopy', 'ai.videoSchedule', 'captionTests.policy', 'captionTests.copy', 'ai.translatedPosts.policy', 'ai.toolErrorCopy']) {
   const definition = CONFIG_BY_KEY.get(key)!;
   expect(definition.schema.safeParse(definition.defaultValue).success, key).toBe(true);
   expect(configurationOwner(key)).toEqual({ kind: 'product', id: 'studio' });
  }
  // Key namespace is not ownership: the caption schedule keeps its publishing.* name so stored
  // Root values keep working, but the explicit Studio declaration wins over the prefix.
  expect(CONFIG_BY_KEY.get('publishing.captionTestsSchedule')!.schema.safeParse('*/15 * * * *').success).toBe(true);
  expect(configurationOwner('publishing.captionTestsSchedule')).toEqual({ kind: 'product', id: 'studio' });
  for (const key of ['entitlements.modules.studio', 'entitlements.features.studio/ai-studio', 'entitlements.features.studio/agents', 'entitlements.features.studio/tests']) expect(CONFIG_BY_KEY.get(key)?.kind).toBe('boolean');
 });
 it('declares the studio background jobs with module-owned validated Root schedules', () => {
  const module = moduleManifests.find(module => module.id === 'studio')!;
  expect(module.jobs).toContainEqual({ name: 'scheduledAgents', label: 'Scheduled writing runs', configKey: 'agents.scheduledRunsSchedule' });
  expect(module.jobs).toContainEqual({ name: 'captionTests', label: 'Caption test results', configKey: 'publishing.captionTestsSchedule' });
  expect(module.jobs).toContainEqual({ name: 'aiVideos', label: 'AI video progress', configKey: 'ai.videoSchedule' });
  for (const key of ['agents.scheduledRunsSchedule', 'publishing.captionTestsSchedule', 'ai.videoSchedule']) {
   expect(CONFIG_BY_KEY.get(key)!.schema.safeParse('invalid').success, key).toBe(false);
  }
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
 it('registers the service-owning MCP groups with separate scope classifications', () => {
  const groups = installedMcpGroups();
  expect(groups.find(group => group.id === 'agents')?.scope?.workspaceTools).toContain('writing_agents');
  expect(groups.find(group => group.id === 'caption-tests')?.scope?.resourceTools).toContain('list_caption_tests');
  expect(groups.find(group => group.id === 'ai-content-tools')?.scope?.workspaceTools).toContain('generate_ai_image');
  expect(groups.find(group => group.id === 'ai')?.scope?.resourceTools).toContain('ai_assist_write');
  expect(groups.find(group => group.id === 'ai-translated-posts')?.scope?.resourceTools).toContain('suggest_post_translations');
  expect(groups.find(group => group.id === 'publishing-export-jobs')?.scope?.resourceTools).toContain('posts_export_job');
 });
});
