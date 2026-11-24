// Recipe autopilot (2026-11-16): best times learned per channel from its own results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnTimes, hourStats, postScore, autopilotOf, AUTOPILOT_DEFAULTS } from '@/modules/feeds/wordpress/autopilot';

const tz = 'Europe/Paris';
// A Paris wall time on a November day (UTC+1).
const at = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour - 1, 0));
function history(scores: Record<number, number[]>) {
  return Object.entries(scores).flatMap(([hour, values]) => values.map((score, i) => ({ at: at(2 + i, Number(hour)), score })));
}

test('best times: the strongest hours win, at least the gap apart, on the channel\'s 5-minute mark', () => {
  const observations = history({ 11: [100, 110, 90], 15: [400, 380, 420], 17: [100, 95, 105], 20: [300, 320, 310] });
  const times = learnTimes({ observations, current: ['11:00', '15:00', '17:00', '20:00'], timeZone: tz, window: [6, 23], gapMinutes: 60, channelIndex: 3 });
  assert.equal(times.length, 4);
  assert.ok(times.includes('15:15') && times.includes('20:15'), times.join());
  assert.ok(times.every(t => t.endsWith(':15')));
  const hours = times.map(t => Number(t.slice(0, 2)));
  assert.ok(hours.every((h, i) => i === 0 || h - hours[i - 1]! >= 1));
});

test('best times: a proven hour above usual is never traded for an untried one', () => {
  const observations = history({ 11: [100, 100, 100], 15: [100, 100, 100], 17: [100, 100, 100], 20: [100, 100, 100] });
  const times = learnTimes({ observations, current: ['11:00', '15:00', '17:00', '20:00'], timeZone: tz, window: [6, 23], gapMinutes: 60, channelIndex: 0 });
  assert.deepEqual(times, ['11:00', '15:00', '17:00', '20:00']);
});

test('best times: a weak hour is swapped for the untried hour other Pages found strong, never an early-morning guess', () => {
  const observations = history({ 11: [300, 300, 300], 15: [40, 50, 45], 17: [300, 300, 300], 20: [300, 300, 300] });
  const pooled = new Map([[19, [2.5, 2.2, 2.8, 2.4]]]);
  const times = learnTimes({ observations, current: ['11:00', '15:00', '17:00', '20:00'], timeZone: tz, window: [6, 23], gapMinutes: 60, channelIndex: 0, pooled });
  assert.deepEqual(times, ['11:00', '17:00', '19:00', '20:00']);
  const blind = learnTimes({ observations, current: ['11:00', '15:00', '17:00', '20:00'], timeZone: tz, window: [6, 23], gapMinutes: 60, channelIndex: 0 });
  assert.ok(blind.every(t => Number(t.slice(0, 2)) >= 9), blind.join());
});

test('best times: too little history keeps the current times', () => {
  const times = learnTimes({ observations: history({ 15: [500, 500] }), current: ['11:00', '17:00'], timeZone: tz, window: [6, 23], gapMinutes: 60, channelIndex: 0 });
  assert.deepEqual(times, ['11:00', '17:00']);
});

test('best times: hours outside the window are never chosen', () => {
  const observations = history({ 3: [900, 900, 900], 11: [100, 100, 100], 15: [100, 100, 100], 20: [100, 100, 100] });
  const times = learnTimes({ observations, current: ['11:00', '15:00'], timeZone: tz, window: [6, 23], gapMinutes: 60, channelIndex: 0 });
  assert.ok(times.every(t => Number(t.slice(0, 2)) >= 6));
  assert.ok(!hourStats(observations, tz, [6, 23]).some(s => s.hour === 3));
});

test('post score: reach plus weighted engagement; nothing stored scores nothing', () => {
  assert.equal(postScore({ post_total_media_view_unique: 1000, post_reactions_by_type_total: { like: 10, love: 5 }, comments: 3, shares: 2 }), 1000 + 20 * 10);
  assert.equal(postScore({}), null);
  assert.equal(postScore(null), null);
});

test('autopilot settings: the approved choices are the defaults, and bad stored values fall back to them', () => {
  assert.deepEqual(autopilotOf(undefined), AUTOPILOT_DEFAULTS);
  assert.deepEqual(autopilotOf({ bestTimes: { enabled: 'yes' } }), AUTOPILOT_DEFAULTS);
  assert.equal(AUTOPILOT_DEFAULTS.bestTimes.apply, 'auto');
  assert.equal(AUTOPILOT_DEFAULTS.bestTimes.gapMinutes, 60);
});

test('learned times: a channel posts at its learned times, its own times win, and switching best times off returns the shared ones', async () => {
  const { channelConfig } = await import('@/modules/feeds/wordpress/recipe');
  const base = { slots: ['11:00', '17:00'], autopilot: { ...AUTOPILOT_DEFAULTS, learnedTimes: { a: ['12:05', '18:05'] } } } as unknown as Parameters<typeof channelConfig>[0];
  assert.deepEqual(channelConfig(base, 'a').slots, ['12:05', '18:05']);
  assert.deepEqual(channelConfig(base, 'b').slots, ['11:00', '17:00']);
  assert.deepEqual(channelConfig({ ...base, channels: { a: { slots: ['09:00'] } } } as typeof base, 'a').slots, ['09:00']);
  const off = { ...base, autopilot: { ...AUTOPILOT_DEFAULTS, bestTimes: { ...AUTOPILOT_DEFAULTS.bestTimes, enabled: false }, learnedTimes: { a: ['12:05'] } } } as typeof base;
  assert.deepEqual(channelConfig(off, 'a').slots, ['11:00', '17:00']);
});

