// AI reply drafts for comments on recipe posts (2026-11-16): stored for the Inbox, never sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReply, draftRecipeReplies, replyPrompt, type ReplyPorts, type DraftCandidate } from '@/modules/feeds/server/wordpress-replies';
import { AUTOPILOT_DEFAULTS } from '@/modules/feeds/wordpress/autopilot';

const comment: DraftCandidate = { id: 'c1', message: 'Je peux remplacer la crème ?', fromName: 'Julie', channel: 'Recettes - Faciles', title: 'Gratin dauphinois', permalink: 'https://site.example/gratin', recipe: 'Ingrédients : pommes de terre, crème, lait…' };

test('reply drafts: a link survives only when it is the recipe’s own', () => {
  assert.equal(cleanReply('« Oui Julie, du lait entier marche très bien 😊 »', comment.permalink), 'Oui Julie, du lait entier marche très bien 😊');
  assert.equal(cleanReply('La recette est ici : https://site.example/gratin', comment.permalink), 'La recette est ici : https://site.example/gratin');
  assert.equal(cleanReply('Regardez https://ailleurs.example', comment.permalink), null);
  assert.equal(cleanReply('', comment.permalink), null);
});

test('reply drafts: the prompt carries the comment, the recipe and the tone', () => {
  const { system, prompt } = replyPrompt(comment, 'friendly');
  assert.match(system, /Recettes - Faciles/); assert.match(system, /warm and friendly/); assert.match(system, /site\.example\/gratin/);
  assert.match(prompt, /Je peux remplacer la crème/); assert.match(prompt, /pommes de terre/);
});

test('reply drafts: each waiting comment gets one draft; an AI refusal stops the run without sending anything', async () => {
  const saved: Array<[string, string]> = [];
  let calls = 0;
  const ports: ReplyPorts = {
    async waiting() { return [comment, { ...comment, id: 'c2' }, { ...comment, id: 'c3' }]; },
    async write() { calls++; if (calls === 2) throw new Error('hourly limit'); return 'Oui, du lait entier marche très bien 😊'; },
    async save(id, draft) { saved.push([id, draft]); },
  };
  const drafted = await draftRecipeReplies({ sourceId: 's', actor: { userId: 'u', workspaceId: 'w' }, pilot: AUTOPILOT_DEFAULTS, now: new Date() }, ports);
  assert.equal(drafted, 1);
  assert.deepEqual(saved.map(([id]) => id), ['c1']);
  const off = await draftRecipeReplies({ sourceId: 's', actor: { userId: 'u', workspaceId: 'w' }, pilot: { ...AUTOPILOT_DEFAULTS, replies: { enabled: false, tone: 'friendly' } }, now: new Date() }, ports);
  assert.equal(off, 0);
});

test('reply drafts: recent drafts are listed so new ones do not repeat them', async () => {
  const systems: string[] = [];
  const ports: ReplyPorts = {
    async waiting() { return [comment, { ...comment, id: 'c2' }]; },
    async recent() { return ['Avec plaisir, merci à vous ! 😊']; },
    async write(_a, system) { systems.push(system); return systems.length === 1 ? 'Merci Julie, ravie que ça vous plaise !' : 'Bonne dégustation à vous !'; },
    async save() {},
  };
  await draftRecipeReplies({ sourceId: 's', actor: { userId: 'u', workspaceId: 'w' }, pilot: AUTOPILOT_DEFAULTS, now: new Date() }, ports);
  assert.match(systems[0]!, /Avec plaisir, merci à vous/);
  assert.match(systems[1]!, /Merci Julie, ravie/, 'a draft written in this run is avoided by the next one');
});
