import { describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';
import { WORDPRESS_DEFAULTS } from '../src/modules/feeds/wordpress/config';
import { RecipeImageError } from '../src/modules/feeds/wordpress/image';
import type { CandidateQuery, WpCandidateRow, WpDb } from '../src/modules/feeds/wordpress/db';
import { planSource, runRecipePlanning, type PlannedPostInput, type PlannerPorts } from '../src/modules/feeds/server/wordpress-planner';
import type { ClaimInput, LedgerRow, RecipeStore, Settlement, SourceRow } from '../src/modules/feeds/server/wordpress-store';
import type { WordpressSettings } from '../src/modules/feeds/server/wordpress-settings';
import type { FeedAuthorization } from '../src/modules/feeds/server/access';

const SITE = 'https://recettes.newsgeet.com';
const NOW = new Date('2026-10-21T09:30:00Z'); // 11:30 in Paris
const auth = { actor: { userId: 'owner1', workspaceId: 'w1' }, role: 'owner', permissions: {}, entitlements: {}, workspaceWide: true } as unknown as FeedAuthorization;

const settings = (over: Partial<WordpressSettings> = {}): WordpressSettings => ({
  enabled: true, tablePrefix: 'wp_', siteUrl: SITE, uploadsPath: '/wp-content/uploads', permalinkTemplate: '{siteUrl}/{slug}/', db: { connectTimeoutMs: 5000, queryTimeoutMs: 15000, poolSize: 2 },
  candidateBatchSize: 50, candidateMaxScan: 5000,
  defaults: {
    mapping: { captionMetaKey: WORDPRESS_DEFAULTS.captionMetaKey, imageMetaKey: WORDPRESS_DEFAULTS.imageMetaKey, recipeMetaKey: WORDPRESS_DEFAULTS.recipeMetaKey, skipMetaKey: WORDPRESS_DEFAULTS.skipMetaKey, attachedFileMetaKey: WORDPRESS_DEFAULTS.attachedFileMetaKey, postType: 'post', postStatus: 'publish' },
    order: 'newest', maxAgeDays: 0, skipShared: true, slots: ['07:00', '11:00', '15:00', '17:00'], timezone: 'Europe/Paris', horizonDays: 2, distinctAcrossPages: true, cooldownDays: 365,
    firstCommentTemplate: WORDPRESS_DEFAULTS.firstCommentTemplate, firstCommentDelayMinutes: 2,
  },
  minLeadMinutes: 5, targetTypes: ['page'], runBudget: 500, maxSourcesPerRun: 50, claimLeaseSeconds: 300, maxSlotAttempts: 3, previewCount: 5, ledgerPageSize: 50, commentMax: 8000, minutesSuffix: ' min', truncationMark: '…',
  image: { fetch: { timeoutMs: 1000, maxBytes: 1_000_000, maxRedirects: 2, allowHttp: false, hostAllowlist: [] }, maxPixels: 10_000_000, quality: 88, minQuality: 60, qualityStep: 8, maxOutputBytes: 1_000_000 },
  altMax: 100, sourceNameMax: 120, textMax: 10000, titleMax: 300, maxTargets: 50, identifierMax: 80, pageNumberMax: 100000, transaction: { timeoutMs: 20000, maxWaitMs: 5000 }, ...over,
});

const recipeJson = (n: number) => JSON.stringify({ title: `Recette ${n}`, description: 'Délicieuse', servings: 4, prep_minutes: 10, cook_minutes: 20, total_minutes: 30, ingredients: [`ingrédient ${n}`], steps: [{ text: `étape ${n}` }] });
const wpRows = (count: number): WpCandidateRow[] => Array.from({ length: count }, (_, i) => {
  const id = 5000 - i;
  return { id: String(id), title: `Titre ${id}`, slug: `recette-${id}`, publishedAt: new Date('2026-09-01T00:00:00Z'), caption: `Légende ${id} #cuisine`, imageId: String(id + 100000), recipe: recipeJson(id) };
});

function fakeDb(rows: WpCandidateRow[]) {
  const queries: CandidateQuery[] = [];
  const db: WpDb = {
    async candidates(q) { queries.push(q); const after = q.afterId === null ? Infinity : Number(q.afterId); return rows.filter(r => Number(r.id) < after).slice(0, q.limit); },
    async attachments(ids) { return new Map(ids.map(id => [id, `2026/10/${Number(id) - 100000}-fb-1.webp`] as const)); },
    ping: async () => undefined, close: vi.fn(async () => undefined),
  };
  return { db, queries };
}

function memoryStore(pages: Array<{ id: string; name: string }>, sources: SourceRow[] = []) {
  const rows: LedgerRow[] = []; const runs: Array<{ sourceId: string; error: string | null; summary: Record<string, unknown> }> = [];
  let counter = 0;
  const store: RecipeStore = {
    enabledSources: async () => sources,
    pages: async () => pages,
    ledgerSince: async (sourceId, from) => rows.filter(r => r.sourceId === sourceId && r.slotAt.getTime() >= from.getTime()),
    expireStale: async (sourceId, before) => { let n = 0; for (const r of rows) if (r.sourceId === sourceId && r.state === 'claimed' && r.claimedAt.getTime() < before.getTime()) { r.state = 'uncertain'; r.reason = 'claim_expired'; n += 1; } return n; },
    async claim(input: ClaimInput) {
      const existing = rows.find(r => r.sourceId === input.sourceId && r.targetId === input.targetId && r.slotAt.getTime() === input.slotAt.getTime());
      if (existing && existing.state !== 'failed') return null;
      const row: LedgerRow = { id: existing?.id ?? `plan${++counter}`, sourceId: input.sourceId, targetId: input.targetId, wpPostId: input.wpPostId, slotAt: input.slotAt, state: 'claimed', postId: null, title: input.title, permalink: input.permalink, reason: null, skipped: input.skipped, claimedAt: NOW };
      if (existing) Object.assign(existing, row); else rows.push(row);
      return row.id;
    },
    async settle(_workspaceId, id, s: Settlement) { const row = rows.find(r => r.id === id)!; row.state = s.state; row.postId = s.postId ?? null; row.reason = s.reason ?? null; if (s.skipped) row.skipped = s.skipped; },
    async recordRun(_w, sourceId, run) { runs.push({ sourceId, error: run.error, summary: run.summary }); },
  };
  return { store, rows, runs };
}

const source = (over: Partial<SourceRow> = {}): SourceRow => ({ id: 's1', workspaceId: 'w1', name: 'Recettes', siteUrl: SITE, enabled: true, allTargets: true, targetIds: [], config: {}, lastRunAt: null, lastError: null, lastSummary: null, createdAt: NOW, updatedAt: NOW, ...over });
const pageList = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `page${i + 1}`, name: `Page ${i + 1}` }));

