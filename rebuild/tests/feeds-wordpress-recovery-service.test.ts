import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: vi.fn(), workspace: vi.fn(), overrides: {} as Record<string, unknown>, source: null as null | Record<string, unknown>, exec: [] as Array<{ sql: string; values: unknown[] }>,
  existing: [] as Array<{ id: string; enabled: boolean; allTargets?: boolean; targetIds?: unknown }>, pages: [{ id: 'p1', name: 'Page 1' }, { id: 'p2', name: 'Page 2' }],
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { FEEDS_CONFIG } = await import('../src/modules/feeds/config');
  const defaults: Record<string, unknown> = { ...Object.fromEntries(FEEDS_CONFIG.map(e => [e.key, e.defaultValue])), 'data.workspaceOperationTimeoutMs': 30000, 'publishing.maxMessageCharacters': 5000, 'publishing.maxImageAltCharacters': 100, 'publishing.maxImageUploadBytes': 8388608 };
  return { runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, key in state.overrides ? state.overrides[key] : defaults[key]])), runtimeConfig: async (key: string) => defaults[key], runtimeSecret: async () => 'mysql://reader:secret@127.0.0.1/newsgeet' };
});
vi.mock('../src/modules/feeds/server/access', async () => {
  const AUTHOR_ROLES = new Set(['owner', 'admin', 'editor', 'contributor']);
  const { OperationError } = await import('../src/lib/operation-error');
  return {
    AUTHOR_ROLES, authorizeFeeds: state.auth, qualifyingOwner: vi.fn(),
    authorizeFeedWrite: async (actor: unknown) => { const r = await state.auth(actor, 'write'); if (!AUTHOR_ROLES.has(r.role)) throw new OperationError('forbidden', 'You do not have permission to manage feeds.'); return r; },
  };
});
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.workspace }));
vi.mock('../src/modules/feeds/server/wordpress-store', () => ({
  selectSource: vi.fn(async () => state.source), selectPlans: vi.fn(async () => []), countPlans: vi.fn(async () => ({})), prismaRecipeStore: {},
}));

import { readRecipeSource, retryRecipeSlotsNow, setRecipeSourceState } from '../src/modules/feeds/server/wordpress';
import { forgetPoolHealth } from '../src/modules/feeds/server/wordpress-pool';
import type { PlannerPorts } from '../src/modules/feeds/server/wordpress-planner';
import type { LedgerRow, RecipeStore } from '../src/modules/feeds/server/wordpress-store';

const actor = { userId: 'u1', workspaceId: 'w1' };
const NOW = new Date('2026-10-21T09:30:00Z');
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const sourceRow = (over: Record<string, unknown> = {}) => ({ id: 'wrs_1', workspaceId: 'w1', name: 'Recettes', siteUrl: 'https://recettes.newsgeet.com', enabled: true, allTargets: true, targetIds: [], config: {}, lastRunAt: null, lastError: null, lastSummary: null, createdAt: NOW, updatedAt: NOW, ...over });
const executed = (needle: string) => state.exec.filter(e => e.sql.includes(needle));
const wpRow = (id: number) => ({ id: String(id), title: `Titre ${id}`, slug: `recette-${id}`, publishedAt: null, caption: `Légende ${id}`, imageId: String(id + 1), recipe: JSON.stringify({ title: `Recette ${id}`, ingredients: ['a'], steps: ['b'] }) });
const ledgerRow = (over: Partial<LedgerRow> = {}): LedgerRow => ({ id: 'plan1', sourceId: 'wrs_1', targetId: 'p1', wpPostId: '5000', slotAt: new Date('2026-10-22T10:00:00Z'), state: 'planned', postId: 'post1', title: 'T', permalink: null, reason: null, skipped: [], claimedAt: NOW, ...over });

type Overrides = { store?: Partial<RecipeStore>; cancelPost?: PlannerPorts['cancelPost']; postForSlot?: PlannerPorts['postForSlot'] };
function fakePorts(rows: Array<ReturnType<typeof wpRow>>, over: Overrides = {}) {
  const close = vi.fn(async () => undefined);
  const store: RecipeStore = {
    enabledSources: async () => [], pages: async () => state.pages, ledgerSince: async () => [], expireStale: async () => 0, claim: async () => 'claim', settle: async () => undefined,
    recordRun: async () => undefined, unresolved: async () => [], plannedUpcoming: async () => [], settleIf: async () => true, ...over.store,
  };
  const ports: PlannerPorts = {
    databaseUrl: async () => 'mysql://x', now: () => NOW, validateTarget: async () => undefined,
    openDb: async () => ({ candidates: async q => (q.afterId === null ? rows : []), attachments: async ids => new Map(ids.map(id => [id, `2026/10/${id}.webp`] as const)), ping: async () => undefined, close }),
    store, createPost: vi.fn(async () => ({ id: 'newpost' })),
    cancelPost: over.cancelPost ?? vi.fn(async () => undefined), postForSlot: over.postForSlot ?? vi.fn(async () => null),
    image: { download: async () => Buffer.from('w'), inspect: async () => undefined, convert: async () => Buffer.from('j'), store: async () => ({ id: 'm1' }) },
    qualify: async () => null,
  };
  return { ports, close };
}

