import { describe, expect, it } from 'vitest';
import { FEEDS_CONFIG, FEEDS_DEFAULTS } from '../src/modules/feeds/config';
import { FEEDS_FEATURE_ID, FEEDS_JOBS, FEEDS_PAGES, FEEDS_ROOT_KEYS } from '../src/modules/feeds/manifest';
import { FEEDS_MCP, feedToolDefinitions, feedTools, feedWriteTools } from '../src/modules/feeds/mcp';
import { feedsCopy, feedsLocale, feedsText } from '../src/modules/feeds/copy';
import { publishingManifest } from '../src/modules/publishing/manifest';
import { moduleManifests } from '../src/modules';
import { INSTALLED_MODULE_CONFIG } from '../src/modules/installed-config';
import { installedMcpGroups } from '../src/modules/installed-mcp';
import { classifyTool, resourceAllowedForScope, toolAllowedForScope } from '../src/modules/settings/mcp-access/tool-policy';
import { configurationOwner } from '../src/lib/config/ownership';
import { PAGES } from '../src/lib/product';
import { workerConfigKeys } from '../src/server/jobs/worker';

describe('content feeds module declarations', () => {
  it('declares exactly the Root keys it registers, owned by Publishing', () => {
    expect([...FEEDS_ROOT_KEYS].sort()).toEqual(FEEDS_CONFIG.map(entry => entry.key).sort());
    for (const key of FEEDS_ROOT_KEYS) {
      expect(INSTALLED_MODULE_CONFIG.some(entry => entry.key === key)).toBe(true);
      expect(configurationOwner(key)).toEqual({ kind: 'product', id: 'publishing' });
    }
    expect(new Set(FEEDS_CONFIG.map(e => e.key)).size).toBe(FEEDS_CONFIG.length);
  });

  it('registers validated, active keys with safe defaults', () => {
    for (const e of FEEDS_CONFIG) { expect(e.consumption).toBe('active'); expect(e.schema.safeParse(e.defaultValue).success).toBe(true); }
    expect(FEEDS_CONFIG.find(e => e.key === 'feeds.allowHttp')!.defaultValue).toBe(false);
    expect(FEEDS_CONFIG.find(e => e.key === 'feeds.autoCheck.enabled')!.defaultValue).toBe(false);
    const bound = (key: string) => FEEDS_CONFIG.find(e => e.key === key)!.schema;
    expect(bound('feeds.autoCheck.intervalSeconds').safeParse(10).success).toBe(false);
    expect(bound('feeds.autoCheck.schedule').safeParse('not a cron').success).toBe(false);
    expect(bound('feeds.autoCheck.schedule').safeParse(FEEDS_DEFAULTS.autoCheckSchedule).success).toBe(true);
    expect(bound('feeds.autoCheck.maxItemsPerFeed').safeParse(51).success).toBe(false);
    expect(bound('feeds.autoCheck.disableAfterFailures').safeParse(0).success).toBe(true);
  });

  it('is a Publishing feature slice with its own navigation entry and no new module', () => {
    expect(FEEDS_PAGES[0].id).toBe(FEEDS_FEATURE_ID);
    expect(publishingManifest.pages.filter(page => page.id === FEEDS_FEATURE_ID)).toHaveLength(1);
    expect(PAGES.find(page => page.id === FEEDS_FEATURE_ID)).toMatchObject({ title: 'Content feeds', href: '/publishing/feeds', module: 'publishing' });
    expect(moduleManifests.map(m => m.id)).not.toContain('feeds');
  });

  it('declares the worker job under Publishing with a Root schedule', () => {
    expect(publishingManifest.jobs).toEqual(expect.arrayContaining([...FEEDS_JOBS]));
    expect(FEEDS_JOBS[0]).toEqual({ name: 'feedsPoll', label: 'Content feed reading', configKey: 'feeds.autoCheck.schedule' });
    expect(workerConfigKeys).toContain('feeds.autoCheck.schedule');
  });
});

describe('content feeds MCP surface', () => {
  const group = FEEDS_MCP[0]!;
  it('is installed, feature bound and declares closed schemas', () => {
    expect(installedMcpGroups()).toContain(group);
    expect(feedTools.size).toBe(5);
    for (const tool of feedToolDefinitions) {
      expect(group.features[tool.name]).toBe(FEEDS_FEATURE_ID);
      expect((tool.inputSchema as { additionalProperties: boolean }).additionalProperties).toBe(false);
      if (feedWriteTools.has(tool.name) && tool.name !== 'check_content_feed') expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toContain('confirmation');
    }
    expect([...group.writeTools!].sort()).toEqual([...feedWriteTools].sort());
  });

  it('classifies tools and the resource as channel-scoped (the service enforces the ceiling)', () => {
    const restricted = { permissions: { pageScope: { all: false, ids: ['t1'] } }, apiKeyId: 'k1', resourceRestricted: true } as never;
    for (const tool of feedToolDefinitions) {
      expect(classifyTool(tool.name)).toBe('resource');
      expect(toolAllowedForScope(restricted, tool.name)).toBe(true);
    }
    expect(resourceAllowedForScope(restricted, 'msp://feeds/sources')).toBe(true);
    expect(group.resources![0]).toMatchObject({ uri: 'msp://feeds/sources', readTool: 'list_content_feeds', feature: FEEDS_FEATURE_ID });
  });

  it('keeps preview free of confirmation while creating modes name theirs', () => {
    const check = feedToolDefinitions.find(t => t.name === 'check_content_feed')!;
    expect((check.inputSchema as unknown as { required: string[] }).required).toEqual(['id']);
    expect(check.description).toContain('CREATE FEED POSTS');
    expect(check.description).toContain('CREATE FEED DRAFTS');
  });
});

describe('content feeds copy', () => {
  it('has the same keys in English and French and picks the language from accept-language', () => {
    expect(Object.keys(feedsCopy.fr).sort()).toEqual(Object.keys(feedsCopy.en).sort());
    expect(feedsLocale('fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(feedsLocale('en-US,en;q=0.9')).toBe('en');
    expect(feedsLocale(null)).toBe('en');
    expect(feedsText('fr', 'postsCreated', { count: 2, held: 1 })).toBe('2 publication(s) créée(s) (1 en attente de validation).');
    expect(feedsText('en', 'templateHint')).toContain('{title}');
  });
});
