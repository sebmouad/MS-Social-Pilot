// A settings save never drops what the autopilot learned (2026-11-21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepLearned } from '@/modules/feeds/server/wordpress';

const stored = { slots: ['11:00'], autopilot: { captions: { enabled: true }, learnedTimes: { a: ['09:00'] }, radarHandled: ['wrp_1'], log: [{ at: 'x' }] } };

test('keepLearned: a save without an autopilot block keeps the learned data', () => {
  const config: Record<string, unknown> = { slots: ['10:00'] };
  keepLearned(stored, config);
  assert.deepEqual(config.autopilot, { learnedTimes: { a: ['09:00'] }, radarHandled: ['wrp_1'], log: [{ at: 'x' }] });
});

test('keepLearned: a form can change settings but not learned data, and cannot add learned keys', () => {
  const config: Record<string, unknown> = { autopilot: { captions: { enabled: false }, learnedTimes: { a: ['23:00'] }, hourValues: { a: { 9: 1 } } } };
  keepLearned(stored, config);
  assert.deepEqual(config.autopilot, { captions: { enabled: false }, learnedTimes: { a: ['09:00'] }, radarHandled: ['wrp_1'], log: [{ at: 'x' }] });
});

test('keepLearned: a first save has nothing to keep', () => {
  const config: Record<string, unknown> = { slots: ['10:00'] };
  keepLearned(undefined, config);
  assert.deepEqual(config, { slots: ['10:00'] });
});
