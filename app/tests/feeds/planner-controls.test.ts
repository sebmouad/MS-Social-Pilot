// Recipe planning controls (2026-11-15): times per channel, recipes never posted, a time left empty, a chosen recipe.
// The planner runs against an in-memory recipe library, ledger and publishing; nothing reaches WordPress or Facebook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@/server/platforms/registry';
import { planSource, slotKey, supplyLedgerView, LEFT_EMPTY, type PlannerPorts } from '@/modules/feeds/server/wordpress-planner';
import type { WordpressSettings } from '@/modules/feeds/server/wordpress-settings';
import type { LedgerRow, SourceRow, ClaimInput, Settlement } from '@/modules/feeds/server/wordpress-store';
import type { FeedAuthorization } from '@/modules/feeds/server/access';
import { AUTOPILOT_DEFAULTS } from '@/modules/feeds/wordpress/autopilot';
import type { ScoringPorts, Rating, Outcome } from '@/modules/feeds/server/wordpress-scoring';

const now = new Date('2026-11-16T06:00:00Z'); // Monday, 07:00 in Paris
const pages = [{ id: 'pageA', name: 'Page A' }, { id: 'pageB', name: 'Page B' }];
const recipes = Array.from({ length: 30 }, (_, i) => ({
  id: `r${i + 1}`, title: `Recipe ${i + 1}`, slug: `recipe-${i + 1}`, link: `https://site.example/recipe-${i + 1}`, publishedAt: new Date(now.getTime() - i * 3600_000),
  caption: `A tasty caption for recipe number ${i + 1}`, imageId: `img${i + 1}`, recipe: JSON.stringify({ ingredients: ['flour'], steps: ['bake'] }),
}));

function settings(): WordpressSettings {
  return {
    enabled: true, tablePrefix: 'wp_', siteUrl: 'https://site.example', uploadsPath: '/wp-content/uploads', permalinkTemplate: '{site}/{slug}',
    db: { connectTimeoutMs: 1000, queryTimeoutMs: 1000, poolSize: 1 }, candidateBatchSize: 50, candidateMaxScan: 200,
    defaults: {
      mapping: { captionMetaKey: 'fb_caption', imageMetaKey: '', recipeMetaKey: 'recipe', skipMetaKey: '', attachedFileMetaKey: '_wp_attached_file', postType: 'post', postStatus: 'publish' },
      order: 'newest', maxAgeDays: 3650, skipShared: false, slots: ['11:00', '17:00'], timezone: 'Europe/Paris', horizonDays: 1, distinctAcrossPages: true, cooldownDays: 30,
      firstCommentTemplate: 'Recipe: {link}', firstCommentDelayMinutes: 0, weekdays: [0, 1, 2, 3, 4, 5, 6],
    },
    minLeadMinutes: 10, pageStaggerMinutes: 0, targetTypes: ['page'], runBudget: 50, maxSourcesPerRun: 1, claimLeaseSeconds: 600, maxSlotAttempts: 3, previewCount: 5, ledgerPageSize: 50,
    commentMax: 2000, minutesSuffix: 'min', truncationMark: '…', altMax: 100,
    image: { fetch: { timeoutMs: 1000, maxBytes: 1_000_000, maxRedirects: 0, allowHttp: false, hostAllowlist: [] }, maxPixels: 4_000_000, quality: 80, minQuality: 60, qualityStep: 5, maxOutputBytes: 1_000_000 },
    reuse: { enabled: false, cooldownDays: 30 }, poolWarnDays: 7, poolCacheSeconds: 0, pauseCancel: { enabled: true, batchSize: 50 },
    sourceNameMax: 100, textMax: 5000, titleMax: 300, maxTargets: 50, identifierMax: 200, pageNumberMax: 100, transaction: { timeoutMs: 1000, maxWaitMs: 500 },
  };
}