beforeEach(() => {
  vi.clearAllMocks(); state.overrides = { 'feeds.wordpress.enabled': true }; state.source = sourceRow(); state.exec = []; state.existing = [{ id: 'wrs_1', enabled: true, allTargets: true, targetIds: [] }];
  forgetPoolHealth('wrs_1');
  state.auth.mockResolvedValue({ role: 'owner', actor, permissions: {}, entitlements: {}, workspaceWide: true });
  state.workspace.mockImplementation((_id: string, cb: () => Promise<unknown>) => cb());
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRawUnsafe.mockImplementation(async () => [{ id: 'wrs_1' }]);
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
    if (q.sql.includes('FROM targets')) return state.pages;
    if (q.sql.includes('FROM wordpress_recipe_sources')) return state.existing;
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { state.exec.push(sql(s, v)); return 1; });
});

describe('pausing with cancellation of scheduled posts', () => {
  const input = { enabled: false, cancelScheduled: true, confirmation: 'PAUSE RECIPE SOURCE AND CANCEL SCHEDULED POSTS' };
  const withRows = (rows: LedgerRow[], cancelPost: PlannerPorts['cancelPost'] = vi.fn(async () => undefined)) => {
    const settleIf = vi.fn(async () => true);
    return { ports: fakePorts([], { cancelPost, store: { plannedUpcoming: async () => rows, settleIf } }).ports, cancelPost, settleIf };
  };

  it('needs its own exact confirmation and refuses to combine with resume', async () => {
    await expect(setRecipeSourceState(actor, { ...input, confirmation: 'PAUSE RECIPE SOURCE' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setRecipeSourceState(actor, { enabled: true, cancelScheduled: true, confirmation: 'RESUME RECIPE SOURCE' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.exec).toHaveLength(0);
  });

  it('is unavailable while Root switches the option off, and pauses nothing', async () => {
    state.overrides['feeds.wordpress.pauseCancelEnabled'] = false;
    await expect(setRecipeSourceState(actor, input)).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.exec).toHaveLength(0);
  });

  it('pauses, cancels the source posts through Publishing, releases only cancelled slots and audits both', async () => {
    const cancelPost = vi.fn(async (_actor: unknown, postId: string) => { if (postId === 'post2') throw new Error('no'); });
    const { ports, settleIf } = withRows([ledgerRow(), ledgerRow({ id: 'plan2', postId: 'post2' })], cancelPost);
    const result = await setRecipeSourceState(actor, input, ports);
    expect(result).toMatchObject({ id: 'wrs_1', enabled: false, cancellation: { cancelled: 1, notCancelled: 1, remaining: false, incomplete: false } });
    expect(executed('UPDATE wordpress_recipe_sources')[0]!.values).toContain(false);
    expect(cancelPost).toHaveBeenCalledWith(actor, 'post1');
    expect(settleIf).toHaveBeenCalledTimes(1);
    expect(settleIf).toHaveBeenCalledWith('w1', 'plan1', 'planned', expect.objectContaining({ state: 'failed', reason: 'cancelled', expectedPostId: 'post1' }));
    const actions = executed('activity_logs').map(e => e.values.find(v => typeof v === 'string' && v.startsWith('feeds.')));
    expect(actions).toEqual(['feeds.recipe_source_paused', 'feeds.recipe_source_posts_cancelled']);
  });

  it('keeps the pause when cancellation fails unexpectedly and says it is incomplete', async () => {
    const { ports } = fakePorts([], { store: { plannedUpcoming: async () => { throw new Error('db'); } } });
    const result = await setRecipeSourceState(actor, input, ports);
    expect(result).toMatchObject({ enabled: false, cancellation: { cancelled: 0, remaining: true, incomplete: true } });
  });

  it('cancels at most the Root batch size and reports that more remain', async () => {
    state.overrides['feeds.wordpress.pauseCancelBatchSize'] = 2;
    const { ports, cancelPost } = withRows([1, 2, 3].map(n => ledgerRow({ id: `plan${n}`, postId: `post${n}` })));
    const result = await setRecipeSourceState(actor, input, ports) as { cancellation: { cancelled: number; remaining: boolean } };
    expect(cancelPost).toHaveBeenCalledTimes(2);
    expect(result.cancellation).toMatchObject({ cancelled: 2, remaining: true });
  });

  it('never cancels a post outside a channel-limited member access', async () => {
    state.source = sourceRow({ allTargets: false, targetIds: ['p1'] });
    state.existing = [{ id: 'wrs_1', enabled: true, allTargets: false, targetIds: ['p1'] }];
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['p1'] }, permissions: {}, entitlements: {}, workspaceWide: false });
    const { ports, cancelPost } = withRows([ledgerRow(), ledgerRow({ id: 'plan2', targetId: 'p2', postId: 'post2' })]);
    await setRecipeSourceState(actor, input, ports);
    expect(cancelPost).toHaveBeenCalledTimes(1);
    expect(cancelPost).toHaveBeenCalledWith({ ...actor, allowedTargetIds: ['p1'] }, 'post1');
  });
});

