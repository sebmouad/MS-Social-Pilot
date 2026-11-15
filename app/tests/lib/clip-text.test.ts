// Text shortening never splits a character (2026-11-15): a split emoji made React report hydration error #418.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipText } from '@/lib/clip-text';

const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('clipText: short text is unchanged', () => assert.equal(clipText('Bonjour 👋', 20), 'Bonjour 👋'));
test('clipText: a cut on an emoji keeps it whole, never half of it', () => {
  const text = `${'a'.repeat(9)}👩‍🍳 Chef`;
  const out = clipText(text, 10);
  assert.equal(lone.test(out), false);
  assert.equal(out, `${'a'.repeat(9)}👩‍🍳…`);
  // The old slice() split the same text inside the emoji.
  assert.equal(lone.test(text.slice(0, 10)), true);
});
test('clipText: the mark can be left out', () => assert.equal(clipText('Gratin dauphinois', 6, ''), 'Gratin'));
