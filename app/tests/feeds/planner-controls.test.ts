// Recipe planning controls (2026-11-15): times per channel, recipes never posted, a time left empty, a chosen recipe.
// The planner runs against an in-memory recipe library, ledger and publishing; nothing reaches WordPress or Facebook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@/server/platforms/registry';
import { planSource, slotKey, LEFT_EMPTY, type PlannerPorts } from '@/modules/feeds/server/wordpress-planner';
import type { WordpressSettings } from '@/modules/feeds/server/wordpress-settings';
import type { LedgerRow, SourceRow, ClaimInput, Settlement } from '@/modules/feeds/server/wordpress-store';
import type { FeedAuthorization } from '@/modules/feeds/server/access';

const now = new Date('2026-11-16T06:00:00Z'); // Monday, 07:00 in Paris
const pages = [{ id: 'pageA', name: 'Page A' }, { id: 'pageB', name: 'Page B' }];
const recipes = Array.from({ length: 30 }, (_, i) => ({
  id: `r${i + 1}`, title: `Recipe ${i + 1}`, slug: `recipe-${i + 1}`, link: `https://site.example/recipe-${i + 1}`, publishedAt: new Date(now.getTime() - i * 3600_000),
  caption: `Caption ${i + 1}`, imageId: `img${i + 1}`, recipe: JSON.stringify({ ingredients: ['flour'], steps: ['bake'] }),
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
function harness(seed: LedgerRow[] = []) {
  const ledger: LedgerRow[] = [...seed];
  const created: Array<{ targetId: string; scheduledAt: Date; message: string; firstComment?: string }> = [];
  const store = {
    async enabledSources() { return []; },
    async pages() { return pages; },
    async ledgerSince() { return ledger; },
    async expireStale() { return 0; },
    async claim(input: ClaimInput) {
      const existing = ledger.find(row => row.targetId === input.targetId && row.slotAt.getTime() === input.slotAt.getTime());
      if (existing && existing.state !== 'failed') return null;
      const row: LedgerRow = { id: `plan${ledger.length + 1}`, sourceId: input.sourceId, targetId: input.targetId, wpPostId: input.wpPostId, slotAt: input.slotAt, state: 'claimed', postId: null, title: input.title, permalink: input.permalink, reason: null, skipped: input.skipped, claimedAt: now };
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
    async createPost(_actor: unknown, input: { targetIds: string[]; scheduledAt: Date; message: string; firstComment?: string }) { created.push({ targetId: input.targetIds[0]!, scheduledAt: input.scheduledAt, message: input.message, firstComment: input.firstComment }); return { id: `post${created.length}` }; },
    async cancelPost() {}, async postForSlot() { return null; },
    image: { async download() { return Buffer.from('x'); }, async inspect() {}, async convert() { return Buffer.from('jpeg'); }, async store() { return { id: 'media1' }; } },
    async qualify() { return null; }, store,
    writer: { async available() { return false; }, async write() { throw new Error('unused'); } },
    now: () => now,
  } as unknown as PlannerPorts;
  const db = {
    async candidates(q: { offset: number; limit: number; order?: string }) { const rows = (q.order === 'oldest' ? [...recipes].reverse() : recipes).slice(q.offset, q.offset + q.limit); return { rows, fetched: rows.length, requested: q.limit }; },
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
  assert.ok(b.every(p => p.firstComment?.startsWith('Page B: ')));
  assert.ok(a.every(p => p.firstComment?.startsWith('Recipe: ')));
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
