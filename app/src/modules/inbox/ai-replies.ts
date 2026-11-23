import { z } from 'zod';
import { matchesModerationRule } from './moderation';

/**
 * AI auto-replies to comments and Messenger messages (2026-11-17, owner's choices by form): comments and messages;
 * everything except negative, sensitive and spam, which are left for a person (2026-11-21, owner: a comment read as
 * negative goes to the AI, which replies only to a calm remark about the recipe); sent only once nobody on the team has
 * replied for the chosen wait (30 minutes); no daily limit. Pure parts: settings, the prompt and reading the answer.
 */
export const AI_REPLY_TONES = ['friendly', 'short', 'expert'] as const;
export type AiReplyTone = (typeof AI_REPLY_TONES)[number];
export const AI_REPLY_DELAYS = [15, 30, 60, 120] as const;
/** Messenger loops: past this many AI replies in one conversation in 24 h, a person takes over. */
export const AI_REPLIES_PER_CONVERSATION_DAY = 3;

const channelId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const aiRepliesSchema = z.object({
  enabled: z.boolean(), comments: z.boolean(), messages: z.boolean(),
  delayMinutes: z.number().int().refine(value => (AI_REPLY_DELAYS as readonly number[]).includes(value)),
  targetIds: z.array(channelId).max(500), tone: z.enum(AI_REPLY_TONES),
}).strict().refine(value => !value.enabled || value.comments || value.messages, { message: 'Choose comments, messages or both.' });
export type AiRepliesSettings = z.infer<typeof aiRepliesSchema>;
export const AI_REPLIES_DEFAULTS: AiRepliesSettings = { enabled: false, comments: true, messages: true, delayMinutes: 30, targetIds: [], tone: 'friendly' };

export type AiReplyContext = {
  kind: 'comment' | 'message'; channel: string; voice: string | null; author: string | null; text: string;
  /** The inbox's own reading of the text; a comment read as negative is answered only when it is a calm remark. */
  sentiment?: string | null;
  /** The post a comment is under (its caption, then the recipe from its first comment). */
  post?: string | null;
  /** The only link a reply may contain (the recipe page), when known. */
  link?: string | null;
  /** Earlier messages of a Messenger conversation, oldest first. */
  history?: ReadonlyArray<{ from: 'visitor' | 'page'; text: string }>;
  /** The page's latest AI replies, newest first: a new reply must not reuse their wording. */
  recent?: readonly string[];
};

const TONES: Record<AiReplyTone, string> = {
  friendly: 'warm and friendly, like the person who runs the page',
  short: 'short and kind, one sentence',
  expert: 'helpful and precise, like a cook giving a tip',
};

