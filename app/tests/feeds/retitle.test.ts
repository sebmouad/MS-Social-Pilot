// Title-only captions reach queued posts (2026-11-21): their media is passed back as the publishing update takes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaOf } from '@/modules/feeds/server/wordpress-retitle';

test('mediaOf: keeps url and alt text, fills a missing alt with the title, drops entries without url', () => {
  assert.deepEqual(mediaOf([{ kind: 'image', url: 'media:abc', altText: 'Gratin', width: 1080 }, { url: 'media:def' }, { altText: 'x' }], 'Tarte'),
    [{ kind: 'image', url: 'media:abc', altText: 'Gratin' }, { kind: 'image', url: 'media:def', altText: 'Tarte' }]);
  assert.deepEqual(mediaOf(null, 'Tarte'), []);
});