test('settings: one bad field never discards the rest of the saved configuration', async () => {
  const { resolveConfig } = await import('@/modules/feeds/wordpress/recipe');
  const limits = { template: 5000, horizon: { min: 1, max: 14 }, cooldown: { min: 0, max: 3650 }, age: { min: 0, max: 36500 }, delay: { min: 0, max: 1440 } };
  const defaults = { mapping: { captionMetaKey: '', imageMetaKey: '', recipeMetaKey: '', skipMetaKey: '', attachedFileMetaKey: '_wp_attached_file', postType: 'post', postStatus: 'publish' }, order: 'newest', maxAgeDays: 0, skipShared: false, slots: ['07:00'], timezone: 'Europe/Paris', horizonDays: 2, distinctAcrossPages: true, cooldownDays: 30, firstCommentTemplate: 'x', firstCommentDelayMinutes: 0 } as Parameters<typeof resolveConfig>[0];
  const stored = { slots: ['11:00', '20:00'], excluded: [{ id: '5', title: 'Five' }], channels: { a: { paused: true } },
    autopilot: { ...AUTOPILOT_DEFAULTS, hourValues: { a: { '12': -5 } }, log: [{ at: '2026-11-16T01:45:00.000Z', kind: 'times', channelName: 'A', from: ['11:00'], to: ['11:05'] }, { kind: 'bogus' }], learnedTimes: { a: ['11:05'] } },
    bogus: true };
  const config = resolveConfig(defaults, stored, limits);
  assert.deepEqual(config.slots, ['11:00', '20:00']);
  assert.deepEqual(config.excluded, [{ id: '5', title: 'Five' }]);
  assert.equal(config.channels?.a?.paused, true);
  const pilot = autopilotOf(config.autopilot);
  assert.equal(pilot.log?.length, 1);
  assert.deepEqual(pilot.learnedTimes, { a: ['11:05'] });
  assert.equal(pilot.hourValues, undefined);
});

test('self-healing: an interrupted run’s slot is reconciled when its post exists, released when it provably does not, left alone while young', async () => {
  const { healStranded } = await import('@/modules/feeds/server/wordpress-autopilot');
  const now = new Date('2026-11-16T12:00:00Z');
  const slot = (id: string, claimedMinutesAgo: number) => ({ id, workspaceId: 'w', targetId: 't', slotAt: new Date('2026-11-16T14:00:00Z'), claimedAt: new Date(now.getTime() - claimedMinutesAgo * 60_000), title: `Recipe ${id}`, permalink: `https://site.example/${id}` });
  const settled: Array<[string, unknown]> = [];
  const ports = {
    async observations() { return []; }, async saveConfig() {}, async failedPublications() { return []; },
    async stranded() { return [slot('found', 180), slot('absent', 180), slot('young', 10)]; },
    async createdFor(s: { permalink: string | null }) { return s.permalink?.endsWith('found') ? 'post1' : null; },
    async settleStranded(_w: string, id: string, outcome: unknown) { settled.push([id, outcome]); return true; },
  };
  const out = await healStranded('src', now, ports);
  assert.deepEqual(settled, [['found', { postId: 'post1' }], ['absent', { released: true }]]);
  assert.equal(out.reconciled, 1); assert.equal(out.released, 1); assert.deepEqual(out.titles, ['Recipe absent']);
});

// Freed slots on a short day (2026-11-17): Paris times, the channel posts at 11:30, 15:30, 17:30, 20:30.
test('refill: a freed old-time slot is refilled only when the day would run short, at the next free time', async () => {
  const { shortDayRefills } = await import('@/modules/feeds/server/wordpress-autopilot');
  const row = (id: string, paris: string, state: 'planned' | 'failed', reason: string | null = null) => ({ id, sourceId: 's', targetId: 'c1', wpPostId: id, slotAt: new Date(`2026-11-16T${paris}:00+01:00`), state, postId: state === 'planned' ? `p-${id}` : null, title: `T ${id}`, permalink: null, reason, skipped: [], claimedAt: new Date('2026-11-16T05:00:00Z') });
  const base = { timezone: 'Europe/Paris', minLeadMinutes: 5, gapMinutes: 60, window: [6, 23] as const, maxAttempts: 5, timesFor: () => ({ slots: ['11:30', '15:30', '17:30', '20:30'], paused: false }) };
  const freed = row('f', '15:00', 'failed', 'not_created');

  // 14:00 in Paris: 15:30, 17:30 and 20:30 are still to be planned by this run, so the day is full: no refill (16 Nov).
  assert.deepEqual(shortDayRefills({ ...base, now: new Date('2026-11-16T13:00:00Z'), rows: [row('a', '11:30', 'planned'), freed] }), []);

  // 15:40: 15:30 has passed unfilled, the day would end with three posts: the freed slot goes out at 15:50.
  const late = { ...base, now: new Date('2026-11-16T14:40:00Z'), rows: [row('a', '11:30', 'planned'), freed, row('c', '17:30', 'planned'), row('d', '20:30', 'planned')] };
  const out = shortDayRefills(late);
  assert.equal(out.length, 1); assert.equal(out[0]!.row.id, 'f'); assert.equal(out[0]!.at.toISOString(), '2026-11-16T14:50:00.000Z');

  // Its next free time keeps the gap: posts at 11:30, 16:15 and 20:30 (17:30 failed): 15:50 is too close to 16:15, so 17:15.
  const tight = shortDayRefills({ ...late, rows: [row('a', '11:30', 'planned'), freed, row('b', '16:15', 'planned'), row('c', '17:30', 'failed', 'publish_failed'), row('d', '20:30', 'planned')] });
  assert.equal(tight.length, 1); assert.equal(tight[0]!.at.toISOString(), '2026-11-16T16:15:00.000Z');
  // A paused channel, a day already over, a time left empty on purpose: left alone.
  assert.deepEqual(shortDayRefills({ ...late, timesFor: () => ({ slots: ['11:30', '15:30', '17:30', '20:30'], paused: true }) }), []);
  assert.deepEqual(shortDayRefills({ ...late, now: new Date('2026-11-17T09:00:00Z') }), []);
  assert.deepEqual(shortDayRefills({ ...late, rows: [...late.rows, row('e', '15:30', 'failed', 'left_empty')] }), []);
  // Two freed slots when one post is missing (17:30 still to come): only one is refilled, the day never gets a fifth post.
  const one = shortDayRefills({ ...late, rows: [row('a', '11:30', 'planned'), freed, row('g', '15:10', 'failed', 'not_created'), row('d', '20:30', 'planned')] });
  assert.equal(one.length, 1);
  // Two posts missing (17:30 failed too): both are refilled, an hour apart: 15:50 and 16:50.
  const two = shortDayRefills({ ...late, rows: [row('a', '11:30', 'planned'), freed, row('g', '15:10', 'failed', 'not_created'), row('c', '17:30', 'failed', 'publish_failed'), row('d', '20:30', 'planned')] });
  assert.deepEqual(two.map(item => item.at.toISOString()), ['2026-11-16T14:50:00.000Z', '2026-11-16T15:50:00.000Z']);
});

