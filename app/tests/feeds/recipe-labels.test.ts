import assert from 'node:assert/strict';
import test from 'node:test';
import { recipeLabels } from '@/modules/feeds/server/recipe-labels';

test('planned times carry their day and hour apart, in the source time zone', () => {
  const labels = recipeLabels({ source: { config: { timezone: 'Europe/Paris' } }, plans: { items: [{ id: 'a', slotAt: '2026-11-18T23:30:00.000Z' }, { id: 'b', slotAt: 'not a date' }] } }, 'fr');
  assert.equal(labels.days.a, 'jeudi 19 novembre');
  assert.equal(labels.times.a, '00:30');
  assert.equal(labels.days.b, undefined);
  assert.ok(labels.slots.a);
});

test('without a source there are no labels', () => {
  const labels = recipeLabels({ source: null, plans: { items: [{ id: 'a', slotAt: '2026-11-18T23:30:00.000Z' }] } }, 'en');
  assert.deepEqual(labels.days, {});
  assert.deepEqual(labels.times, {});
});