function harness(opts: { pages?: number; rows?: number; settings?: Partial<WordpressSettings>; sources?: SourceRow[] } = {}) {
  const mem = memoryStore(pageList(opts.pages ?? 10), opts.sources ?? [source()]);
  const wp = fakeDb(wpRows(opts.rows ?? 400));
  const posts: Array<{ actor: unknown; input: PlannedPostInput }> = [];
  let postCounter = 0;
  const ports: PlannerPorts = {
    databaseUrl: async () => 'mysql://reader:secret@127.0.0.1:3306/newsgeet', openDb: vi.fn(async () => wp.db),
    validateTarget: vi.fn(async () => undefined),
    createPost: vi.fn(async (actor, input) => { posts.push({ actor, input }); return { id: `post${++postCounter}` }; }),
    image: { download: vi.fn(async () => Buffer.from('w')), inspect: vi.fn(async () => undefined), convert: vi.fn(async () => Buffer.from('j')), store: vi.fn(async () => ({ id: `m${postCounter + 1}` })) },
    qualify: vi.fn(async () => auth), store: mem.store, now: () => NOW,
  };
  const cfg = settings(opts.settings);
  const ctx = (budget = cfg.runBudget) => ({ settings: cfg, ports, db: wp.db, budget: { left: budget }, now: NOW });
  return { ...mem, wp, ports, posts, cfg, ctx };
}