// What works on each Page (2026-11-18): the score learns from each channel's own posts.
test('page learning: each channel learns what works on it, borrows from the others when thin, recent counts more', async () => {
  const { pageLearning } = await import('@/modules/feeds/server/wordpress-scoring');
  const now = new Date('2026-11-18T12:00:00Z');
  const o = (targetId: string, title: string, relative: number, daysAgo = 1) => ({ targetId, wpPostId: `${targetId}-${title}-${daysAgo}`, title, relative, slotAt: new Date(now.getTime() - daysAgo * 86_400_000) });
  const outcomes = [
    ...Array.from({ length: 6 }, (_, i) => o('A', `Gratin de pâtes ${i}`, 3, i + 1)),
    ...Array.from({ length: 6 }, (_, i) => o('B', `Gratin de pâtes ${i}`, 0.4, i + 1)),
    o('A', 'Terrine de poisson', 0.3), o('B', 'Terrine de poisson', 0.3),
  ];
  const learn = pageLearning(outcomes, now);
  const onA = learn('A', 'Gratin dauphinois')!, onB = learn('B', 'Gratin dauphinois')!, onC = learn('C', 'Gratin dauphinois')!;
  assert.ok(onA > 1.5, `gratins work on A (${onA})`);
  assert.ok(onB < 0.8, `gratins do not on B (${onB})`);
  assert.ok(onC > onB && onC < onA, 'a channel without gratins borrows what the others learned');
  assert.equal(learn('A', 'Cocktail exotique'), null, 'nothing known: no opinion');
  // A single viral post is capped, and old results fade.
  const viral = pageLearning([o('A', 'Crêpes', 1432)], now)('A', 'Crêpes')!;
  assert.ok(viral < 20, `one viral post does not dominate (${viral})`);
  const old = pageLearning([o('A', 'Quiche', 3, 120)], now)('A', 'Quiche')!, fresh = pageLearning([o('A', 'Quiche', 3, 1)], now)('A', 'Quiche')!;
  assert.ok(fresh > old, 'recent results count more');
});

test('page learning: the picker ranks a recipe for the channel it would go to', async () => {
  const { makePicker } = await import('@/modules/feeds/server/wordpress-pick');
  const { AUTOPILOT_DEFAULTS } = await import('@/modules/feeds/wordpress/autopilot');
  const candidates = [{ wpPostId: 'g', title: 'Gratin de pâtes' }, { wpPostId: 't', title: 'Terrine de poisson' }];
  const history = (targetId: string | null, title: string) => title.startsWith('Gratin') ? (targetId === 'A' ? 3 : 0.4) : (targetId === 'A' ? 0.4 : 3);
  const picker = makePicker({ pilot: { ...AUTOPILOT_DEFAULTS, moments: { ...AUTOPILOT_DEFAULTS.moments, rules: [] } }, timeZone: 'Europe/Paris', ratings: new Map(), history, weather: new Map(), timeline: new Map(), winners: new Set(), winnerQuota: 0, candidates });
  const at = new Date('2026-11-19T10:00:00Z');
  assert.equal(picker.rank({ targetId: 'A', slotAt: at }, candidates)[0]!.wpPostId, 'g');
  assert.equal(picker.rank({ targetId: 'B', slotAt: at }, candidates)[0]!.wpPostId, 't');
});


// The autopilot's memory of each Page (2026-11-18): content, time and caption, from reach, reactions, comments, shares.
test('memory: each Page learns from its settled posts, keeps it, and lets older lessons fade', async () => {
  const { absorb, memoryModel } = await import('@/modules/feeds/wordpress/memory');
  const tz = 'Europe/Paris'; const now = new Date('2026-11-18T12:00:00Z');
  const post = (title: string, daysAgo: number, reach: number, extra: Partial<{ comments: number; shares: number; caption: string; style: string; hour: number }> = {}) =>
    ({ at: new Date(Date.UTC(2026, 10, 18 - daysAgo, (extra.hour ?? 18) - 1, 0)), title, kind: null, style: extra.style ?? null, caption: extra.caption ?? 'Une recette.', reach, reactions: reach / 20, comments: extra.comments ?? 1, shares: extra.shares ?? 1 });
  const a = absorb(null, [
    ...Array.from({ length: 6 }, (_, i) => post(`Gratin de pâtes ${i}`, i + 1, 3000, { shares: 40, comments: 20, caption: 'Qui en veut ? Un gratin doré.', style: 'question' })),
    ...Array.from({ length: 6 }, (_, i) => post(`Terrine de poisson ${i}`, i + 8, 300, { caption: 'Une terrine.', style: 'story' })),
  ], now, tz);
  const b = absorb(null, Array.from({ length: 6 }, (_, i) => post(`Gratin de pâtes ${i}`, i + 1, 200)), now, tz);
  assert.equal(a.posts, 12);
  const model = memoryModel(new Map([['A', a], ['B', b]]));
  const gratinA = model.contentValue('A', 'Gratin dauphinois', null, new Date('2026-11-19T17:00:00Z'), tz)!;
  const terrineA = model.contentValue('A', 'Terrine de saumon', null, new Date('2026-11-19T17:00:00Z'), tz)!;
  assert.ok(gratinA > 1.2 && terrineA < 0.9, `A: gratins ${gratinA}, terrines ${terrineA}`);
  assert.equal(model.bestStyle('A'), 'question');
  const h = model.highlights('A');
  assert.ok(h.best.some(item => item.word === 'gratin' || item.word === 'pâtes'), JSON.stringify(h.best));
  assert.ok(h.worst.some(item => item.word === 'terrine'), JSON.stringify(h.worst));
  assert.ok(model.captionTips('A').some(tip => tip.code === 'qstart'), 'captions opening with a question work on A');
  // Stored and updated: a later run adds new posts, and earlier lessons have faded.
  const later = absorb(a, [post('Quiche lorraine', 0, 2000)], new Date(now.getTime() + 60 * 86_400_000), tz);
  assert.equal(later.posts, 13);
  assert.ok(later.f['w:gratin']!.w < a.f['w:gratin']!.w / 3, 'two half-lives later a lesson weighs a quarter');
});

