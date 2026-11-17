// The autopilot's log in the page language (2026-11-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logSentence } from '@/modules/feeds/autopilot-log';

test('log: a coded entry reads in French on a French page, in English otherwise', () => {
  const hot = { at: '2026-11-16T12:45:00Z', kind: 'radar' as const, code: 'hot', params: { title: 'Gratin', reach: 4100, hours: 2, times: 3.4 } };
  assert.match(logSentence(hot, 'fr'), /« Gratin » décolle : 4\s?100 personnes touchées en 2 h, 3,4×/);
  assert.match(logSentence(hot, 'en'), /« Gratin » is taking off: 4,100 people reached in 2 h, 3.4×/);
});

test('log: why nothing was spread, and older entries keep their text', () => {
  const none = { at: 'x', kind: 'radar' as const, code: 'notSpread', params: { count: 0, channels: '', already: 2, noSlot: 1, refused: 0 } };
  assert.equal(logSentence(none, 'fr'), 'Pas diffusée sur d’autres canaux : 2 l’avaient déjà eue, 1 sans horaire libre dans les trois jours.');
  assert.equal(logSentence({ at: 'x', kind: 'healing', text: 'Old English text.' }, 'fr'), 'Old English text.');
});

test('log: entries saved before codes existed read in the page language when their sentence is known', () => {
  const old = (text: string) => ({ at: 'x', kind: 'radar' as const, text });
  assert.equal(logSentence(old('« Sauce thaïe » was left unsure by an interrupted run and never created; its time is planned again.'), 'fr'),
    '« Sauce thaïe » est resté incertain après une exécution interrompue et n’a jamais été créé ; son horaire est replanifié.');
  assert.match(logSentence(old('« Gratin » is taking off: 1100 people reached, 1.5× usual.'), 'fr'), /^« Gratin » décolle : 1\s?100 personnes touchées, 1,5× l’habitude\.$/);
  assert.equal(logSentence(old('Planned on 2 similar channels: A, B.'), 'fr'), 'Planifiée sur 2 canaux proches : A, B.');
  assert.equal(logSentence(old('« Gratin » is taking off: 1100 people reached, 1.5× usual.'), 'en'), '« Gratin » is taking off: 1,100 people reached, 1.5× usual.');
});