/** In-memory ledger and publishing; returns the ports and what they recorded. */
function harness(seed: LedgerRow[] = [], opts: { list?: typeof recipes; scoring?: ScoringPorts; at?: Date; captions?: (system: string, prompt: string) => Promise<string>; write?: () => Promise<unknown> } = {}) {
  const list = opts.list ?? recipes; const clock = opts.at ?? now;
  const ledger: LedgerRow[] = [...seed];
  const created: Array<{ targetId: string; scheduledAt: Date; message: string; firstComment?: string; delay?: number }> = [];
  const store = {
    async enabledSources() { return []; },
    async pages() { return pages; },
    async ledgerSince() { return ledger; },
    async expireStale() { return 0; },
    async claim(input: ClaimInput) {
      const existing = ledger.find(row => row.targetId === input.targetId && row.slotAt.getTime() === input.slotAt.getTime());
      if (existing && existing.state !== 'failed') return null;
      const row: LedgerRow = { id: `plan${ledger.length + 1}`, sourceId: input.sourceId, targetId: input.targetId, wpPostId: input.wpPostId, slotAt: input.slotAt, state: 'claimed', postId: null, title: input.title, permalink: input.permalink, reason: null, skipped: input.skipped, claimedAt: now, score: input.score ?? null, kind: input.kind ?? null };
      if (existing) ledger.splice(ledger.indexOf(existing), 1);
      ledger.push(row); return row.id;
    },
    async settle(_w: string, id: string, s: Settlement) { const row = ledger.find(r => r.id === id)!; Object.assign(row, { state: s.state, postId: s.postId ?? null, reason: s.reason ?? null }); },
    async recordRun() {}, async unresolved() { return []; }, async plannedUpcoming() { return []; },
    async settleIf() { return true; },
  };
  const ports = {
    async openDb() { throw new Error('unused'); },
    async validateTarget() {},
    async createPost(_actor: unknown, input: { targetIds: string[]; scheduledAt: Date; message: string; firstComment?: string; firstCommentDelayMinutes?: number }) { created.push({ targetId: input.targetIds[0]!, scheduledAt: input.scheduledAt, message: input.message, firstComment: input.firstComment, delay: input.firstCommentDelayMinutes }); return { id: `post${created.length}` }; },
    async cancelPost() {}, async postForSlot() { return null; },
    image: { async download() { return Buffer.from('x'); }, async inspect() {}, async convert() { return Buffer.from('jpeg'); }, async store() { return { id: 'media1' }; } },
    async qualify() { return null; }, store,
    writer: { async available() { return Boolean(opts.captions || opts.write); }, async write() { if (opts.write) return opts.write(); throw new Error('unused'); } },
    now: () => clock,
    ...(opts.scoring ? { scoring: opts.scoring } : {}),
    ...(opts.captions ? { captions: { write: (_actor: unknown, system: string, prompt: string) => opts.captions!(system, prompt) } } : {}),
  } as unknown as PlannerPorts;
  const db = {
    async candidates(q: { offset: number; limit: number; order?: string; include?: readonly string[] }) { const rows = (q.include ? list.filter(r => q.include!.includes(r.id)) : q.order === 'oldest' ? [...list].reverse() : list).slice(q.offset, q.offset + q.limit); return { rows, fetched: rows.length, requested: q.limit }; },
    async attachments(ids: readonly string[]) { return new Map(ids.map(id => [id, `2026/11/${id}.jpg`])); },
    async ping() {}, async close() {},
  };
  return { ledger, created, ports, db };
}

const source = (config: Record<string, unknown> = {}): SourceRow => ({ id: 'src1', workspaceId: 'ws1', name: 'Recipes', siteUrl: 'https://site.example', apiCredential: null, enabled: true, allTargets: true, targetIds: [], config, lastRunAt: null, lastError: null, lastSummary: null, createdAt: now, updatedAt: now } as unknown as SourceRow);
const auth = { actor: { userId: 'u1', workspaceId: 'ws1' } } as unknown as FeedAuthorization;
const paris = (d: Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(d);

test('planner: a channel with its own times posts at those times, the others at the shared times', async () => {
  const h = harness();
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source({ channelSlots: { pageB: ['09:30'] } }), auth);
  const timesA = [...new Set(h.created.filter(p => p.targetId === 'pageA').map(p => paris(p.scheduledAt)))].sort();
  const timesB = [...new Set(h.created.filter(p => p.targetId === 'pageB').map(p => paris(p.scheduledAt)))].sort();
  assert.deepEqual(timesA, ['11:00', '17:00']);
  assert.deepEqual(timesB, ['09:30']);
});