describe('retrying failed times', () => {
  it('needs the exact confirmation, an active source and the Root switch', async () => {
    await expect(retryRecipeSlotsNow(actor, { confirmation: 'RETRY' }, fakePorts([]).ports)).rejects.toMatchObject({ code: 'invalid_request' });
    state.source = sourceRow({ enabled: false });
    await expect(retryRecipeSlotsNow(actor, { confirmation: 'RETRY RECIPE SLOTS' }, fakePorts([]).ports)).rejects.toMatchObject({ code: 'conflict' });
    state.source = sourceRow(); state.overrides['feeds.wordpress.enabled'] = false;
    await expect(retryRecipeSlotsNow(actor, { confirmation: 'RETRY RECIPE SLOTS' }, fakePorts([]).ports)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('checks an uncertain time in Publishing and records the existing post instead of planning again', async () => {
    const settleIf = vi.fn(async () => true);
    const old = new Date(NOW.getTime() - 3600_000);
    const uncertain = ledgerRow({ id: 'u1', state: 'uncertain', postId: null, claimedAt: old });
    const { ports, close } = fakePorts(Array.from({ length: 10 }, (_, i) => wpRow(5000 - i)), { postForSlot: vi.fn(async () => ({ id: 'postX' })), store: { unresolved: async () => [uncertain], settleIf } });
    const result = await retryRecipeSlotsNow(actor, { confirmation: 'RETRY RECIPE SLOTS' }, ports);
    expect(result).toMatchObject({ reconciled: 1, released: 0, planned: 0 });
    expect(settleIf).toHaveBeenCalledWith('w1', 'u1', 'uncertain', expect.objectContaining({ state: 'planned', postId: 'postX' }));
    expect(ports.createPost).not.toHaveBeenCalled();
    expect(executed('activity_logs')[0]!.values).toContain('feeds.recipe_slots_retried');
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('recipe pool health', () => {
  it('reports eligible recipes and days left per channel and flags a low supply', async () => {
    const { ports } = fakePorts(Array.from({ length: 10 }, (_, i) => wpRow(5000 - i)));
    const view = await readRecipeSource(actor, {}, ports);
    expect(view.pool).toMatchObject({ complete: true, low: true, warnDays: 14, slotsPerDay: 4, candidates: 10 });
    expect(view.pool!.pages).toEqual([
      { targetId: 'p1', targetName: 'Page 1', eligible: 10, daysLeft: 1, low: true },
      { targetId: 'p2', targetName: 'Page 2', eligible: 10, daysLeft: 1, low: true },
    ]);
    expect(view.limits.pauseCancel).toBe(true);
  });

  it('is not low when the supply lasts longer than the Root threshold, and is null when the library is unreachable', async () => {
    state.overrides['feeds.wordpress.poolWarnDays'] = 1;
    const { ports } = fakePorts(Array.from({ length: 10 }, (_, i) => wpRow(5000 - i)));
    expect((await readRecipeSource(actor, {}, ports)).pool).toMatchObject({ low: false });
    forgetPoolHealth('wrs_1');
    expect((await readRecipeSource(actor, {}, { ...ports, databaseUrl: async () => null })).pool).toBeNull();
  });

  it('shows a channel-limited member only their channels', async () => {
    state.source = sourceRow({ allTargets: false, targetIds: ['p1'] });
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['p1'] }, permissions: {}, entitlements: {}, workspaceWide: false });
    const { ports } = fakePorts([wpRow(5000)]);
    const view = await readRecipeSource(actor, {}, ports);
    expect(view.pool!.pages.map(p => p.targetId)).toEqual(['p1']);
  });
});
