// Viral radar and breathing room for hot posts (2026-11-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHot, biggestAudiences, breatheTime, runRadar, type RadarPorts } from '@/modules/feeds/server/wordpress-radar';
import { AUTOPILOT_DEFAULTS } from '@/modules/feeds/wordpress/autopilot';

const now = new Date('2026-11-17T16:00:00Z');

test('hot: three times what a post usually has at its age, never on small numbers', () => {
  assert.equal(isHot({ reach: 3000, median: 1000, ageMinutes: 240, factor: 3 }), true);
  assert.equal(isHot({ reach: 2000, median: 1000, ageMinutes: 240, factor: 3 }), false);
  assert.equal(isHot({ reach: 1600, median: 1000, ageMinutes: 60, factor: 3 }), true); // 1 h: a usual post has half its reach
  assert.equal(isHot({ reach: 110, median: 73, ageMinutes: 60, factor: 3 }), false); // the first live false alarm
  assert.equal(isHot({ reach: 500, median: 0, ageMinutes: 60, factor: 3 }), false);
});

test('spread: the biggest usual audience first, never the hot one', () => {
  const medians = new Map([['hot', 1000], ['a', 950], ['b', 5000], ['c', 1200], ['d', 100]]);
  assert.deepEqual(biggestAudiences('hot', medians, 2), ['b', 'c']);
});

test('breathing room: an hour later on a 5-minute mark, never past the post after it', () => {
  const next = new Date('2026-11-17T16:20:00Z');
  assert.equal(breatheTime(next, null, 60)?.toISOString(), '2026-11-17T17:20:00.000Z');
  assert.equal(breatheTime(next, new Date('2026-11-17T17:10:00Z'), 60)?.toISOString(), '2026-11-17T16:40:00.000Z');
  assert.equal(breatheTime(next, new Date('2026-11-17T16:45:00Z'), 60), null);
});

test('radar: a hot post delays the next one and spreads to the biggest audiences, once', async () => {
  const moved: Array<{ postId: string; at: string }> = []; const chosen: Array<{ planId: string; wpPostId: string }> = [];
  const ports: RadarPorts = {
    async recent() { return [{ planId: 'plan1', targetId: 'hot', wpPostId: 'w1', title: 'Cannelés', postId: 'post1', publishedAt: new Date(now.getTime() - 90 * 60_000) }]; },
    async reach() { return 4000; },
    async medians() { return new Map([['hot', 1000], ['a', 900], ['b', 1100], ['c', 8000]]); },
    async nextPosts() { return [{ postId: 'next1', scheduledAt: new Date(now.getTime() + 30 * 60_000) }]; },
    async reschedule(_actor, postId, at) { moved.push({ postId, at: at.toISOString() }); },
    async upcoming() { return [
      { planId: 'sa1', targetId: 'a', wpPostId: 'x1', slotAt: new Date(now.getTime() + 20 * 3_600_000), score: 70 },
      { planId: 'sa2', targetId: 'a', wpPostId: 'x2', slotAt: new Date(now.getTime() + 30 * 3_600_000), score: 40 },
      { planId: 'sb1', targetId: 'b', wpPostId: 'x3', slotAt: new Date(now.getTime() + 10 * 3_600_000), score: 55 },
    ]; },
    async choose(planId, wpPostId) { chosen.push({ planId, wpPostId }); return true; },
  };
  const pilot = { ...AUTOPILOT_DEFAULTS, radar: { ...AUTOPILOT_DEFAULTS.radar, pages: 2 } };
  const input = { pilot, sourceId: 's', workspaceId: 'w', actor: { userId: 'u', workspaceId: 'w' }, now, handled: new Set<string>(), names: new Map([['hot', 'Hot'], ['a', 'A'], ['b', 'B'], ['c', 'C']]), blocked: () => false };
  const out = await runRadar(input, ports);
  assert.deepEqual(out.handled, ['plan1']);
  assert.equal(moved[0]?.postId, 'next1');
  assert.deepEqual(chosen, [{ planId: 'sb1', wpPostId: 'w1' }, { planId: 'sa2', wpPostId: 'w1' }]); // C (biggest) has no free time; then B, then A's weakest slot
  assert.ok(out.entries.some(e => /Planned on 2 channels with the biggest audience/.test(e.text ?? '')));
  const again = await runRadar({ ...input, handled: new Set(['plan1']) }, ports);
  assert.equal(again.entries.length, 0);
});

