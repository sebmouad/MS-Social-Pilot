import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn() } }));
vi.mock('@/server/config/store', async () => {
  const { FEEDS_CONFIG } = await import('../src/modules/feeds/config');
  const defaults: Record<string, unknown> = { ...Object.fromEntries(FEEDS_CONFIG.map(e => [e.key, e.defaultValue])), 'data.workspaceOperationTimeoutMs': 30000, 'publishing.maxMessageCharacters': 5000, 'publishing.maxImageAltCharacters': 100, 'publishing.maxImageUploadBytes': 8388608 };
  const read = (key: string) => (key in state.overrides ? state.overrides[key] : defaults[key]);
  return { runtimeConfig: async (key: string) => read(key), runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, read(key)])), runtimeSecret: async () => null };
});

import { runFeedPolling } from '../src/modules/feeds/server/polling';
import { FEEDS_JOBS } from '../src/modules/feeds/manifest';

const store = (sources: unknown[]) => ({ enabledSources: vi.fn(async () => sources), pages: vi.fn(), ledgerSince: vi.fn(), expireStale: vi.fn(), claim: vi.fn(), settle: vi.fn(), recordRun: vi.fn(async () => undefined) });

beforeEach(() => { state.overrides = {}; });

describe('recipe planning inside the feedsPoll job', () => {
  it('shares the existing job and schedule instead of adding a worker job', () => {
    expect(FEEDS_JOBS.map(job => job.name)).toEqual(['feedsPoll']);
  });

  it('does nothing visible while the Root switch is off, even when RSS reading is off too', async () => {
    const recipes = store([]);
    const summary = await runFeedPolling({ recipes: { store: recipes as never } });
    expect(summary.recipes).toBeUndefined();
    expect(summary.reason).toBe('disabled');
    expect(recipes.enabledSources).not.toHaveBeenCalled();
  });

  it('runs the planner when switched on and reports its summary next to the feed summary', async () => {
    state.overrides = { 'feeds.wordpress.enabled': true };
    const recipes = store([]);
    const summary = await runFeedPolling({ recipes: { store: recipes as never } });
    expect(summary.reason).toBe('disabled');
    expect(summary.recipes).toMatchObject({ sources: 0, planned: 0 });
    expect(recipes.enabledSources).toHaveBeenCalledTimes(1);
  });

  it('records a missing database address on the source and never fails the feed job', async () => {
    state.overrides = { 'feeds.wordpress.enabled': true };
    const source = { id: 's1', workspaceId: 'w1', name: 'n', siteUrl: 'https://recettes.newsgeet.com', enabled: true, allTargets: true, targetIds: [], config: {}, lastRunAt: null, lastError: null, lastSummary: null, createdAt: new Date(), updatedAt: new Date() };
    const recipes = store([source]);
    const summary = await runFeedPolling({ recipes: { store: recipes as never, databaseUrl: async () => null } });
    expect(summary.recipes?.reason).toBe('database_unavailable');
    expect(recipes.recordRun).toHaveBeenCalledWith('w1', 's1', expect.objectContaining({ error: 'The recipe library could not be reached.' }));
    recipes.enabledSources.mockRejectedValueOnce(new Error('database down'));
    await expect(runFeedPolling({ recipes: { store: recipes as never } })).resolves.toMatchObject({ reason: 'disabled' });
  });
});