export function aiReplyPrompt(c: AiReplyContext, tone: AiReplyTone): { system: string; prompt: string } {
  const where = c.kind === 'comment' ? 'a public comment under one of its posts' : 'a private Messenger message sent to the page';
  const system = [
    `You answer, on behalf of the Facebook page « ${c.channel} », ${where}. First decide what to do:`,
    '- "handoff" when the person complains, is angry, upset or worried, reports a problem with an order or the page, mentions health, allergy, safety, money, an order, legal matters or personal data, or anything a person from the page should handle.',
    '- "skip" when it is spam, an advert, a link to something else, nonsense, or needs no answer (only a friend tagged, only an emoji).',
    '- "reply" otherwise: thanks, praise and questions about the content. A calm correction or extra detail about the recipe (an ingredient, a technique, a name) is a reply too: thank them warmly for the precision and acknowledge it in a few words, without arguing and without inventing anything.',
    `For a reply: write in the same language as the person. Tone: ${TONES[tone]}. ${c.kind === 'comment' ? 'One or two short sentences.' : 'At most three short sentences.'} At most one emoji.`,
    c.sentiment === 'negative' ? 'This comment reads as negative. Reply only when it is a calm remark, preference or correction about the recipe; anything critical of the page, the person or the result, or upset in tone, is a "handoff".' : '',
    c.voice ? `The page's own voice: ${c.voice.slice(0, 400)}` : '',
    // « Merci beaucoup, ça nous fait plaisir ! 😊 » three times in eight replies (2026-11-23): the same line under every
    // post reads as a robot. The page's latest replies are shown so a new one is worded differently.
    c.recent?.length ? `The page's latest replies, which must not be repeated: do not reuse their opening words or phrasing, and reply to what this person actually said:\n${c.recent.slice(0, 8).map(line => `- ${line.slice(0, 160)}`).join('\n')}` : '',
    'Use only the facts given below. If the answer is not there, say so kindly and suggest something simple and safe. Never invent a price, a promise, a delivery or a health claim.',
    // « Du beurre sur la photo mais pas dans la recette ? » got « … via la pâte feuilletée pur beurre » (2026-11-22).
    'A question or remark about an ingredient, a quantity, a cooking time or a step is answered only with what the post and recipe below say, word for word in substance; when they do not say it, the decision is "handoff". Never explain a photo or guess what is in it.',
    c.link ? `If they ask for the recipe or the link, give this link and no other: ${c.link}` : 'Do not include any link.',
    // « Où est la recette je v ai dis SVP 😱 » was handed off as annoyed (2026-11-22): asking for the recipe is answered.
    c.link ? 'Someone asking for the recipe or the link always gets a "reply" with the link, kindly, even when they sound impatient or annoyed about waiting for it.' : '',
    // A name says nothing certain about the person (2026-11-17, same rule as the recipe reply drafts).
    'Never guess whether the person is a man or a woman: no gendered agreements about them (write « merci pour votre message », not « merci d’être passé·e »).',
    'Use their first name only if it reads naturally. Do not say you are an AI, but if they ask whether a robot is answering, say this reply was written with the help of AI.',
    'Answer with JSON only, one of: {"decision":"reply","reply":"..."} {"decision":"handoff","reason":"..."} {"decision":"skip","reason":"..."}',
    'A reason is a few words for the page\'s team, written in French.',
  ].filter(Boolean).join('\n');
  const prompt = [
    c.post ? `The post: ${c.post.slice(0, 1500)}` : '',
    ...(c.history?.length ? ['Earlier in this conversation:', ...c.history.slice(-10).map(line => `${line.from === 'page' ? 'Page' : 'Visitor'}: ${line.text.slice(0, 400)}`)] : []),
    `${c.kind === 'comment' ? 'Comment' : 'Message'} from ${c.author || 'a visitor'}: ${c.text.slice(0, 1000)}`,
  ].filter(Boolean).join('\n');
  return { system, prompt };
}

export type AiDecision = { decision: 'reply'; reply: string } | { decision: 'handoff' | 'skip'; reason: string };

/** The AI's answer read as a decision; null when it is unusable. A reply may only carry the allowed link. */
export function parseAiReply(raw: string, link: string | null | undefined, max = 1000): AiDecision | null {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try { value = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const answer = value as { decision?: unknown; reply?: unknown; reason?: unknown };
  if (answer.decision === 'handoff' || answer.decision === 'skip') return { decision: answer.decision, reason: typeof answer.reason === 'string' ? answer.reason.trim().slice(0, 300) : '' };
  if (answer.decision !== 'reply' || typeof answer.reply !== 'string') return null;
  const reply = answer.reply.trim().replace(/^[«"]\s?|\s?[»"]$/g, '').trim();
  if (!reply || reply.length > max) return null;
  const links = reply.match(/https?:\/\/\S+/g) ?? [];
  if (links.some(found => !link || found.replace(/[).,!?]+$/, '') !== link)) return null;
  return { decision: 'reply', reply };
}

/**
 * Decided without asking the AI: links and phone numbers are spam, a private message already read as negative goes to a
 * person. A negative comment is left to the AI with a stricter rule (2026-11-21). Null when the AI decides.
 */
export function precheck(text: string, sentiment: string | null | undefined, kind: 'comment' | 'message' = 'message'): 'spam' | 'negative' | null {
  if (matchesModerationRule({ match: 'links', keywords: [] }, text) || matchesModerationRule({ match: 'phones', keywords: [] }, text)) return 'spam';
  if (sentiment === 'negative' && kind === 'message') return 'negative';
  return null;
}
