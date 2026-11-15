// Recipe planning: posting days (2026-11-15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planConfigPatchSchema, slotInstants } from '@/modules/feeds/wordpress/recipe';

const now = new Date('2026-11-15T08:00:00Z'); // Sunday
const base = { now, slots: ['11:00', '17:00'], timezone: 'Europe/Paris', horizonDays: 7, leadMinutes: 10 };
const weekday = (d: Date) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Europe/Paris' }).format(d);

test('posting days: without a choice every day gets its times', () => {
  const days = new Set(slotInstants(base).map(weekday));
  assert.equal(days.size, 7);
});

test('posting days: only the kept days get slots', () => {
  const slots = slotInstants({ ...base, weekdays: [1, 3, 5] }); // Mon, Wed, Fri
  assert.ok(slots.length > 0);
  assert.deepEqual([...new Set(slots.map(weekday))].sort(), ['Fri', 'Mon', 'Wed']);
  assert.equal(slots.length, 6); // 3 days × 2 times within the week
});

test('posting days: the saved setting keeps at least one day, without repeats', () => {
  const schema = planConfigPatchSchema({ template: 500, horizon: { min: 1, max: 14 }, cooldown: { min: 0, max: 365 }, age: { min: 1, max: 3650 }, delay: { min: 0, max: 120 } });
  assert.equal(schema.safeParse({ weekdays: [] }).success, false);
  assert.equal(schema.safeParse({ weekdays: [7] }).success, false);
  const parsed = schema.safeParse({ weekdays: [5, 1, 1] });
  assert.ok(parsed.success && JSON.stringify(parsed.data.weekdays) === '[1,5]');
});
