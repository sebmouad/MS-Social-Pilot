// The sidebar's hubs (2026-11-20): the recipe autopilot is its own hub, with the cockpit and the recipe feeds as tabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_ORDER, hubForPath, hubPages } from '@/lib/hubs';
import { PAGES } from '@/lib/product';

const all = PAGES.map(page => page.id);

test('hubs: « Pilote automatique » comes right after Create and holds the cockpit then the recipe feeds', () => {
  assert.deepEqual(HUB_ORDER.slice(0, 3), ['create', 'pilot', 'plan']);
  assert.deepEqual(hubPages('pilot', all).map(page => page.href), ['/content/autopilot', '/content/feeds']);
  assert.ok(!hubPages('plan', all).some(page => page.href === '/content/feeds'), 'feeds left Content');
  assert.ok(hubPages('plan', all).some(page => page.href === '/content'), 'Content keeps its posts');
});

test('hubs: both autopilot routes belong to the Pilot hub; other content stays in Content', () => {
  assert.equal(hubForPath('/content/autopilot'), 'pilot');
  assert.equal(hubForPath('/content/feeds'), 'pilot');
  assert.equal(hubForPath('/content/calendar'), 'plan');
  assert.equal(hubForPath('/inbox'), 'engage');
});

test('hubs: without the content-feeds feature there is no Pilot hub', () => {
  assert.deepEqual(hubPages('pilot', all.filter(id => id !== 'publishing/feeds')), []);
});
