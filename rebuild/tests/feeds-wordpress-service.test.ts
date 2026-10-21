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

import { previewRecipeSource, readRecipeSource, runRecipePlannerNow, saveRecipeSource, setRecipeSourceState } from '../src/modules/feeds/server/wordpress';
import type { PlannerPorts } from '../src/modules/feeds/server/wordpress-planner';
import type { LedgerRow } from '../src/modules/feeds/server/wordpress-store';

const actor = { userId: 'u1', workspaceId: 'w1' };
const NOW = new Date('2026-10-21T09:30:00Z');
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const validateTarget = vi.fn(async () => undefined);
const saveInput = (over: Record<string, unknown> = {}) => ({ name: 'Recettes', siteUrl: 'https://recettes.newsgeet.com/', allTargets: true, targetIds: [], config: { slots: ['08:00'] }, confirmation: 'SAVE RECIPE SOURCE Recettes', ...over });
const sourceRow = (over: Record<string, unknown> = {}) => ({ id: 'wrs_1', workspaceId: 'w1', name: 'Recettes', siteUrl: 'https://recettes.newsgeet.com', enabled: true, allTargets: true, targetIds: [], config: {}, lastRunAt: null, lastError: null, lastSummary: null, createdAt: NOW, updatedAt: NOW, ...over });
const executed = (needle: string) => state.exec.filter(e => e.sql.includes(needle));

beforeEach(() => {
  vi.clearAllMocks(); state.overrides = { 'feeds.wordpress.enabled': true }; state.source = null; state.exec = []; state.existing = [];
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

describe('saving the recipe source', () => {
  it('creates a paused source after the exact confirmation, storing only chosen overrides, and audits it', async () => {
    state.source = sourceRow({ enabled: false, config: { slots: ['08:00'] } });
    const result = await saveRecipeSource(actor, saveInput(), { validateTarget });
    expect(result).toMatchObject({ id: expect.stringMatching(/^wrs_/), created: true, source: { enabled: false, siteUrl: 'https://recettes.newsgeet.com' } });
    const insert = executed('INSERT INTO wordpress_recipe_sources')[0]!;
    expect(insert.values).toEqual(expect.arrayContaining(['w1', 'Recettes', 'https://recettes.newsgeet.com', false, true, '[]', JSON.stringify({ slots: ['08:00'] })]));
    const audit = executed('activity_logs')[0]!;
    expect(audit.values).toEqual(expect.arrayContaining(['feeds.recipe_source_created']));
    expect(String(audit.values[4])).not.toContain('secret');
    expect(validateTarget).not.toHaveBeenCalled();
  });

  it('updates the existing workspace source instead of adding a second', async () => {
    state.existing = [{ id: 'wrs_9', enabled: true }];
    state.source = sourceRow({ id: 'wrs_9' });
    const result = await saveRecipeSource(actor, saveInput({ enabled: undefined }), { validateTarget });
    expect(result).toMatchObject({ id: 'wrs_9', created: false });
    expect(executed('INSERT INTO wordpress_recipe_sources')).toHaveLength(0);
    expect(executed('UPDATE wordpress_recipe_sources')[0]!.values).toContain(true);
  });

  it('refuses a wrong confirmation, unknown fields, bad times, plain http and unknown or invalid channels without writing', async () => {
    const attempts: Array<[Record<string, unknown>, RegExp?]> = [
      [{ confirmation: 'SAVE RECIPE SOURCE Other' }], [{ confirmation: undefined }], [{ extra: true }], [{ config: { slots: ['25:00'] } }], [{ config: { horizonDays: 99 } }], [{ config: { timezone: 'Mars/Base' } }],
      [{ siteUrl: 'http://recettes.newsgeet.com' }], [{ siteUrl: 'https://recettes.newsgeet.com/?x=1' }], [{ siteUrl: 'https://127.0.0.1/' }], [{ allTargets: false, targetIds: [] }], [{ allTargets: false, targetIds: ['p1', 'p1'] }],
      [{ allTargets: false, targetIds: ['other-workspace'] }],
    ];
    for (const [over] of attempts) await expect(saveRecipeSource(actor, saveInput(over), { validateTarget }), JSON.stringify(over)).rejects.toMatchObject({ code: expect.stringMatching(/invalid_request|unavailable/) });
    expect(state.exec).toHaveLength(0);
  });

  it('validates each chosen channel through Publishing and stores the explicit list', async () => {
    state.source = sourceRow({ allTargets: false, targetIds: ['p1'] });
    await saveRecipeSource(actor, saveInput({ allTargets: false, targetIds: ['p1'] }), { validateTarget });
    expect(validateTarget).toHaveBeenCalledWith(actor, 'p1');
    expect(executed('INSERT INTO wordpress_recipe_sources')[0]!.values).toContain(JSON.stringify(['p1']));
    validateTarget.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }));
    await expect(saveRecipeSource(actor, saveInput({ allTargets: false, targetIds: ['p2'] }), { validateTarget })).rejects.toThrow();
  });

  it('requires an authoring role and keeps channel-limited members to their own channels', async () => {
    state.auth.mockResolvedValue({ role: 'viewer', actor, permissions: {}, entitlements: {}, workspaceWide: true });
    await expect(saveRecipeSource(actor, saveInput(), { validateTarget })).rejects.toMatchObject({ code: 'forbidden' });
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['p1'] }, permissions: {}, entitlements: {}, workspaceWide: false });
    await expect(saveRecipeSource(actor, saveInput({ allTargets: true }), { validateTarget })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(saveRecipeSource(actor, saveInput({ allTargets: false, targetIds: ['p2'] }), { validateTarget })).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.exec).toHaveLength(0);
    state.source = sourceRow({ allTargets: false, targetIds: ['p1'] });
    await expect(saveRecipeSource(actor, saveInput({ allTargets: false, targetIds: ['p1'] }), { validateTarget })).resolves.toMatchObject({ created: true });
  });
});

