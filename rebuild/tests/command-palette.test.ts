import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: vi.fn(), entitlements: vi.fn(), permissions: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/server/entitlements', () => ({
  loadEntitlements: mocks.entitlements,
  canUseModule: (_e: unknown, id: string) => !deniedModules.has(id),
  canUseFeature: (_e: unknown, id: string) => !deniedFeatures.has(id),
}));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/permissions', () => ({
  canAccessModule: (_p: unknown, id: string) => !deniedModules.has(id),
  canAccessFeature: (_p: unknown, id: string) => !deniedFeatures.has(id),
}));

const deniedModules = new Set<string>();
const deniedFeatures = new Set<string>();

import { listNavigationCommands } from '@/modules/home/server/commands';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };

beforeEach(() => {
  vi.clearAllMocks();
  deniedModules.clear();
  deniedFeatures.clear();
  mocks.config.mockResolvedValue(25);
  mocks.entitlements.mockResolvedValue({ workspaceId: 'workspace-a' });
  mocks.permissions.mockResolvedValue({});
});

describe('command palette commands', () => {
  it('lists installed pages in sidebar order with sidebar titles', async () => {
    const { items } = await listNavigationCommands(actor);
    expect(items.length).toBeGreaterThan(5);
    expect(items[0]).toMatchObject({ id: 'home/overview', href: '/home' });
    const { PAGES } = await import('@/lib/product');
    for (const item of items) {
      const page = PAGES.find(candidate => candidate.id === item.id);
      expect(page?.title).toBe(item.title);
      expect(page?.href).toBe(item.href);
    }
  });

  it('reaches every promoted page of the 2026-10-22 organization (Feeds, AI studio, Caption tests)', async () => {
    const { items } = await listNavigationCommands(actor);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'publishing/feeds', href: '/content/feeds' }),
      expect.objectContaining({ id: 'publishing/ai-studio', href: '/content/ai-studio' }),
      expect.objectContaining({ id: 'analytics/tests', href: '/insights/tests' }),
    ]));
  });

  it('leaves out modules and features the member cannot use', async () => {
    deniedModules.add('ads');
    deniedFeatures.add('settings/data');
    const { items } = await listNavigationCommands(actor);
    expect(items.some(item => item.module === 'ads')).toBe(false);
    expect(items.some(item => item.id === 'settings/data')).toBe(false);
    expect(items.some(item => item.id === 'home/overview')).toBe(true);
  });

  it('filters by title, module and feature id', async () => {
    const { items } = await listNavigationCommands(actor, { q: 'inbox' });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(`${item.title} ${item.moduleTitle} ${item.id}`.toLowerCase()).toContain('inbox');
  });

  it('rejects oversized searches and refuses signed-out callers', async () => {
    await expect(listNavigationCommands(actor, { q: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.entitlements.mockResolvedValue(null);
    await expect(listNavigationCommands(actor)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('is reachable through the MCP tool with the same service', async () => {
    const { HOME_MCP } = await import('@/modules/home/mcp');
    const group = HOME_MCP.find(entry => entry.id === 'home')!;
    const tool = group.tools.find(entry => entry.name === 'list_navigation_commands');
    expect(tool).toBeDefined();
    const result = (await group.execute({ userId: 'user-a', workspaceId: 'workspace-a' } as never, 'list_navigation_commands', { q: 'home' }, 25)) as { items: unknown[] };
    expect(result.items.length).toBeGreaterThan(0);
  });
});