describe('planning every selected page', () => {
  it('fills 10 pages x 8 slots with 80 different recipes through Publishing, then plans nothing more', async () => {
    const h = harness();
    const first = await planSource(h.ctx(), source(), auth);
    expect(first).toMatchObject({ planned: 80, failed: 0, uncertain: 0, unfilled: 0, slots: 8, pages: 10 });
    expect(h.posts).toHaveLength(80);
    expect(new Set(h.posts.map(p => p.input.message)).size).toBe(80);
    expect(new Set(h.rows.map(r => r.wpPostId)).size).toBe(80);
    expect(h.rows.every(r => r.state === 'planned' && r.postId)).toBe(true);
    const slotTimes = new Set(h.posts.map(p => p.input.scheduledAt.toISOString()));
    expect(slotTimes.size).toBe(8);
    for (const { actor, input } of h.posts) {
      expect(actor).toEqual(auth.actor);
      expect(input.targetIds).toHaveLength(1);
      expect(input.media).toHaveLength(1);
      expect(input.media[0]!.url).toMatch(/^media:m\d+$/);
      expect(input.firstCommentDelayMinutes).toBe(2);
      expect(input.firstComment).toContain('🧂 Ingrédients :');
      expect(input.firstComment).toContain('https://recettes.newsgeet.com/recette-');
      expect(input.message).toMatch(/^Légende \d+ #cuisine$/);
    }
    // each page has its own recipe per slot, and the first slot of the first pages gets the newest recipes
    expect(h.posts[0]!.input.message).toBe('Légende 5000 #cuisine');
    expect(h.posts[0]!.input.scheduledAt.toISOString()).toBe('2026-10-21T13:00:00.000Z');

    const second = await planSource(h.ctx(), source(), auth);
    expect(second).toMatchObject({ planned: 0, reason: 'complete' });
    expect(h.posts).toHaveLength(80);
  });

  it('downloads the Facebook image of each recipe from the uploads folder and converts before storing', async () => {
    const h = harness({ pages: 1 });
    await planSource(h.ctx(), source(), auth);
    const downloads = vi.mocked(h.ports.image.download).mock.calls.map(c => c[0]);
    expect(downloads[0]).toBe(`${SITE}/wp-content/uploads/2026/10/5000-fb-1.webp`);
    expect(vi.mocked(h.ports.image.convert)).toHaveBeenCalledTimes(8);
    expect(vi.mocked(h.ports.image.store).mock.calls[0]![2]).toBe('recette-5000-fb.jpg');
  });

  it('reads WordPress with the configured mapping, order, age and skip-shared rule', async () => {
    const h = harness({ pages: 1 });
    await planSource(h.ctx(), source({ config: { order: 'oldest', maxAgeDays: 90, skipShared: false, mapping: { postType: 'recipe' } } }), auth);
    expect(h.wp.queries[0]).toMatchObject({ order: 'oldest', maxAgeDays: 90, skipShared: false, afterId: null, mapping: { postType: 'recipe', postStatus: 'publish', captionMetaKey: '_msrwa_facebook_caption' } });
    const h2 = harness({ pages: 1 });
    await planSource(h2.ctx(), source(), auth);
    expect(h2.wp.queries[0]).toMatchObject({ order: 'newest', skipShared: true, mapping: { skipMetaKey: 'fb_shared_at', imageMetaKey: '_msrwa_facebook_generated', recipeMetaKey: '_msrwa_recipe' } });
  });

  it('uses the source slots and time zone', async () => {
    const h = harness({ pages: 2 });
    const out = await planSource(h.ctx(), source({ config: { slots: ['20:00'], timezone: 'America/New_York', horizonDays: 3 } }), auth);
    expect(out.slots).toBe(3);
    expect(h.posts.map(p => p.input.scheduledAt.toISOString().slice(0, 16))).toEqual(['2026-10-22T00:00', '2026-10-22T00:00', '2026-10-23T00:00', '2026-10-23T00:00', '2026-10-24T00:00', '2026-10-24T00:00']);
  });
});

describe('budget and exactly-once behavior', () => {
  it('spends the run budget in time order and continues on the next run without repeats', async () => {
    const h = harness();
    const first = await planSource(h.ctx(30), source(), auth);
    expect(first.planned).toBe(30);
    expect(first.unfilled).toBe(50);
    expect(h.posts[29]!.input.scheduledAt.getTime()).toBeLessThanOrEqual(h.posts[30 - 1]!.input.scheduledAt.getTime());
    const second = await planSource(h.ctx(100), source(), auth);
    expect(second.planned).toBe(50);
    expect(h.posts).toHaveLength(80);
    const keys = h.rows.map(r => `${r.targetId}|${r.slotAt.toISOString()}`);
    expect(new Set(keys).size).toBe(80);
    expect(new Set(h.posts.map(p => p.input.message)).size).toBe(80);
  });

  it('does not plan a slot that another worker claimed or that is already settled', async () => {
    const h = harness({ pages: 1 });
    const first = await planSource(h.ctx(), source(), auth);
    expect(first.planned).toBe(8);
    const create = vi.mocked(h.ports.createPost);
    create.mockClear();
    // a concurrent worker wins the claim between the ledger read and the claim
    const realClaim = h.store.claim;
    h.rows.length = 0;
    h.store.claim = async () => null;
    const raced = await planSource(h.ctx(), source(), auth);
    expect(raced.planned).toBe(0);
    expect(create).not.toHaveBeenCalled();
    h.store.claim = realClaim;
  });

  it('turns a stale unfinished claim into an uncertain slot that is never retried', async () => {
    const h = harness({ pages: 1 });
    await planSource(h.ctx(), source(), auth);
    const row = h.rows[0]!;
    row.state = 'claimed'; row.postId = null; row.claimedAt = new Date(NOW.getTime() - 3_600_000);
    const create = vi.mocked(h.ports.createPost); create.mockClear();
    const again = await planSource(h.ctx(), source(), auth);
    expect(row.state).toBe('uncertain');
    expect(row.reason).toBe('claim_expired');
    expect(again.planned).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves a recent unfinished claim alone', async () => {
    const h = harness({ pages: 1 });
    await planSource(h.ctx(), source(), auth);
    const row = h.rows[0]!; row.state = 'claimed'; row.postId = null; row.claimedAt = new Date(NOW.getTime() - 30_000);
    vi.mocked(h.ports.createPost).mockClear();
    await planSource(h.ctx(), source(), auth);
    expect(row.state).toBe('claimed');
    expect(h.ports.createPost).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('records an unusable image, then retries the slot with a different recipe and never reuses the failed one on that page', async () => {
    const h = harness({ pages: 1 });
    vi.mocked(h.ports.image.download).mockImplementationOnce(async () => { throw new Error('connection refused'); });
    const first = await planSource(h.ctx(), source(), auth);
    expect(first).toMatchObject({ planned: 7, failed: 1 });
    const failed = h.rows.find(r => r.state === 'failed')!;
    expect(failed).toMatchObject({ reason: 'image_unavailable', wpPostId: '5000', skipped: ['5000'] });
    const second = await planSource(h.ctx(), source(), auth);
    expect(second.planned).toBe(1);
    expect(failed.state).toBe('planned');
    expect(failed.wpPostId).not.toBe('5000');
    // the failed recipe now lives only in the slot's skip list, which keeps it away from that page
    expect(h.rows.filter(r => r.wpPostId === '5000')).toHaveLength(0);
    expect(failed.skipped).toEqual(['5000']);
    // a later run (another slot appears as time passes) still never offers the failed recipe to this page
    const later = new Date(NOW.getTime() + 24 * 3_600_000);
    h.ports.now = () => later;
    await planSource({ ...h.ctx(), now: later }, source(), auth);
    expect(h.rows.every(r => r.wpPostId !== '5000')).toBe(true);
  });

  it('stops retrying a slot after the configured number of failed recipes', async () => {
    const h = harness({ pages: 1, settings: { maxSlotAttempts: 2 } });
    vi.mocked(h.ports.createPost).mockImplementation(async () => { throw new OperationError('invalid_request', 'Post text must be between 1 and 5 characters.'); });
    const first = await planSource(h.ctx(), source(), auth);
    expect(first.failed).toBe(8);
    await planSource(h.ctx(), source(), auth);
    await planSource(h.ctx(), source(), auth);
    const states = new Set(h.rows.map(r => `${r.state}:${r.skipped.length}`));
    expect(states).toEqual(new Set(['failed:2']));
    vi.mocked(h.ports.createPost).mockClear();
    const final = await planSource(h.ctx(), source(), auth);
    expect(final.planned + final.failed).toBe(0);
    expect(h.ports.createPost).not.toHaveBeenCalled();
  });

  it('keeps a slot consumed when the Publishing result is unconfirmed', async () => {
    const h = harness({ pages: 1 });
    vi.mocked(h.ports.createPost).mockImplementationOnce(async () => { throw new Error('socket hang up'); });
    const first = await planSource(h.ctx(), source(), auth);
    expect(first).toMatchObject({ planned: 7, uncertain: 1 });
    const uncertain = h.rows.find(r => r.state === 'uncertain')!;
    expect(uncertain.reason).toBe('unconfirmed');
    vi.mocked(h.ports.createPost).mockClear();
    const second = await planSource(h.ctx(), source(), auth);
    expect(second.planned).toBe(0);
    expect(h.ports.createPost).not.toHaveBeenCalled();
    expect(uncertain.state).toBe('uncertain');
  });

  it('stops the source on an authority error without blaming the recipe', async () => {
    const h = harness({ pages: 2 });
    vi.mocked(h.ports.createPost).mockImplementationOnce(async () => { throw new OperationError('forbidden', 'no'); });
    const out = await planSource(h.ctx(), source(), auth);
    expect(out).toMatchObject({ planned: 0, failed: 1, reason: 'forbidden' });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ state: 'failed', skipped: [] });
  });

  it('excludes pages Publishing will not accept and reports when none remain', async () => {
    const h = harness({ pages: 3 });
    vi.mocked(h.ports.validateTarget).mockImplementation(async (_actor, id) => { if (id === 'page2') throw new OperationError('unavailable', 'no'); });
    const out = await planSource(h.ctx(), source(), auth);
    expect(out).toMatchObject({ pages: 2, excludedPages: 1, planned: 16 });
    expect(h.rows.some(r => r.targetId === 'page2')).toBe(false);
    vi.mocked(h.ports.validateTarget).mockRejectedValue(new OperationError('unavailable', 'no'));
    expect(await planSource(h.ctx(), source(), auth)).toMatchObject({ pages: 0, reason: 'no_pages' });
  });

  it('reports unfilled slots when the recipe pool is too small', async () => {
    const h = harness({ pages: 2, rows: 5 });
    const out = await planSource(h.ctx(), source(), auth);
    expect(out.planned).toBe(5);
    expect(out.unfilled).toBe(11);
  });
});

describe('reposting rules', () => {
  it('blocks a recipe on a page within the cooldown but lets other pages use it, and ignores recipes only used before it', async () => {
    const h = harness({ pages: 2, settings: {} });
    const old = (page: string, wp: string, daysAgo: number): LedgerRow => ({ id: `old-${page}-${wp}`, sourceId: 's1', targetId: page, wpPostId: wp, slotAt: new Date(NOW.getTime() - daysAgo * 86_400_000), state: 'planned', postId: 'p', title: '', permalink: null, reason: null, skipped: [], claimedAt: NOW });
    h.rows.push(old('page1', '5000', 10), old('page1', '4999', 400), old('page2', '5000', 400));
    await planSource(h.ctx(), source({ config: { distinctAcrossPages: false, horizonDays: 1 } }), auth);
    const byPage = (page: string) => h.rows.filter(r => r.targetId === page && r.state === 'planned' && r.id.startsWith('plan')).map(r => r.wpPostId);
    expect(byPage('page1')).not.toContain('5000');
    expect(byPage('page1')[0]).toBe('4999');
    expect(byPage('page2')[0]).toBe('5000');
  });

  it('does not repeat recipes already planned in the horizon on other pages when distinct', async () => {
    const h = harness({ pages: 2 });
    await planSource(h.ctx(), source(), auth);
    const perSlot = new Map<number, Set<string>>();
    for (const r of h.rows) { const set = perSlot.get(r.slotAt.getTime()) ?? new Set(); set.add(r.wpPostId); perSlot.set(r.slotAt.getTime(), set); }
    expect([...perSlot.values()].every(s => s.size === 2)).toBe(true);
    expect(new Set(h.rows.map(r => r.wpPostId)).size).toBe(16);
  });
});

describe('automatic runs', () => {
  it('does nothing while the Root switch is off', async () => {
    const h = harness();
    expect(await runRecipePlanning(h.ports, settings({ enabled: false }))).toMatchObject({ reason: 'disabled', sources: 0 });
    expect(h.ports.openDb).not.toHaveBeenCalled();
  });

  it('acts as the qualifying owner, records each source run and closes the database', async () => {
    const h = harness({ pages: 2 });
    const summary = await runRecipePlanning(h.ports, h.cfg);
    expect(summary).toMatchObject({ sources: 1, planned: 16, failed: 0 });
    expect(h.ports.qualify).toHaveBeenCalledWith('w1');
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({ sourceId: 's1', error: null });
    expect(h.runs[0]!.summary).toMatchObject({ planned: 16, slots: 8, pages: 2 });
    expect(h.wp.db.close).toHaveBeenCalledTimes(1);
  });

  it('records an honest error when no owner qualifies or the library is unreachable', async () => {
    const h = harness();
    vi.mocked(h.ports.qualify).mockResolvedValue(null);
    const none = await runRecipePlanning(h.ports, h.cfg);
    expect(none.outcomes[0]).toMatchObject({ reason: 'no_qualifying_owner', planned: 0 });
    expect(h.runs[0]!.error).toMatch(/owner/);
    expect(h.ports.createPost).not.toHaveBeenCalled();

    const h2 = harness();
    h2.ports.databaseUrl = async () => null;
    expect(await runRecipePlanning(h2.ports, h2.cfg)).toMatchObject({ reason: 'database_unavailable' });
    expect(h2.runs[0]!.error).toBe('The recipe library could not be reached.');
    const h3 = harness();
    vi.mocked(h3.ports.openDb).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await runRecipePlanning(h3.ports, h3.cfg)).toMatchObject({ reason: 'database_unavailable' });
  });

  it('shares one budget across sources and keeps going after one source fails', async () => {
    const second = source({ id: 's2', workspaceId: 'w2' });
    const h = harness({ pages: 1, sources: [source(), second], settings: { runBudget: 10 } });
    vi.mocked(h.ports.qualify).mockImplementation(async workspaceId => { if (workspaceId === 'w1') throw new Error('database error'); return auth; });
    const summary = await runRecipePlanning(h.ports, h.cfg);
    expect(summary.outcomes.map(o => o.sourceId)).toEqual(['s1', 's2']);
    expect(summary.outcomes[0]).toMatchObject({ reason: 'error' });
    expect(summary.planned).toBe(8);
    expect(h.runs.find(r => r.sourceId === 's1')!.error).toBe('Planning could not be completed.');
  });
});
