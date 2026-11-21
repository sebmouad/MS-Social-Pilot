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

test('configPatch: a form never sends what the autopilot learned, only its settings', async () => {
  const { configPatch } = await import('@/modules/feeds/wordpress/recipe');
  const { AUTOPILOT_DEFAULTS } = await import('@/modules/feeds/wordpress/autopilot');
  type Config = Parameters<typeof configPatch>[0];
  const defaults = { slots: ['11:00'], autopilot: AUTOPILOT_DEFAULTS } as unknown as Config;
  const learnedOnly = { slots: ['11:00'], autopilot: { ...AUTOPILOT_DEFAULTS, log: [{ at: 'x' }], hourValues: { a: { 9: 1 } }, radarHandled: ['wrp_1'] } } as unknown as Config;
  assert.deepEqual(configPatch(learnedOnly, defaults), {});
  const changed = { slots: ['11:00'], autopilot: { ...AUTOPILOT_DEFAULTS, evergreen: { enabled: true, cooldownDays: 30, share: 20 }, log: [{ at: 'x' }] } } as unknown as Config;
  const patch = configPatch(changed, defaults) as { autopilot: Record<string, unknown> };
  assert.deepEqual(patch.autopilot.evergreen, { enabled: true, cooldownDays: 30, share: 20 });
  assert.equal('log' in patch.autopilot, false);
});
