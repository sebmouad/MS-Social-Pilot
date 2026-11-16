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