test('planner: an excluded recipe is never planned', async () => {
  const h = harness();
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source({ excluded: [{ id: 'r1', title: 'Recipe 1' }, { id: 'r2', title: 'Recipe 2' }] }), auth);
  assert.ok(h.created.length > 0);
  assert.ok(!h.ledger.some(row => row.wpPostId === 'r1' || row.wpPostId === 'r2'));
});

test('planner: a time left empty is not filled, not even by a retry', async () => {
  const first = harness();
  await planSource({ settings: settings(), ports: first.ports, db: first.db as never, budget: { left: 50 }, now }, source(), auth);
  const slot = first.ledger.find(row => row.targetId === 'pageA')!;
  const emptied: LedgerRow = { ...slot, state: 'failed', postId: null, reason: LEFT_EMPTY };
  const h = harness([emptied]);
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now, retry: new Set([slotKey(slot.targetId, slot.slotAt)]) }, source(), auth);
  assert.equal(h.created.length, 0);
  assert.equal(h.ledger.find(row => row.id === emptied.id)?.reason, LEFT_EMPTY);
});

test('planner: a chosen recipe is used for its time, even when it was planned elsewhere recently', async () => {
  const first = harness();
  await planSource({ settings: settings(), ports: first.ports, db: first.db as never, budget: { left: 50 }, now }, source(), auth);
  const slot = first.ledger.find(row => row.targetId === 'pageA')!;
  const taken = first.ledger.find(row => row.targetId === 'pageB')!.wpPostId; // already used on the other page
  const h = harness([...first.ledger.filter(row => row.id !== slot.id), { ...slot, state: 'failed', postId: null, reason: 'replaced' }]);
  const key = slotKey(slot.targetId, slot.slotAt);
  const out = await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now, retry: new Set([key]), force: new Map([[key, taken]]) }, source(), auth);
  assert.equal(out.planned, 1);
  const row = h.ledger.find(r => r.targetId === slot.targetId && r.slotAt.getTime() === slot.slotAt.getTime())!;
  assert.equal(row.wpPostId, taken);
});

test('planner: a paused channel gets nothing, the others are planned as usual', async () => {
  const h = harness();
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source({ channels: { pageB: { paused: true } } }), auth);
  assert.ok(h.created.some(p => p.targetId === 'pageA'));
  assert.ok(!h.created.some(p => p.targetId === 'pageB'));
});

test('planner: each channel uses its own times, recipe order and first comment, and recipes stay different across channels', async () => {
  const h = harness();
  const config = { channels: { pageB: { slots: ['08:15'], order: 'oldest', firstCommentTemplate: 'Page B: {link}' } } };
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source(config), auth);
  const a = h.created.filter(p => p.targetId === 'pageA'); const b = h.created.filter(p => p.targetId === 'pageB');
  assert.deepEqual([...new Set(b.map(p => paris(p.scheduledAt)))], ['08:15']);
  assert.deepEqual([...new Set(a.map(p => paris(p.scheduledAt)))].sort(), ['11:00', '17:00']);
  const recipeOf = (targetId: string) => h.ledger.filter(row => row.targetId === targetId).map(row => row.wpPostId);
  assert.ok(recipeOf('pageB').every(id => Number(id.slice(1)) > 25), 'oldest first on page B');
  assert.ok(recipeOf('pageA').every(id => Number(id.slice(1)) <= 5), 'newest first on page A');
  assert.ok(b.every(p => p.firstComment?.includes('Page B: ') && !p.firstComment.includes('Recipe: ')));
  assert.ok(a.every(p => p.firstComment?.includes('Recipe: ')));
  assert.ok([...a, ...b].every(p => /^(📌|👥|💬|❤️)/u.test(p.firstComment ?? '')), 'a call to action opens each first comment');
  assert.equal(new Set([...recipeOf('pageA'), ...recipeOf('pageB')]).size, a.length + b.length);
});

test('planner: new times never double a day that is already planned', async () => {
  const first = harness();
  await planSource({ settings: settings(), ports: first.ports, db: first.db as never, budget: { left: 50 }, now }, source(), auth);
  const before = first.created.filter(p => p.targetId === 'pageA').length;
  // Times move (a member or the autopilot): 11:00/17:00 become 11:30/17:30 on page A.
  const h = harness([...first.ledger]);
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source({ channels: { pageA: { slots: ['11:30', '17:30'] } } }), auth);
  assert.equal(h.created.filter(p => p.targetId === 'pageA').length, 0, 'the planned day keeps its posts and gets no extra ones');
  assert.ok(before > 0);
});