test('memory: shares and comments count, not reach alone', async () => {
  const { absorb, memoryModel } = await import('@/modules/feeds/wordpress/memory');
  const tz = 'Europe/Paris'; const now = new Date('2026-11-18T12:00:00Z');
  const post = (title: string, i: number, shares: number) => ({ at: new Date(now.getTime() - (i + 1) * 86_400_000), title, kind: null, style: null, caption: '', reach: 1000, reactions: 50, comments: 5, shares });
  const memory = absorb(null, [...Array.from({ length: 5 }, (_, i) => post(`Crêpes ${i}`, i, 60)), ...Array.from({ length: 5 }, (_, i) => post(`Velouté ${i}`, i + 5, 1))], now, tz);
  const model = memoryModel(new Map([['A', memory]]));
  assert.ok(model.contentValue('A', 'Crêpes sucrées', null, null, tz)! > model.contentValue('A', 'Velouté de légumes', null, null, tz)!, 'shared recipes rank higher at equal reach');
});

test('photos: the AI answer is read as appeal and known traits only', async () => {
  const { parsePhoto } = await import('@/modules/feeds/server/wordpress-scoring');
  assert.deepEqual(parsePhoto('```json\n{"appeal": 8.4, "traits": ["close_up", "golden_crust", "unicorn"]}\n```'), { appeal: 8, traits: ['close_up', 'golden_crust'] });
  assert.deepEqual(parsePhoto('7'), { appeal: 7, traits: [] });
  assert.equal(parsePhoto('no idea'), null);
});

test('memory: what a photo shows is learned per Page and counts for a candidate', async () => {
  const { absorb, memoryModel } = await import('@/modules/feeds/wordpress/memory');
  const tz = 'Europe/Paris'; const now = new Date('2026-11-18T12:00:00Z');
  const post = (i: number, traits: string[], reach: number) => ({ at: new Date(now.getTime() - (i + 1) * 86_400_000), title: `Plat ${i}`, kind: null, style: null, caption: '', reach, reactions: reach / 20, comments: 2, shares: 2, traits, appeal: 7 });
  const memory = absorb(null, [...Array.from({ length: 5 }, (_, i) => post(i, ['cheese_pull', 'close_up'], 3000)), ...Array.from({ length: 5 }, (_, i) => post(i + 5, ['dark'], 300))], now, tz);
  const model = memoryModel(new Map([['A', memory]]));
  const cheesy = model.photoValue('A', ['cheese_pull'])!;
  const dark = model.photoValue('A', ['dark'])!;
  assert.equal(model.photoValue('A', ['never_seen']), null);
  assert.ok(cheesy > dark, `cheese pull ${cheesy} vs dark ${dark}`);
  assert.ok(model.highlights('A').photos.some(p => p.trait === 'cheese_pull'));
});

test('photos: a JPEG goes out exactly as downloaded; a PNG becomes a JPEG with nothing added', async () => {
  const sharp = (await import('sharp')).default;
  const { convertToJpeg } = await import('@/modules/feeds/wordpress/image');
  const settings = { maxPixels: 1_000_000, quality: 80, minQuality: 60, qualityStep: 5, maxOutputBytes: 1_000_000 };
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c86' } }).jpeg({ quality: 95 }).withMetadata().toBuffer();
  assert.ok((await convertToJpeg(jpeg, settings)).equals(jpeg), 'byte for byte');
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c86' } }).png().toBuffer();
  const converted = await convertToJpeg(png, settings);
  assert.equal((await sharp(converted).metadata()).format, 'jpeg');
  assert.equal((await sharp(converted).metadata()).xmp, undefined);
  const big = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#c86' }, }).jpeg({ quality: 100 }).toBuffer();
  assert.ok((await convertToJpeg(big, { ...settings, maxOutputBytes: big.length - 1 })).length < big.length, 'a JPEG over the limit is made smaller');
  const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c86' } }).webp().toBuffer();
  assert.equal((await sharp(await convertToJpeg(webp, settings)).metadata()).format, 'jpeg', 'WebP becomes JPEG by default');
  assert.ok((await convertToJpeg(webp, { ...settings, keepWebp: true })).equals(webp), 'kept byte for byte when asked');
});

