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
