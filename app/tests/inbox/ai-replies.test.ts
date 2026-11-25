// AI auto-replies (2026-11-17): settings, prompt, reading the AI's answer, and what is decided without the AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiRepliesSchema, aiReplyPrompt, parseAiReply, precheck, AI_REPLIES_DEFAULTS } from '@/modules/inbox/ai-replies';

test('ai replies: settings are off by default and must answer something when on', () => {
  assert.equal(AI_REPLIES_DEFAULTS.enabled, false);
  assert.equal(AI_REPLIES_DEFAULTS.delayMinutes, 30);
  assert.ok(aiRepliesSchema.safeParse({ ...AI_REPLIES_DEFAULTS, enabled: true }).success);
  assert.ok(!aiRepliesSchema.safeParse({ ...AI_REPLIES_DEFAULTS, enabled: true, comments: false, messages: false }).success);
  assert.ok(aiRepliesSchema.safeParse({ ...AI_REPLIES_DEFAULTS, comments: false, messages: false }).success, 'off with nothing chosen is fine');
  assert.ok(!aiRepliesSchema.safeParse({ ...AI_REPLIES_DEFAULTS, delayMinutes: 7 }).success);
  assert.ok(!aiRepliesSchema.safeParse({ ...AI_REPLIES_DEFAULTS, extra: 1 }).success);
});

test('ai replies: the answer is read as reply, handoff or skip; anything else is unusable', () => {
  assert.deepEqual(parseAiReply('```json\n{"decision":"reply","reply":"Merci Julie ! 😊"}\n```', null), { decision: 'reply', reply: 'Merci Julie ! 😊' });
  assert.deepEqual(parseAiReply('{"decision":"handoff","reason":"complaint"}', null), { decision: 'handoff', reason: 'complaint' });
  assert.deepEqual(parseAiReply('{"decision":"skip"}', null), { decision: 'skip', reason: '' });
  assert.equal(parseAiReply('Merci !', null), null);
  assert.equal(parseAiReply('{"decision":"reply","reply":""}', null), null);
  assert.equal(parseAiReply('{"decision":"maybe"}', null), null);
});

test('ai replies: a reply may carry only the recipe link', () => {
  const link = 'https://recettes.example/carbonnade';
  assert.equal(parseAiReply(`{"decision":"reply","reply":"La voici : ${link} !"}`, link)?.decision, 'reply');
  assert.equal(parseAiReply('{"decision":"reply","reply":"Voir https://ailleurs.example"}', link), null);
  assert.equal(parseAiReply(`{"decision":"reply","reply":"La voici : ${link}"}`, null), null);
});

test('ai replies: spam and negative messages are decided without the AI; a negative comment goes to the AI with a stricter rule', () => {
  assert.equal(precheck('Gagnez 500€ sur www.promo-facile.com', null), 'spam');
  assert.equal(precheck('Appelez le 06 12 34 56 78', null), 'spam');
  assert.equal(precheck('C’était immangeable', 'negative'), 'negative');
  assert.equal(precheck('C’était immangeable', 'negative', 'message'), 'negative');
  assert.equal(precheck('Je préférais avec de la pâte levée', 'negative', 'comment'), null);
  const strict = aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'Je préférais avec de la pâte levée', sentiment: 'negative' }, 'friendly').system;
  assert.match(strict, /reads as negative/);
  assert.doesNotMatch(aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'Merci', sentiment: 'positive' }, 'friendly').system, /reads as negative/);
  assert.equal(precheck('Merci pour la recette !', 'positive'), null);
});

test('ai replies: the prompt names the page, the decision rules, the link and the conversation', () => {
  const comment = aiReplyPrompt({ kind: 'comment', channel: 'Cuisine Qui Réunit', voice: null, author: 'Julie', text: 'On peut la congeler ?', post: 'Carbonnade flamande', link: 'https://recettes.example/c' }, 'friendly');
  assert.match(comment.system, /« Cuisine Qui Réunit »/);
  assert.match(comment.system, /"handoff"/);
  assert.match(comment.system, /Never guess whether the person is a man or a woman/);
  assert.match(comment.system, /speaks as « nous ».*« ravis »/);
  assert.match(comment.system, /give this link and no other: https:\/\/recettes\.example\/c/);
  assert.match(comment.prompt, /Comment from Julie: On peut la congeler \?/);
  const message = aiReplyPrompt({ kind: 'message', channel: 'P', voice: 'Tutoie les gens', author: null, text: 'Et pour 6 ?', history: [{ from: 'visitor', text: 'Bonjour' }, { from: 'page', text: 'Bonjour !' }] }, 'short');
  assert.match(message.system, /Do not include any link/);
  assert.match(message.system, /Tutoie les gens/);
  assert.match(message.prompt, /Visitor: Bonjour\nPage: Bonjour !\nMessage from a visitor: Et pour 6 \?/);
});

test('ai replies: the page\'s latest replies are shown so a new one is worded differently', () => {
  const recent = ['Merci beaucoup, ça nous fait plaisir ! 😊', 'Avec plaisir, merci pour votre message ! 😊'];
  const { system } = aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'J’adore', recent }, 'friendly');
  assert.match(system, /must not be repeated/);
  assert.match(system, /- Merci beaucoup, ça nous fait plaisir ! 😊\n- Avec plaisir, merci pour votre message ! 😊/);
  assert.doesNotMatch(aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'J’adore' }, 'friendly').system, /must not be repeated/);
});

test('AI replies: a calm correction about the recipe is answered with thanks; complaints still go to a person', () => {
  const { system } = aiReplyPrompt({ kind: 'comment', channel: 'Cuisine', voice: null, author: 'Marie', text: 'La pâte est levée feuilletée.' }, 'friendly');
  assert.match(system, /A calm correction or extra detail about the recipe .* is a reply too: thank them warmly for the precision/);
  assert.match(system, /"handoff" when the person complains, is angry/);
});

test('ai replies: a request for the recipe is always answered with the link, even when impatient', () => {
  const withLink = aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'Où est la recette SVP 😱', link: 'https://recettes.example/r', sentiment: 'negative' }, 'friendly').system;
  assert.match(withLink, /always gets a "reply" with the link/);
  const noLink = aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'Où est la recette ?' }, 'friendly').system;
  assert.doesNotMatch(noLink, /always gets a "reply" with the link/);
});

test('ai replies: ingredient, quantity, time and step questions are answered only from the recipe, else handed off', () => {
  const system = aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'Du beurre sur la photo ?' }, 'friendly').system;
  assert.match(system, /answered only with what the post and recipe below say/);
  assert.match(system, /Never explain a photo or guess what is in it/);
});

test('ai replies: a recipe question the post does not answer gets the full recipe link; without a link it goes to a person', () => {
  const linked = aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'Pour combien de personnes ?', link: 'https://recettes.example/r' }, 'friendly').system;
  assert.match(linked, /every detail is in the full recipe, with the link; never make the answer up/);
  assert.doesNotMatch(linked, /When the post below does not say it, the decision is "handoff"/);
  const bare = aiReplyPrompt({ kind: 'comment', channel: 'P', voice: null, author: null, text: 'Pour combien de personnes ?' }, 'friendly').system;
  assert.match(bare, /When the post below does not say it, the decision is "handoff"/);
  assert.match(bare, /Never explain a photo/);
});