test('planner: a post that failed to publish is replaced by another recipe, published shortly', async () => {
  const first = harness();
  await planSource({ settings: settings(), ports: first.ports, db: first.db as never, budget: { left: 50 }, now }, source(), auth);
  const slot = first.ledger.find(row => row.targetId === 'pageA')!;
  const failed = { ...slot, state: 'failed' as const, postId: null, reason: 'publish_failed', skipped: [slot.wpPostId] };
  const h = harness([...first.ledger.filter(row => row.id !== slot.id), failed]);
  const key = slotKey(slot.targetId, slot.slotAt); const soon = new Date(now.getTime() + 12 * 60_000);
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now, makeup: new Map([[key, soon]]) }, source(), auth);
  const replaced = h.ledger.find(row => row.targetId === slot.targetId && row.slotAt.getTime() === slot.slotAt.getTime())!;
  assert.notEqual(replaced.wpPostId, slot.wpPostId);
  assert.ok(h.created.some(p => p.targetId === 'pageA' && p.scheduledAt.getTime() === soon.getTime()));
});

const fakeScoring = (ratings: Record<string, Rating> = {}, outcomes: Outcome[] = []): ScoringPorts => ({
  async ratings(_s, ids) { return new Map(ids.filter(id => ratings[id]).map(id => [id, ratings[id]!])); },
  async rate() {}, async ratePhotos() {},
  async outcomes() { return outcomes; },
  async weather() { return new Map(); },
});
const titled = (titles: string[]) => titles.map((title, i) => ({ ...recipes[i]!, id: `t${i + 1}`, title, slug: `t-${i + 1}`, link: `https://site.example/t-${i + 1}` }));

test('autopilot: the recipe that fits the moment wins its slot, even far down the list', async () => {
  const december = new Date('2026-12-14T06:00:00Z');
  const list = titled([...Array.from({ length: 20 }, (_, i) => `Plat ordinaire ${i + 1}`), 'Bûche de Noël au chocolat']);
  const h = harness([], { list, scoring: fakeScoring(), at: december });
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now: december }, source({ autopilot: undefined }), auth);
  assert.ok(h.ledger.some(row => row.wpPostId === 't21'), 'the Christmas log is planned');
  const buche = h.ledger.find(row => row.wpPostId === 't21')!;
  assert.ok((buche.score ?? 0) > 50);
});

test('autopilot: never three desserts in a row on a channel', async () => {
  const list = titled(['Tarte tatin', 'Cookies géants', 'Brownie fondant', 'Mousse au chocolat', 'Quiche lorraine', 'Gratin dauphinois', 'Clafoutis cerises', 'Poulet rôti']);
  const ratings = Object.fromEntries(list.map(r => [r.id, { kind: null, hook: r.title.match(/Tarte|Cookies|Brownie|Mousse|Clafoutis/) ? 10 : 2, photo: null }]));
  const h = harness([], { list, scoring: fakeScoring(ratings) });
  const s2 = settings(); s2.defaults.slots = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00']; s2.defaults.distinctAcrossPages = true;
  await planSource({ settings: s2, ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source({ channels: { pageB: { paused: true } } }), auth);
  const kinds = h.ledger.filter(row => row.targetId === 'pageA').sort((a, b) => a.slotAt.getTime() - b.slotAt.getTime()).map(row => row.kind);
  for (let i = 2; i < kinds.length; i++) assert.ok(!(kinds[i] === 'dessert' && kinds[i - 1] === 'dessert' && kinds[i - 2] === 'dessert'), kinds.join());
});

test('autopilot: past winners come back after the cooldown, within their share', async () => {
  const old = new Date(now.getTime() - 90 * 86_400_000);
  const seed: LedgerRow[] = ['r29', 'r30'].map((id, i) => ({ id: `old${i}`, sourceId: 'src1', targetId: 'pageA', wpPostId: id, slotAt: old, state: 'planned', postId: `p${i}`, title: `Recipe ${id.slice(1)}`, permalink: null, reason: null, skipped: [], claimedAt: old }));
  const outcomes: Outcome[] = [{ targetId: 'pageA', wpPostId: 'r29', title: 'Recipe 29', slotAt: old, relative: 4 }, ...Array.from({ length: 9 }, (_, i) => ({ targetId: 'pageA', wpPostId: `x${i}`, title: `Other ${i}`, slotAt: old, relative: 1 }))];
  const h = harness(seed, { scoring: fakeScoring({}, outcomes) });
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source(), auth);
  const fresh = h.ledger.filter(row => row.claimedAt === now);
  const back = fresh.filter(row => row.wpPostId === 'r29');
  assert.ok(back.length <= Math.floor(fresh.length * 0.2), `winners ${back.length} of ${fresh.length}`);
});