test('memory: posts made outside the autopilot teach it too, with their format', async () => {
  const { absorb, memoryModel, formatOf } = await import('@/modules/feeds/wordpress/memory');
  assert.equal(formatOf('added_video'), 'video'); assert.equal(formatOf('added_photos'), 'photo'); assert.equal(formatOf('shared_story'), 'link'); assert.equal(formatOf(null, true), 'photo'); assert.equal(formatOf('mobile_status_update'), 'text');
  const tz = 'Europe/Paris'; const now = new Date('2026-11-18T12:00:00Z');
  const post = (i: number, origin: 'app' | 'external', format: 'photo' | 'video', reach: number) => ({ at: new Date(now.getTime() - (i + 1) * 86_400_000), title: `Plat ${i}`, kind: null, style: null, caption: '', reach, reactions: reach / 20, comments: 2, shares: 2, origin, format });
  const memory = absorb(null, [...Array.from({ length: 5 }, (_, i) => post(i, 'external', 'video', 5000)), ...Array.from({ length: 5 }, (_, i) => post(i + 5, 'app', 'photo', 800))], now, tz);
  const h = memoryModel(new Map([['A', memory]])).highlights('A');
  assert.equal(h.formats[0]!.format, 'video', 'videos do better here');
  const app = h.origins.find(o => o.origin === 'app')!, other = h.origins.find(o => o.origin === 'external')!;
  assert.ok(app.times < other.times, 'the autopilot posts do worse than the Page\'s other posts here');
});

test('memory: posting times come from what each Page learned, hours with evidence only, spaced', async () => {
  const { absorb, memoryModel } = await import('@/modules/feeds/wordpress/memory');
  const tz = 'Europe/Paris'; const now = new Date('2026-11-18T12:00:00Z');
  const at = (day: number, hour: number) => new Date(Date.UTC(2026, 10, 18 - day, hour - 1, 0));
  const post = (day: number, hour: number, reach: number) => ({ at: at(day, hour), title: 'Plat', kind: null, style: null, caption: '', reach, reactions: reach / 20, comments: 2, shares: 2 });
  const posts = Array.from({ length: 6 }, (_, d) => [post(d + 1, 7, 4000), post(d + 1, 8, 3500), post(d + 1, 11, 1500), post(d + 1, 15, 1200), post(d + 1, 20, 600)]).flat();
  const model = memoryModel(new Map([['A', absorb(null, posts, now, tz)]]));
  assert.deepEqual(model.bestTimes('A', 3, [6, 23], 60, 5), ['07:05', '08:05', '11:05'], 'the best hours, an hour apart is allowed');
  assert.deepEqual(model.bestTimes('A', 3, [6, 23], 120, 5), ['07:05', '11:05', '15:05'], 'with two hours apart, 8 h is too close to 7 h');
  assert.equal(model.bestTimes('A', 6, [6, 23], 60), null, 'not enough known hours: no change');
});

test('memory: the number of posts a day is learned from whole days, and one more is tried', async () => {
  const { absorb, memoryModel, MAX_POSTS_PER_DAY } = await import('@/modules/feeds/wordpress/memory');
  const tz = 'Europe/Paris'; const now = new Date('2026-11-30T12:00:00Z');
  const day = (d: number, count: number, reachEach: number) => Array.from({ length: count }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, d, 8 + i * 3)), title: 'Plat', kind: null, style: null, caption: '', reach: reachEach, reactions: reachEach / 20, comments: 2, shares: 2 }));
  const four = Array.from({ length: 10 }, (_, i) => day(10 + i, 4, 1000)).flat();
  let model = memoryModel(new Map([['A', absorb(null, [...four, ...day(25, 1, 1000)], now, tz)]]));
  assert.deepEqual(model.bestCount('A', 4).values.map(v => [v.count, v.days]), [[4, 10]], 'whole days only');
  assert.equal(model.bestCount('A', 4).count, 5, 'the current count is the best known: one more is tried');
  const better = [...four, ...Array.from({ length: 3 }, (_, i) => day(20 + i, 5, 1000)).flat(), ...day(25, 1, 1000)];
  model = memoryModel(new Map([['A', absorb(null, better, now, tz)]]));
  assert.equal(model.bestCount('A', 5).count, 6, 'five did better: kept, and six is tried next');
  const worse = [...four, ...Array.from({ length: 3 }, (_, i) => day(20 + i, 5, 300)).flat(), ...day(25, 1, 1000)];
  model = memoryModel(new Map([['A', absorb(null, worse, now, tz)]]));
  assert.equal(model.bestCount('A', 5).count, 4, 'five did worse in total: back to four');
  assert.equal(memoryModel(new Map()).bestCount('A', 4).count, 4, 'nothing known: no change');
  // A Page that did best at 7 a day and now posts an untried 4: straight to 7.
  const seven = Array.from({ length: 4 }, (_, i) => day(10 + i, 7, 1500)).flat();
  const five = Array.from({ length: 4 }, (_, i) => day(15 + i, 5, 800)).flat();
  model = memoryModel(new Map([['A', absorb(null, [...seven, ...five, ...day(25, 1, 1000)], now, tz)]]));
  assert.equal(model.bestCount('A', 4).count, 7);
  // A trial of one more (5 after a best of 4) is kept until it has three days.
  model = memoryModel(new Map([['A', absorb(null, [...four, ...day(25, 1, 1000)], now, tz)]]));
  assert.equal(model.bestCount('A', 5).count, 5);
  assert.ok(MAX_POSTS_PER_DAY <= 10);
});

test('photos: a real-size recipe photo is shrunk for the AI, not refused', async () => {
  const sharp = (await import('sharp')).default;
  const { photoForAi } = await import('@/modules/feeds/wordpress/image');
  const photo = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#c86' } }).webp().toBuffer();
  const small = await photoForAi(photo);
  const meta = await sharp(small).metadata();
  assert.equal(meta.format, 'jpeg'); assert.ok(meta.height === 768 && (meta.width ?? 0) <= 768, `${meta.width}x${meta.height}`);
});

