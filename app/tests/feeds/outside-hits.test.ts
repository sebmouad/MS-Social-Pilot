// The owner's own hits come back (2026-11-22): the site's recipe is found by its exact title, and the answer is cached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipeByTitle } from '@/modules/feeds/server/wordpress-planner';
import type { WpDb } from '@/modules/feeds/wordpress/db';

const config = { mapping: { captionMetaKey: '', imageMetaKey: '', recipeMetaKey: '', skipMetaKey: '', attachedFileMetaKey: '_wp_attached_file', postType: 'post', postStatus: 'publish' } } as never;

test('recipeByTitle: only an exact title (accents, case, punctuation aside) is taken, and asked once a day', async () => {
  let calls = 0; let lastSearch = '';
  const db = { async candidates(q: { search?: string }) { calls++; lastSearch = q.search ?? '';
    return { rows: [{ id: '55265', title: 'Pastéis de nata : recette portugaise facile' }, { id: '55266', title: 'Pastéis de nata, crème lisse et pâte bien croustillante' }], fetched: 2, requested: 10 }; } } as unknown as WpDb;
  const now = new Date('2026-11-22T12:00:00Z');
  assert.equal(await recipeByTitle(db, config, 'PASTEIS DE NATA, crème lisse et pâte bien croustillante', now), '55266');
  assert.equal(lastSearch, 'PASTEIS DE NATA, crème lisse et pâte bien croustillante');
  assert.equal(await recipeByTitle(db, config, 'Pasteis de nata creme lisse et pate bien croustillante', new Date(now.getTime() + 3_600_000)), '55266');
  assert.equal(calls, 1);
  assert.equal(await recipeByTitle(db, config, 'Pastéis de nata maison', now), null);
});

test('closestVariant: the site\'s nearest variant of a hit, only when they share at least half their dish words', async () => {
  const { closestVariant } = await import('@/modules/feeds/server/wordpress-planner');
  const rows = ['Couronne de pâte feuilletée au brie et au bacon', 'Feuilleté au camembert et au bacon, doré au four', 'Tarte rustique aux pommes de terre, bacon et brie']
    .map((title, i) => ({ id: String(i), title }));
  assert.equal(closestVariant('Camembert feuilleté au bacon, doré et fondant', rows)?.id, '1');
  assert.equal(closestVariant('Potimarron farci, fondant et gratiné au four', rows), null);
});