test('autopilot: every channel gets its own AI caption in its voice, and the comment waits 2 minutes', async () => {
  const prompts: string[] = [];
  const h = harness([], { captions: async (system, prompt) => { prompts.push(system); const page = /« (.*?) »/.exec(system)?.[1]; return `Envie de ${prompt.split('\n')[0]!.slice(8)} ? ${page} 😋 Et vous, vous la faites comment ?`; } });
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source(), auth);
  assert.ok(h.created.length > 0);
  assert.ok(h.created.every(p => p.message.startsWith('Envie de')), 'AI captions are used');
  assert.ok(h.created.filter(p => p.targetId === 'pageA').every(p => p.message.includes('Page A')));
  assert.ok(h.created.every(p => p.delay === 2));
  assert.ok(new Set(prompts.map(p => /Voice: (.*)/.exec(p)?.[1])).size >= 2, 'the two channels have different voices');
});

test('autopilot: when AI refuses, the recipe keeps its own caption', async () => {
  const h = harness([], { captions: async () => { throw new Error('hourly limit'); } });
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source(), auth);
  assert.ok(h.created.length > 0 && h.created.every(p => p.message.startsWith('A tasty caption')));
});

test('planner: the AI limit stops the run at the first refusal; the other slots stay open for the next run', async () => {
  const { OperationError } = await import('@/lib/operation-error');
  let calls = 0;
  const list = recipes.map(r => ({ ...r, caption: '', article: `Article text for ${r.title}` }));
  const h = harness([], { list, write: async () => { calls++; throw new OperationError('conflict', 'This workspace has reached its hourly AI assist limit. Try again later.'); } });
  const out = await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source(), auth);
  assert.equal(calls, 1);
  assert.equal(out.reason, 'ai_limit');
  assert.equal(out.failed, 1);
  assert.ok(out.unfilled > 0);
  assert.equal(h.created.length, 0);
  assert.deepEqual(h.ledger.map(row => `${row.state}:${row.reason}`), ['failed:writing:conflict']);
});

test('planner: a placeholder caption (« p3 ») is never posted', async () => {
  const list = titled(['Muffins salés au jambon et au fromage', 'Quiche lorraine', 'Gratin dauphinois']).map((r, i) => i === 0 ? { ...r, caption: 'p3' } : r);
  const h = harness([], { list });
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source(), auth);
  assert.ok(h.created.length > 0);
  assert.ok(h.created.every(p => p.message !== 'p3'));
  assert.ok(!h.ledger.some(row => row.wpPostId === 't1'), 'without AI to write it, the recipe is skipped');
});

test('autopilot: a channel at its learned times publishes exactly then, without the old offset between Pages', async () => {
  const h = harness();
  const s2 = settings(); s2.pageStaggerMinutes = 9;
  const pilot = { ...AUTOPILOT_DEFAULTS, learnedTimes: { pageB: ['11:05', '17:05'] } };
  await planSource({ settings: s2, ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source({ autopilot: pilot }), auth);
  const b = h.created.filter(p => p.targetId === 'pageB').map(p => paris(p.scheduledAt));
  assert.deepEqual([...new Set(b)].sort(), ['11:05', '17:05']);
});

test('autopilot: each caption is told the openings already written, so channels never open alike', async () => {
  const systems: string[] = [];
  let n = 0;
  const h = harness([], { captions: async system => { systems.push(system); n++; return `Ouverture numéro ${n} pour cette belle recette 😋\nEt vous ?`; } });
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now }, source(), auth);
  assert.ok(systems.length >= 2);
  assert.doesNotMatch(systems[0]!, /recent openings/);
  assert.match(systems[1]!, /Ouverture numéro 1/);
});