test('memory: generated photos stop on a Page where they do clearly worse', async () => {
  const { absorb, memoryModel } = await import('@/modules/feeds/wordpress/memory');
  const now = new Date('2026-11-25T12:00:00Z');
  const post = (i: number, imageSource: 'site' | 'generated', reach: number) => ({ at: new Date(now.getTime() - (i + 3) * 86_400_000), title: `Gratin ${i}`, kind: null, style: null, caption: '', reach, reactions: reach / 20, comments: 5, shares: 5, imageSource });
  const site = Array.from({ length: 6 }, (_, i) => post(i, 'site', 2000));
  const worse = memoryModel(new Map([['A', absorb(null, [...site, ...Array.from({ length: 6 }, (_, i) => post(i + 6, 'generated', 600))], now, tz)]]));
  assert.equal(worse.generatedPhotosOk('A'), false);
  const fine = memoryModel(new Map([['A', absorb(null, [...site, ...Array.from({ length: 6 }, (_, i) => post(i + 6, 'generated', 2400))], now, tz)]]));
  assert.equal(fine.generatedPhotosOk('A'), true);
  // Too few posts with one to judge: still tried.
  const early = memoryModel(new Map([['A', absorb(null, [...site, post(6, 'generated', 300)], now, tz)]]));
  assert.equal(early.generatedPhotosOk('A'), true);
});

test('generated photo prompt: the owner-approved step-by-step collage, the recipe, no text, within 1000 characters', async () => {
  const { photoPrompt } = await import('@/modules/feeds/server/wordpress-photos');
  const prompt = photoPrompt('Gratin dauphinois', ['pommes de terre', 'crème'], ['Éplucher les pommes de terre.', 'Cuire au four 1 h.']);
  assert.match(prompt, /Recipe: Gratin dauphinois\./);
  assert.match(prompt, /two rows of 2 small square step photos/);
  assert.match(prompt, /Ingredients: pommes de terre, crème\./);
  assert.match(prompt, /no text/);
  const long = photoPrompt('x'.repeat(140), Array(20).fill('ingrédient très long '.repeat(5)), Array(20).fill('étape '.repeat(40)));
  assert.ok(long.length <= 1000);
  assert.match(long, /(ingrédient|long|très|étape)\. Step 1/, 'cut at a word, never mid-word');
});

test('picker: a strong recipe with a weak photo is not passed over when a new photo will replace it', async () => {
  const { makePicker } = await import('@/modules/feeds/server/wordpress-pick');
  const { AUTOPILOT_DEFAULTS } = await import('@/modules/feeds/wordpress/autopilot');
  const candidates = [{ wpPostId: 'weak', title: 'Gratin de pâtes' }, { wpPostId: 'ok', title: 'Gratin de pâtes au jambon' }];
  const ratings = new Map([['weak', { kind: null, hook: 9, photo: 2 }], ['ok', { kind: null, hook: 6, photo: 6 }]]);
  const base = { pilot: { ...AUTOPILOT_DEFAULTS, moments: { ...AUTOPILOT_DEFAULTS.moments, rules: [] } }, timeZone: 'Europe/Paris', ratings, history: () => null, weather: new Map(), timeline: new Map(), winners: new Set<string>(), winnerQuota: 0, candidates };
  const at = new Date('2026-11-19T10:00:00Z');
  const without = makePicker(base), withNew = makePicker({ ...base, replacesPhoto: (_: string | null, r: { photo: number | null; hook: number | null }) => (r.photo ?? 10) <= 5 && (r.hook ?? 0) >= 7 });
  assert.ok(withNew.scoreAt(candidates[0]!, at, 'A') > without.scoreAt(candidates[0]!, at, 'A'));
  assert.equal(withNew.scoreAt(candidates[1]!, at, 'A'), without.scoreAt(candidates[1]!, at, 'A'));
});

test('hit words: what the biggest posts share boosts similar recipes on every Page', async () => {
  const { hitWords, hitBoost } = await import('@/modules/feeds/wordpress/memory');
  const posts = [
    { title: 'Mini-quiches au jambon et fromage', reach: 400_000 }, { title: 'Gaufres salées jambon fromage', reach: 200_000 },
    { title: 'Roulés jambon-fromage panés', reach: 120_000 }, { title: 'Charlotte aux framboises', reach: 60 }, { title: 'Velouté de potiron', reach: 40 },
  ];
  const words = hitWords(posts, 3);
  assert.ok(words.has('jambon') && words.has('fromage'));
  assert.ok(!words.has('framboise'), 'weak posts are not hits');
  assert.equal(hitBoost(words, 'Croque au jambon et fromage'), 2);
  assert.equal(hitBoost(words, 'Tarte aux pommes'), 1);
  assert.equal(hitBoost(new Map(), 'Croque au jambon'), 1);
});

test('generated photo: the recipe facts come from the first comment, and the final shot stays true to the recipe', async () => {
  const { recipeFacts, photoPrompt } = await import('@/modules/feeds/server/wordpress-photos');
  const facts = recipeFacts('💬 Et vous ?\n\n🧂 Ingrédients :\n• 400 g de saumon fumé\n• 200 g de fromage frais\n\n👩‍🍳 Préparation :\n1. Mélanger le fromage frais.\n2. Rouler le saumon.');
  assert.deepEqual(facts, { ingredients: ['400 g de saumon fumé', '200 g de fromage frais'], steps: ['Mélanger le fromage frais.', 'Rouler le saumon.'] });
  const prompt = photoPrompt('Rouleau de saumon fumé', facts.ingredients, facts.steps);
  assert.match(prompt, /Ingredients: 400 g de saumon fumé, 200 g de fromage frais\./);
  assert.match(prompt, /Only ingredients from the list/);
  assert.match(prompt, /a cold dish shows a neat slice/);
  assert.ok(prompt.length <= 1000);
});

test('photo rating v2: strict parts make one 0–10, defects lower it, the old answer still reads', async () => {
  const { parsePhoto } = await import('@/modules/feeds/server/wordpress-scoring');
  const good = parsePhoto('{"realism":8,"appetite":9,"final_shot":9,"scroll_stop":8,"traits":["collage","cheese_pull"]}')!;
  assert.equal(good.appeal, 8); assert.deepEqual(good.traits, ['collage', 'cheese_pull']);
  const poster = parsePhoto('{"realism":6,"appetite":8,"final_shot":8,"scroll_stop":7,"traits":["title_text","ingredient_graphic"]}')!;
  assert.equal(poster.appeal, 4, 'a poster with a title and an ingredient graphic loses 3 points');
  assert.equal(parsePhoto('{"appeal":7,"traits":["close_up"]}')!.appeal, 7);
  assert.deepEqual(parsePhoto('{"realism":5,"appetite":5,"final_shot":5,"scroll_stop":5,"traits":["unknown_thing"]}')!.traits, []);
});

