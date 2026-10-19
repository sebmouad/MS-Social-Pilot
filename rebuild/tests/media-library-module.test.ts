import { describe, expect, it } from 'vitest';
import { MEDIA_CONFIG } from '../src/modules/media/config';
import { MEDIA_FEATURE_ID, MEDIA_PAGES, MEDIA_ROOT_KEYS } from '../src/modules/media/manifest';
import { MEDIA_MCP, mediaToolDefinitions, mediaWriteTools } from '../src/modules/media/mcp';
import { mediaCopy, mediaText } from '../src/modules/media/copy';
import { publishingManifest } from '../src/modules/publishing/manifest';
import { INSTALLED_MODULE_CONFIG } from '../src/modules/installed-config';
import { installedMcpGroups } from '../src/modules/installed-mcp';
import { classifyTool, resourceAllowedForScope, toolAllowedForScope } from '../src/modules/settings/mcp-access/tool-policy';
import { configurationOwner } from '../src/lib/config/ownership';
import { PAGES } from '../src/lib/product';

describe('media library module declarations', () => {
  it('declares exactly the Root keys it registers, owned by Publishing', () => {
    expect([...MEDIA_ROOT_KEYS].sort()).toEqual(MEDIA_CONFIG.map(entry => entry.key).sort());
    for (const key of MEDIA_ROOT_KEYS) {
      expect(INSTALLED_MODULE_CONFIG.some(entry => entry.key === key)).toBe(true);
      expect(configurationOwner(key)).toEqual({ kind: 'product', id: 'publishing' });
    }
    expect(MEDIA_CONFIG.every(entry => entry.consumption === 'active')).toBe(true);
  });

  it('keeps the library on the existing publishing/media feature and navigation entry', () => {
    expect(MEDIA_PAGES[0].id).toBe(MEDIA_FEATURE_ID);
    expect(publishingManifest.pages.filter(page => page.id === MEDIA_FEATURE_ID)).toHaveLength(1);
    expect(PAGES.find(page => page.id === MEDIA_FEATURE_ID)).toMatchObject({ title: 'Media library', href: '/publishing/media', module: 'publishing' });
  });

  it('bounds stored sizes inside the 32-bit media.size column', () => {
    const bound = (key: string) => MEDIA_CONFIG.find(entry => entry.key === key)!.schema;
    expect(bound('media.videoMaxBytes').safeParse(2147483648).success).toBe(false);
    expect(bound('media.importMaxBytes').safeParse(2147483647).success).toBe(true);
  });
});

describe('media library MCP surface', () => {
  const group = MEDIA_MCP[0]!;
  it('is installed and every tool is workspace-wide and feature bound', () => {
    expect(installedMcpGroups()).toContain(group);
    for (const tool of mediaToolDefinitions) {
      expect(group.features[tool.name]).toBe(MEDIA_FEATURE_ID);
      expect(classifyTool(tool.name)).toBe('workspace');
    }
    expect([...group.writeTools!].sort()).toEqual([...mediaWriteTools].sort());
  });

  it('refuses channel-restricted credentials for tools and the resource', () => {
    const restricted = { permissions: { pageScope: { all: false, ids: ['t1'] } }, apiKeyId: 'k1', resourceRestricted: true } as never;
    const open = { permissions: { pageScope: { all: true } }, apiKeyId: 'k1', resourceRestricted: false } as never;
    for (const tool of mediaToolDefinitions) {
      expect(toolAllowedForScope(restricted, tool.name)).toBe(false);
      expect(toolAllowedForScope(open, tool.name)).toBe(true);
    }
    expect(resourceAllowedForScope(restricted, 'msp://media/library')).toBe(false);
    expect(resourceAllowedForScope(open, 'msp://media/library')).toBe(true);
  });

  it('declares exact-confirmation writes and a readable resource', () => {
    for (const name of mediaWriteTools) {
      const schema = mediaToolDefinitions.find(tool => tool.name === name)!.inputSchema as unknown as { required: string[] };
      expect(schema.required).toContain('confirmation');
    }
    expect(group.resources?.[0]).toMatchObject({ uri: 'msp://media/library', feature: MEDIA_FEATURE_ID, readTool: 'list_media_library' });
  });
});

describe('media library copy', () => {
  it('has the same keys in English and French and interpolates values', () => {
    expect(Object.keys(mediaCopy.fr).sort()).toEqual(Object.keys(mediaCopy.en).sort());
    expect(mediaText('fr', 'storageUsed', { used: '1 MB', quota: '5 GB' })).toBe('1 MB utilisés sur 5 GB');
    expect(mediaText('en', 'usedBy', { count: 3 })).toBe('Used in 3 posts');
    for (const locale of ['en', 'fr'] as const) {
      for (const value of Object.values(mediaCopy[locale])) expect(value.trim()).not.toBe('');
    }
  });
});