test('planner: « Another recipe » on a slot from older times is planned at that time, not left empty', async () => {
  const first = harness();
  await planSource({ settings: settings(), ports: first.ports, db: first.db as never, budget: { left: 50 }, now }, source(), auth);
  const slot = first.ledger.find(row => row.targetId === 'pageA')!;
  const h = harness([...first.ledger.filter(row => row.id !== slot.id), { ...slot, state: 'failed', postId: null, reason: 'replaced', skipped: [slot.wpPostId] }]);
  // The channel's times changed since: its learned times no longer include this slot.
  const changed = source({ autopilot: { ...AUTOPILOT_DEFAULTS, learnedTimes: { pageA: ['09:05', '19:05'] } } });
  const out = await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now, retry: new Set([slotKey(slot.targetId, slot.slotAt)]) }, changed, auth);
  assert.equal(out.planned, 1);
  assert.ok(h.created.some(p => p.targetId === 'pageA' && p.scheduledAt.getTime() === slot.slotAt.getTime()));
});

test('planner: a chosen recipe beyond the scan is read by its id, so its slot is never left empty', async () => {
  const first = harness();
  await planSource({ settings: settings(), ports: first.ports, db: first.db as never, budget: { left: 50 }, now }, source(), auth);
  const slot = first.ledger.find(row => row.targetId === 'pageA')!;
  const h = harness([...first.ledger.filter(row => row.id !== slot.id), { ...slot, state: 'failed', postId: null, reason: 'replaced' }]);
  const s2 = settings(); s2.candidateMaxScan = 5; s2.candidateBatchSize = 5; // the scan stops well before recipe 30
  const key = slotKey(slot.targetId, slot.slotAt);
  const out = await planSource({ settings: s2, ports: h.ports, db: h.db as never, budget: { left: 50 }, now, retry: new Set([key]), force: new Map([[key, 'r30']]) }, source(), auth);
  assert.equal(out.planned, 1);
  assert.equal(h.ledger.find(r => r.targetId === slot.targetId && r.slotAt.getTime() === slot.slotAt.getTime())?.wpPostId, 'r30');
});

test('planner: a freed slot at a time the channel no longer uses is revived at the make-up time (2026-11-17)', async () => {
  const oldTime = new Date('2026-11-16T14:00:00Z'); // 15:00 in Paris; the channel now posts at 11:00 and 17:00
  const freed: LedgerRow = { id: 'freed', sourceId: 'src1', targetId: 'pageA', wpPostId: 'r29', slotAt: oldTime, state: 'failed', postId: null, title: 'Recipe 29', permalink: null, reason: 'not_created', skipped: [], claimedAt: new Date(now.getTime() - 7200_000) };
  const h = harness([freed]);
  const soon = new Date(now.getTime() + 20 * 60_000);
  await planSource({ settings: settings(), ports: h.ports, db: h.db as never, budget: { left: 50 }, now, makeup: new Map([[slotKey('pageA', oldTime), soon]]) }, source(), auth);
  const row = h.ledger.find(r => r.targetId === 'pageA' && r.slotAt.getTime() === oldTime.getTime())!;
  assert.equal(row.state, 'planned');
  assert.ok(h.created.some(p => p.targetId === 'pageA' && p.scheduledAt.getTime() === soon.getTime()));
});

test('planner: a recipe the Page already got from another tool is kept off (all Pages when recipes are distinct)', async () => {
  const store = { async pages() { return pages; }, async ledgerSince() { return []; },
    async outsideTitles() { return [{ targetId: 'pageA', title: 'Recipe 3' }, { targetId: 'pageA', title: '' }]; } };
  const ports = { store } as unknown as PlannerPorts;
  const distinct = await supplyLedgerView(settings(), ports, source(), now);
  assert.ok(distinct.blocked.get('pageA')?.has('title:recipe 3'));
  assert.ok(distinct.blocked.get('pageB')?.has('title:recipe 3'));
  assert.ok(!distinct.blocked.get('pageA')?.has('title:'));
  const own = await supplyLedgerView(settings(), ports, source({ distinctAcrossPages: false }), now);
  assert.ok(own.blocked.get('pageA')?.has('title:recipe 3'));
  assert.ok(!own.blocked.get('pageB')?.has('title:recipe 3'));
});