test('autopilot copy: every photo trait has a label in both languages, and a missing key never throws', async () => {
  const { autopilotText, autopilotCopy } = await import('@/modules/feeds/copy-autopilot');
  const { PHOTO_TRAITS } = await import('@/modules/feeds/server/wordpress-scoring');
  for (const trait of PHOTO_TRAITS) for (const locale of ['en', 'fr'] as const) assert.ok(typeof (autopilotCopy[locale] as Record<string, unknown>)[`trait_${trait}`] === 'string', `${locale} trait_${trait}`);
  assert.equal(autopilotText('fr', 'trait_never_seen' as never), 'never seen');
});

test('settledFailures: cancelled, replaced and moved-off-a-full-day slots are history; a short day keeps its failure', async () => {
  const { settledFailures } = await import('../../src/modules/feeds/wordpress/autopilot');
  const row = (id: string, targetId: string, state: string, reason: string | null = null) => ({ id, targetId, state, reason });
  const rows = [
    row('a1', 'A', 'planned'), row('a2', 'A', 'planned'), row('a3', 'A', 'failed', 'writing:conflict'), row('a4', 'A', 'failed', 'cancelled'),
    row('b1', 'B', 'planned'), row('b2', 'B', 'failed', 'writing:conflict'), row('b3', 'B', 'failed', 'replaced'), row('b4', 'B', 'failed', 'left_empty'),
  ];
  assert.deepEqual([...settledFailures(rows, () => 2)].sort(), ['a3', 'a4', 'b3']);
});

test('settledFailures by day: a full day settles its failed time, a short day on the same channel keeps it', async () => {
  const { settledFailures } = await import('../../src/modules/feeds/wordpress/autopilot');
  const row = (id: string, day: string, state: string, reason: string | null = null) => ({ id, targetId: 'A', day, state, reason });
  const rows = [row('m1', 'mon', 'planned'), row('m2', 'mon', 'planned'), row('mf', 'mon', 'failed', 'writing:conflict'),
    row('t1', 'tue', 'planned'), row('tf', 'tue', 'failed', 'writing:conflict')];
  assert.deepEqual([...settledFailures(rows, () => 2, r => `${r.targetId}|${r.day}`)], ['mf']);
});

test('captionTitle: a channel can post with the recipe title alone; others keep the written caption', async () => {
  const { channelConfig, planConfigPatchSchema } = await import('@/modules/feeds/wordpress/recipe');
  const base = { slots: ['11:00'], autopilot: AUTOPILOT_DEFAULTS, channels: { a: { captionTitle: true } } } as unknown as Parameters<typeof channelConfig>[0];
  assert.equal(channelConfig(base, 'a').captionTitle, true);
  assert.equal(channelConfig(base, 'b').captionTitle, false);
  const schema = planConfigPatchSchema({ template: 2000, horizon: { min: 1, max: 14 }, cooldown: { min: 0, max: 730 }, age: { min: 0, max: 3650 }, delay: { min: 0, max: 60 } });
  assert.equal(schema.safeParse({ channels: { a: { captionTitle: true } } }).success, true);
  assert.equal(schema.safeParse({ channels: { a: { captionTitle: 'yes' } } }).success, false);
});

test('photo score: a learned trait value replaces the raw AI appeal, which only nudges without one', async () => {
  const { scoreRecipe } = await import('@/modules/feeds/wordpress/score');
  const { photoWeak } = await import('@/modules/feeds/wordpress/memory');
  const at = { date: new Date('2026-11-21T12:00:00Z'), weekday: 6, hour: 12, leadDays: 14, rules: new Set<never>() };
  const part = (input: Parameters<typeof scoreRecipe>[0]) => scoreRecipe(input, at).parts.find(p => p.label === 'photo')?.points ?? 0;
  assert.equal(part({ title: 'Gratin', photo: 9, photoValue: 1.31 }), 11);
  assert.equal(part({ title: 'Gratin', photo: 9, photoValue: 0.98 }), -1);
  assert.equal(part({ title: 'Gratin', photo: 9 }), 4);
  assert.equal(part({ title: 'Gratin', photo: 2 }), -3);
  assert.equal(photoWeak(0.95, 9), true);
  assert.equal(photoWeak(1.2, 2), false);
  assert.equal(photoWeak(null, 5), true);
  assert.equal(photoWeak(null, 6), false);
});

test('dish families: a title can be in several; the memory learns each family and a hot one lifts its recipes', async () => {
  const { familiesOf } = await import('@/modules/feeds/wordpress/score');
  const { absorb, memoryModel } = await import('@/modules/feeds/wordpress/memory');
  assert.deepEqual(familiesOf('Feuilletés au fromage et au jambon, garniture crémeuse'), ['feuillete', 'jambon_fromage']);
  assert.deepEqual(familiesOf('Terrine de saumon fumé'), ['terrine', 'poisson']);
  assert.deepEqual(familiesOf('Lait crémeux aux agrumes'), []);
  assert.deepEqual(familiesOf('Camembert feuilleté au bacon, doré et fondant'), ['feuillete']);
  assert.deepEqual(familiesOf('Potimarron farci, fondant et gratiné au four'), ['farci']);
  const tz = 'Europe/Paris'; const now = new Date('2026-11-21T12:00:00Z');
  const post = (i: number, title: string, reach: number) => ({ at: new Date(now.getTime() - (i + 1) * 86_400_000), title, kind: null, style: null, caption: '', reach, reactions: reach / 20, comments: 2, shares: 2 });
  const memory = absorb(null, [...Array.from({ length: 6 }, (_, i) => post(i, `Gratin numéro ${i}`, 5000)), ...Array.from({ length: 6 }, (_, i) => post(i + 6, `Soupe numéro ${i}`, 500))], now, tz);
  const model = memoryModel(new Map([['A', memory]]));
  assert.ok(model.contentValue('A', 'Gratin de chou-fleur', null, null, tz)! > model.contentValue('A', 'Soupe de chou-fleur', null, null, tz)!);
  const families = model.highlights('A').families.map(f => f.family);
  assert.equal(families[0], 'gratin');
  assert.equal(families.at(-1), 'soupe');
});

