// Recipe viral score (2026-11-16): moments, season, weekday mood, weather, variety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRecipe, guessKind, easter, activeMoments, breaksVariety, dishWord, type ScoreContext } from '@/modules/feeds/wordpress/score';

const all = new Set(['holidays', 'season', 'weekday', 'weather'] as const);
const ctx = (iso: string, hour: number, extra: Partial<ScoreContext> = {}): ScoreContext => { const date = new Date(`${iso}T12:00:00Z`); return { date, weekday: date.getUTCDay(), hour, leadDays: 14, rules: all, ...extra }; };

test('score: Christmas dishes rise from two weeks before, not in October', () => {
  const buche = { title: 'Bûche de Noël au chocolat' };
  assert.ok(scoreRecipe(buche, ctx('2026-12-15', 18)).score > scoreRecipe(buche, ctx('2026-10-15', 18)).score);
  assert.ok(scoreRecipe(buche, ctx('2026-12-15', 18)).parts.some(p => p.label === 'moment:christmas'));
});

test('score: produce in season helps, a summer fruit in November is held back', () => {
  const nov = ctx('2026-11-17', 12);
  assert.ok(scoreRecipe({ title: 'Velouté de potiron' }, nov).score > 50);
  assert.ok(scoreRecipe({ title: 'Salade de pastèque et feta' }, nov).score < 50);
});

test('score: quick dinners lead on weekday evenings, desserts at the weekend', () => {
  assert.ok(scoreRecipe({ title: 'Poulet rapide au curry' }, ctx('2026-11-17', 18)).parts.some(p => p.label === 'weekday'));
  assert.ok(scoreRecipe({ title: 'Tarte tatin' }, ctx('2026-11-21', 15)).parts.some(p => p.label === 'weekend'));
});

test('score: weather moves comfort food and fresh dishes', () => {
  const cold = ctx('2026-11-17', 12, { weather: { maxC: 5 } });
  assert.ok(scoreRecipe({ title: 'Gratin dauphinois' }, cold).parts.some(p => p.label === 'weather' && p.points > 0));
  assert.ok(scoreRecipe({ title: 'Gaspacho andalou' }, cold).parts.some(p => p.label === 'weather' && p.points < 0));
});

test('score: AI ratings and history count, and the score stays between 1 and 99', () => {
  const strong = scoreRecipe({ title: 'Cannelés bordelais', hook: 10, photo: 10, history: 3 }, ctx('2026-11-17', 12));
  const weak = scoreRecipe({ title: 'Cannelés bordelais', hook: 0, photo: 0, history: 0 }, ctx('2026-11-17', 12));
  assert.ok(strong.score > 80 && weak.score < 20);
  assert.ok(strong.score <= 99 && weak.score >= 1);
});

test('kind: guessed from the title', () => {
  assert.equal(guessKind('Le punch aux agrumes'), 'drink');
  assert.equal(guessKind('Tarte au sucre briochée'), 'dessert');
  assert.equal(guessKind('Feuilletés jambon fromage'), 'aperitif');
  assert.equal(guessKind('Quiche lorraine'), 'main');
  assert.equal(guessKind('Velouté de potiron'), 'starter');
});

test('moments: Easter and the active window', () => {
  assert.equal(easter(2027).toISOString().slice(0, 10), '2027-03-28');
  assert.ok(activeMoments(new Date('2027-01-28T12:00:00Z'), 14).some(m => m.id === 'chandeleur'));
  assert.ok(!activeMoments(new Date('2027-01-10T12:00:00Z'), 14).some(m => m.id === 'chandeleur'));
});

test('variety: no more than the allowed run of one kind', () => {
  const h = 3_600_000;
  const day = [{ at: 1 * h, kind: 'dessert' as const }, { at: 2 * h, kind: 'dessert' as const }];
  assert.equal(breaksVariety(day, 3 * h, 'dessert', 2), true);
  assert.equal(breaksVariety(day, 3 * h, 'main', 2), false);
  assert.equal(breaksVariety([{ at: 1 * h, kind: 'dessert' }], 3 * h, 'dessert', 2), false);
});

test('dish word: names the dish family', () => {
  assert.equal(dishWord('Le gratin dauphinois crémeux'), 'gratin');
  assert.equal(dishWord('Recette facile de quiche lorraine'), 'quiche');
});

test('score: « pommes de terre » are potatoes, not seasonal apples', () => {
  const nov = ctx('2026-11-17', 12);
  assert.ok(!scoreRecipe({ title: 'Gratin de pommes de terre au jambon' }, nov).parts.some(p => p.label === 'season'));
  assert.ok(scoreRecipe({ title: 'Tarte aux pommes' }, nov).parts.some(p => p.label === 'season'));
});
