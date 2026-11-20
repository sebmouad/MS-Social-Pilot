// Autopilot captions (2026-11-16): voices, hook styles under test, calls to action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleFor, bestStyle, cleanCaption, ctaFor, withCta, voiceFor, captionPrompt, CTA_LINES } from '@/modules/feeds/wordpress/caption';

test('styles: about the chosen share of slots tests another style, always the same one for a slot', () => {
  const picks = Array.from({ length: 1000 }, (_, i) => styleFor(`slot${i}`, 'benefit', 20));
  const tests = picks.filter(p => p.test).length;
  assert.ok(tests > 140 && tests < 260, String(tests));
  assert.ok(picks.filter(p => !p.test).every(p => p.style === 'benefit'));
  assert.ok(picks.filter(p => p.test).every(p => p.style !== 'benefit'));
  assert.deepEqual(styleFor('slotX', 'benefit', 20), styleFor('slotX', 'benefit', 20));
});

test('styles: the best style is learned once it has enough posts', () => {
  const results = [...Array(6).fill({ style: 'question', relative: 1 }), ...Array(6).fill({ style: 'story', relative: 1.6 }), ...Array(2).fill({ style: 'promise', relative: 5 })];
  assert.equal(bestStyle(results).style, 'story');
  assert.equal(bestStyle([]).style, null);
});

test('captions: cleaned, and refused when unusable', () => {
  assert.equal(cleanCaption('« Envie d’un gratin ? »', 500), 'Envie d’un gratin ?');
  assert.equal(cleanCaption('Légende : Un régal.', 500), 'Un régal.');
  assert.equal(cleanCaption('Voir https://site.example', 500), null);
  assert.equal(cleanCaption('   ', 500), null);
});

test('voices: each channel keeps its own, or all use the chosen one', () => {
  assert.notEqual(voiceFor('per-page', 0), voiceFor('per-page', 1));
  assert.equal(voiceFor('chef', 3), 'chef');
  assert.match(captionPrompt({ channel: 'Page', voice: 'chef', style: 'story', question: true, emoji: 'more', title: 'Gratin', caption: '', ingredients: [] }).system, /question/);
});

test('first comment: a rotating call to action on top, within the limit', () => {
  const cta = ctaFor('rotate', 'slot1')!;
  assert.ok((Object.values(CTA_LINES) as string[]).includes(cta));
  assert.ok(withCta('Recette…', cta, 2000).startsWith(cta));
  assert.equal(withCta('x'.repeat(1990), cta, 2000), 'x'.repeat(1990));
  assert.equal(ctaFor('none', 'slot1'), null);
});

test('openings: the same first two words as a recent caption are caught, accents and case aside', async () => {
  const { opensLike } = await import('@/modules/feeds/wordpress/caption');
  assert.equal(opensLike('Vous aimez les feuilletés dorés ? 😋', ['Vous aimez les plats généreux ?']), 'Vous aimez');
  assert.equal(opensLike('ENVIE d’un gratin', ['Envie d’un gratin généreux']), 'ENVIE d’un');
  assert.equal(opensLike('En 85 minutes, un gratin', ['Vous aimez les plats']), null);
});

test('caption: the writer knows when the post goes out and may mention only that moment', async () => {
  const { captionPrompt, postingMoment } = await import('@/modules/feeds/wordpress/caption');
  assert.deepEqual(postingMoment('2026-11-18', 20), { weekday: 'mercredi', moment: 'soir' });
  assert.deepEqual(postingMoment('2026-11-22', 8), { weekday: 'dimanche', moment: 'matin' });
  const base = { channel: 'Cuisine', voice: 'warm' as never, style: 'question' as never, question: true, emoji: 'few' as const, title: 'Pains aux raisins', caption: '', ingredients: [] };
  assert.match(captionPrompt({ ...base, when: postingMoment('2026-11-18', 20) }).system, /goes out on mercredi soir \(French time\)\. If you mention a day/);
  assert.match(captionPrompt(base).system, /Do not mention a weekday or a time of day/);
});