describe('pause and resume', () => {
  it('needs the matching confirmation and audits the change', async () => {
    state.existing = [{ id: 'wrs_1', enabled: true, allTargets: true, targetIds: [] }];
    await expect(setRecipeSourceState(actor, { enabled: false, confirmation: 'RESUME RECIPE SOURCE' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setRecipeSourceState(actor, { enabled: true, confirmation: 'PAUSE RECIPE SOURCE' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.exec).toHaveLength(0);
    await expect(setRecipeSourceState(actor, { enabled: false, confirmation: 'PAUSE RECIPE SOURCE' })).resolves.toEqual({ id: 'wrs_1', enabled: false });
    expect(executed('UPDATE wordpress_recipe_sources')[0]!.values).toContain(false);
    expect(executed('activity_logs')[0]!.values).toContain('feeds.recipe_source_paused');
    await setRecipeSourceState(actor, { enabled: true, confirmation: 'RESUME RECIPE SOURCE' });
    expect(executed('activity_logs')[1]!.values).toContain('feeds.recipe_source_resumed');
  });

  it('reports a missing source and hides a workspace-wide source from channel-limited members', async () => {
    await expect(setRecipeSourceState(actor, { enabled: false, confirmation: 'PAUSE RECIPE SOURCE' })).rejects.toMatchObject({ code: 'not_found' });
    state.existing = [{ id: 'wrs_1', enabled: true, allTargets: true, targetIds: [] }];
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['p1'] }, permissions: {}, entitlements: {}, workspaceWide: false });
    await expect(setRecipeSourceState(actor, { enabled: false, confirmation: 'PAUSE RECIPE SOURCE' })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.exec).toHaveLength(0);
  });
});

describe('reading', () => {
  it('returns the source, resolved config, selectable channels and availability without any secret', async () => {
    state.source = sourceRow({ config: { horizonDays: 3 } });
    const view = await readRecipeSource(actor, {}, { databaseUrl: async () => 'mysql://reader:secret@127.0.0.1/newsgeet' });
    expect(view.available).toBe(true);
    expect(view.source).toMatchObject({ id: 'wrs_1', enabled: true, config: { horizonDays: 3, timezone: 'Europe/Paris', slots: ['07:00', '11:00', '15:00', '17:00'], cooldownDays: 365 } });
    expect(view.defaults).toMatchObject({ timezone: 'Europe/Paris', distinctAcrossPages: true });
    expect(view.pages.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(JSON.stringify(view)).not.toContain('mysql://');
    const off = await readRecipeSource(actor, {}, { databaseUrl: async () => null });
    expect(off.available).toBe(false);
  });

  it('shows a channel-limited member only a source inside their channels and only their channels', async () => {
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['p1'] }, permissions: {}, entitlements: {}, workspaceWide: false });
    state.source = sourceRow({ allTargets: true });
    expect((await readRecipeSource(actor, {}, { databaseUrl: async () => 'x' })).source).toBeNull();
    state.source = sourceRow({ allTargets: false, targetIds: ['p1'] });
    const view = await readRecipeSource(actor, {}, { databaseUrl: async () => 'x' });
    expect(view.source?.id).toBe('wrs_1');
    expect(view.pages.map(p => p.id)).toEqual(['p1']);
    state.source = sourceRow({ allTargets: false, targetIds: ['p1', 'p2'] });
    expect((await readRecipeSource(actor, {}, { databaseUrl: async () => 'x' })).source).toBeNull();
  });

  it('rejects unknown query fields and out-of-range pages', async () => {
    await expect(readRecipeSource(actor, { page: 0 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readRecipeSource(actor, { other: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

const wpRow = (id: number) => ({ id: String(id), title: `Titre ${id}`, slug: `recette-${id}`, publishedAt: null, caption: `Légende ${id}`, imageId: String(id + 1), recipe: JSON.stringify({ title: `Recette ${id}`, ingredients: ['a'], steps: ['b'] }) });
const fakePorts = (rows: Array<ReturnType<typeof wpRow>>, ledger: LedgerRow[] = []) => {
  const close = vi.fn(async () => undefined);
  const recorded: unknown[] = [];
  const ports: Partial<PlannerPorts> = {
    databaseUrl: async () => 'mysql://x', now: () => NOW, validateTarget,
    openDb: async () => ({ candidates: async q => (q.afterId === null ? rows : []), attachments: async ids => new Map(ids.map(id => [id, `2026/10/${id}.webp`] as const)), ping: async () => undefined, close }),
    store: { enabledSources: async () => [], pages: async () => state.pages, ledgerSince: async () => ledger, expireStale: async () => 0, claim: async () => 'claim', settle: async () => undefined, recordRun: async (_w, _s, run) => { recorded.push(run); }, unresolved: async () => [], plannedUpcoming: async () => [], settleIf: async () => true },
    cancelPost: vi.fn(async () => undefined), postForSlot: vi.fn(async () => null),
    createPost: vi.fn(async () => ({ id: 'post1' })),
    image: { download: async () => Buffer.from('w'), inspect: async () => undefined, convert: async () => Buffer.from('j'), store: async () => ({ id: 'm1' }) },
  };
  return { ports, close, recorded };
};

describe('previewing the next recipes', () => {
  it('shows image address, caption and first comment exactly as they will post, skipping recipes already used', async () => {
    state.source = sourceRow();
    const used: LedgerRow = { id: 'x', sourceId: 'wrs_1', targetId: 'p1', wpPostId: '5000', slotAt: NOW, state: 'planned', postId: 'p', title: '', permalink: null, reason: null, skipped: [], claimedAt: NOW };
    const failed: LedgerRow = { ...used, id: 'y', wpPostId: '4999', state: 'failed', skipped: ['4998'] };
    const { ports, close } = fakePorts([5000, 4999, 4998, 4997, 4996, 4995, 4994, 4993].map(wpRow), [used, failed]);
    const result = await previewRecipeSource(actor, {}, ports);
    expect(result.items.map(i => i.wpPostId)).toEqual(['4999', '4997', '4996', '4995', '4994']);
    expect(result.items[0]).toMatchObject({ title: 'Recette 4999', caption: 'Légende 4999', imageUrl: 'https://recettes.newsgeet.com/wp-content/uploads/2026/10/5000.webp', permalink: 'https://recettes.newsgeet.com/recette-4999/' });
    expect(result.items[0]!.firstComment).toContain('🍽️ Recette 4999');
    expect(result.items[0]!.firstComment).toContain('• a');
    expect(result.items[0]!.firstComment).toContain('1. b');
    expect(result.items[0]!.firstComment.endsWith('https://recettes.newsgeet.com/recette-4999/')).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(ports.createPost).not.toHaveBeenCalled();
  });

  it('needs a source and a reachable library', async () => {
    await expect(previewRecipeSource(actor, {}, fakePorts([]).ports)).rejects.toMatchObject({ code: 'not_found' });
    state.source = sourceRow();
    await expect(previewRecipeSource(actor, {}, { ...fakePorts([]).ports, databaseUrl: async () => null })).rejects.toMatchObject({ code: 'unavailable', message: expect.not.stringContaining('mysql') });
  });
});

describe('running the planner now', () => {
  it('needs the exact confirmation, the Root switch and an active source', async () => {
    state.source = sourceRow();
    const { ports } = fakePorts([wpRow(5000)]);
    await expect(runRecipePlannerNow(actor, { confirmation: 'run recipe planner' }, ports)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runRecipePlannerNow(actor, {}, ports)).rejects.toMatchObject({ code: 'invalid_request' });
    state.source = sourceRow({ enabled: false });
    await expect(runRecipePlannerNow(actor, { confirmation: 'RUN RECIPE PLANNER' }, ports)).rejects.toMatchObject({ code: 'conflict' });
    state.source = sourceRow(); state.overrides = { 'feeds.wordpress.enabled': false };
    await expect(runRecipePlannerNow(actor, { confirmation: 'RUN RECIPE PLANNER' }, ports)).rejects.toMatchObject({ code: 'unavailable' });
    expect(ports.createPost).not.toHaveBeenCalled();
  });

  it('plans as the signed-in member, records the run and audits it', async () => {
    state.source = sourceRow({ config: { slots: ['18:00'], horizonDays: 1 } });
    const { ports, close, recorded } = fakePorts(Array.from({ length: 10 }, (_, i) => wpRow(5000 - i)));
    const result = await runRecipePlannerNow(actor, { confirmation: 'RUN RECIPE PLANNER' }, ports);
    expect(result).toMatchObject({ sourceId: 'wrs_1', planned: 2, failed: 0, pages: 2, slots: 1 });
    expect(ports.createPost).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ports.createPost!).mock.calls[0]![0]).toEqual(actor);
    expect(recorded).toHaveLength(1);
    expect(executed('activity_logs')[0]!.values).toContain('feeds.recipe_planner_run');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('is refused to a channel-limited member for a workspace-wide source', async () => {
    state.source = sourceRow({ allTargets: true });
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['p1'] }, permissions: {}, entitlements: {}, workspaceWide: false });
    const { ports } = fakePorts([wpRow(5000)]);
    await expect(runRecipePlannerNow(actor, { confirmation: 'RUN RECIPE PLANNER' }, ports)).rejects.toMatchObject({ code: 'not_found' });
    expect(ports.createPost).not.toHaveBeenCalled();
  });
});
