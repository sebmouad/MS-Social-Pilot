// What each feature is worth across Pages (2026-11-21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureLessons, type PageMemory } from '@/modules/feeds/wordpress/memory';

const memory = (f: PageMemory['f']): PageMemory => ({ v: 1, at: '2026-11-21T00:00:00Z', posts: 10, usual: null, f });

test('featureLessons: pools Pages, keeps the asked prefixes, drops thin features, best first', () => {
  const pages = new Map([
    ['a', memory({ 'p:high': { s: Math.log(2) * 4, w: 4, n: 4 }, 'p:low': { s: Math.log(0.5) * 6, w: 6, n: 6 }, 'w:gratin': { s: 1, w: 1, n: 9 } })],
    ['b', memory({ 'p:high': { s: Math.log(2) * 4, w: 4, n: 4 }, 'i:closeup': { s: 0, w: 1, n: 2 } })],
  ]);
  assert.deepEqual(featureLessons(pages, ['p:', 'i:']), [{ feature: 'p:high', times: 2, posts: 8 }, { feature: 'p:low', times: 0.5, posts: 6 }]);
});