test('testing ground: the two biggest Pages exploit, the others favour recipes from families new to all Pages', async () => {
  const { absorb, memoryModel, EXPLORED } = await import('@/modules/feeds/wordpress/memory');
  const tz = 'Europe/Paris'; const now = new Date('2026-11-21T12:00:00Z');
  const post = (i: number, title: string, reach: number) => ({ at: new Date(now.getTime() - (i + 1) * 86_400_000), title, kind: null, style: null, caption: '', reach, reactions: reach / 20, comments: 2, shares: 2 });
  const page = (reach: number) => absorb(null, Array.from({ length: EXPLORED }, (_, i) => post(i, `Gratin numéro ${i}`, reach)), now, tz);
  const model = memoryModel(new Map([['rf', page(9000)], ['cpe', page(4000)], ['small', page(50)]]));
  assert.deepEqual(model.bigPages(2), ['rf', 'cpe']);
  assert.equal(model.novelty('Gratin de chou-fleur'), 0);
  assert.equal(model.novelty('Soupe de potiron'), 1);
  assert.ok(Math.abs(model.novelty('Lait aux agrumes') - 1 / 3) < 1e-9);
});

test('captions: worn-out phrases are found whatever the accents or apostrophes, and named in the prompt', async () => {
  const { clicheIn, captionPrompt, CLICHES } = await import('@/modules/feeds/wordpress/caption');
  assert.equal(clicheIn('Chez nous, la famille se retrouve autour d’un ragoût'), 'la famille se retrouve');
  assert.equal(clicheIn('LES SOURIRES se dessinent'), 'les sourires');
  assert.equal(clicheIn('Ce gratin met tout le monde d\'accord'), 'met tout le monde d’accord');
  assert.equal(clicheIn('Croustillant dehors, fondant dedans.'), null);
  const { system } = captionPrompt({ channel: 'P', voice: 'warm', style: 'story', question: false, emoji: 'few', title: 'Gratin', caption: '', ingredients: [] });
  assert.ok(CLICHES.every(phrase => system.includes(phrase)));
  assert.ok(!system.includes('family life'));
});

test('plainComment: a channel can post its template as is; a link-only template renders to the link alone', async () => {
  const { channelConfig, planConfigPatchSchema, renderComment } = await import('@/modules/feeds/wordpress/recipe');
  const base = { slots: ['11:00'], autopilot: AUTOPILOT_DEFAULTS, firstCommentTemplate: '{ingredients}', channels: { rf: { plainComment: true, firstCommentTemplate: '👉 {link}' } } } as unknown as Parameters<typeof channelConfig>[0];
  assert.equal(channelConfig(base, 'rf').plainComment, true);
  assert.equal(channelConfig(base, 'other').plainComment, false);
  const schema = planConfigPatchSchema({ template: 2000, horizon: { min: 1, max: 14 }, cooldown: { min: 0, max: 730 }, age: { min: 0, max: 3650 }, delay: { min: 0, max: 60 } });
  assert.equal(schema.safeParse({ channels: { rf: { plainComment: true } } }).success, true);
  const recipe = { title: 'Gratin', description: '', servings: '', prep: '', cook: '', total: '', ingredients: [], steps: [] };
  assert.equal(renderComment('👉 {link}', recipe, 'https://recettes.example/gratin/', { max: 2000, mark: '…' }), '👉 https://recettes.example/gratin/');
});

test('reach test (2026-11-24): a daily cap keeps the hours that reach most; « no AI info » is read per channel', async () => {
  const { channelConfig, capSlots, planConfigPatchSchema } = await import('@/modules/feeds/wordpress/recipe');
  const learned = ['07:10', '11:10', '14:10', '17:10', '18:10', '20:10'];
  const values = { '7': 0.4, '11': 1.6, '14': 0.9, '17': 1.2, '18': 2, '20': 0.7 };
  assert.deepEqual(capSlots(learned, 4, values), ['11:10', '14:10', '17:10', '18:10']);
  assert.deepEqual(capSlots(learned, undefined, values), learned);
  assert.deepEqual(capSlots(learned, 4, undefined), ['07:10', '11:10', '14:10', '17:10'], 'no values: the earliest times');
  const base = { slots: ['11:00', '17:00'], autopilot: { ...AUTOPILOT_DEFAULTS, learnedTimes: { a: learned, b: learned }, hourValues: { a: values } }, channels: { a: { maxPerDay: 4, noAiLabel: true } } } as unknown as Parameters<typeof channelConfig>[0];
  assert.deepEqual(channelConfig(base, 'a').slots, ['11:10', '14:10', '17:10', '18:10']);
  assert.equal(channelConfig(base, 'a').noAiLabel, true);
  assert.equal(channelConfig(base, 'b').slots.length, 6);
  assert.equal(channelConfig(base, 'b').noAiLabel, false);
  const schema = planConfigPatchSchema({ template: 500, horizon: { min: 1, max: 14 }, cooldown: { min: 0, max: 365 }, age: { min: 1, max: 3650 }, delay: { min: 0, max: 120 } }).partial();
  assert.ok(schema.safeParse({ channels: { a: { maxPerDay: 4, noAiLabel: true } } }).success);
  assert.ok(!schema.safeParse({ channels: { a: { maxPerDay: 0 } } }).success);
});