test('radar: when nothing can be spread, the log says why', async () => {
  const ports: RadarPorts = {
    async recent() { return [{ planId: 'p9', targetId: 'hot', wpPostId: 'w1', title: 'Gratin', postId: 'post9', publishedAt: new Date(now.getTime() - 60 * 60_000) }]; },
    async reach() { return 5000; }, async medians() { return new Map([['hot', 1000], ['a', 900], ['b', 1100]]); },
    async nextPosts() { return []; }, async reschedule() {}, async upcoming() { return []; }, async choose() { return true; },
  };
  const out = await runRadar({ pilot: AUTOPILOT_DEFAULTS, sourceId: 's', workspaceId: 'w', actor: { userId: 'u', workspaceId: 'w' }, now, handled: new Set(), names: new Map([['hot', 'Hot'], ['a', 'A'], ['b', 'B']]), blocked: id => id === 'a' }, ports);
  assert.ok(out.entries.some(e => /Not spread to other channels: 1 already had this recipe, 1 had no free time/.test(e.text ?? '')), JSON.stringify(out.entries));
});

test('radar: channels receiving a hit post it at least three hours apart, never at the same minute', async () => {
  const chosen: string[] = [];
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const ports: RadarPorts = {
    async recent() { return [{ planId: 'p1', targetId: 'hot', wpPostId: 'w1', title: 'Carbonnade', postId: 'post1', publishedAt: new Date(now.getTime() - 90 * 60_000) }]; },
    async reach() { return 5000; }, async medians() { return new Map([['hot', 1000], ['a', 1000], ['b', 1000], ['c', 1000]]); },
    async nextPosts() { return []; }, async reschedule() {},
    async upcoming() { return ['a', 'b', 'c'].flatMap(t => [{ planId: `${t}-19`, targetId: t, wpPostId: 'x', slotAt: at(19), score: null }, { planId: `${t}-23`, targetId: t, wpPostId: 'x', slotAt: at(23), score: null }, { planId: `${t}-27`, targetId: t, wpPostId: 'x', slotAt: at(27), score: null }]); },
    async choose(planId) { chosen.push(planId); return true; },
  };
  await runRadar({ pilot: AUTOPILOT_DEFAULTS, sourceId: 's', workspaceId: 'w', actor: { userId: 'u', workspaceId: 'w' }, now, handled: new Set(), names: new Map([['hot', 'H'], ['a', 'A'], ['b', 'B'], ['c', 'C']]), blocked: () => false }, ports);
  assert.deepEqual(chosen.map(id => id.split('-')[1]).sort(), ['19', '23', '27']);
});

test('radar: a late hit (past its first two hours) is spread once from its stored reach, without delaying the next post', async () => {
  const chosen: string[] = []; let moved = 0;
  const ports: RadarPorts = {
    async recent() { return []; },
    async reach() { throw new Error('a late hit is not read live'); },
    async storedHits() { return [
      { planId: 'late1', targetId: 'hot', wpPostId: 'w9', title: 'Pains aux raisins', postId: 'p9', publishedAt: new Date(now.getTime() - 30 * 3_600_000), reach: 480_000 },
      { planId: 'late2', targetId: 'hot', wpPostId: 'w8', title: 'Soupe', postId: 'p8', publishedAt: new Date(now.getTime() - 30 * 3_600_000), reach: 5_000 },
    ]; },
    async medians() { return new Map([['hot', 300], ['big', 20_000], ['small', 50]]); },
    async nextPosts() { return []; },
    async reschedule() { moved++; },
    async upcoming() { return [{ planId: 'sbig', targetId: 'big', wpPostId: 'x', slotAt: new Date(now.getTime() + 20 * 3_600_000), score: 40 }]; },
    async choose(planId) { chosen.push(planId); return true; },
  };
  const input = { pilot: { ...AUTOPILOT_DEFAULTS, radar: { ...AUTOPILOT_DEFAULTS.radar, pages: 1 } }, sourceId: 's', workspaceId: 'w', actor: { userId: 'u', workspaceId: 'w' }, now, handled: new Set<string>(), names: new Map([['hot', 'Hot'], ['big', 'Big'], ['small', 'Small']]), blocked: () => false };
  const out = await runRadar(input, ports);
  assert.deepEqual(out.handled, ['late1'], 'only the real hit (5,000 is under the late-hit floor)');
  assert.deepEqual(chosen, ['sbig']);
  assert.equal(moved, 0);
  assert.equal((await runRadar({ ...input, handled: new Set(['late1']) }, ports)).handled.length, 0, 'once');
});
