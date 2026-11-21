/**
 * Captions and first comments the autopilot writes (2026-11-16, docs/autopilot-plan.md): a different caption on every
 * channel, in that channel's voice, opening with a hook style; the best style is learned from results. Pure.
 */
import type { AutopilotSettings } from './autopilot';

export const HOOK_STYLES = ['question', 'benefit', 'story', 'curiosity', 'promise'] as const;
export type HookStyle = typeof HOOK_STYLES[number];
const STYLE_TEXT: Record<HookStyle, string> = {
  question: 'Open with a short question the reader answers yes to.',
  benefit: 'Open with the concrete benefit: time, ease or result.',
  story: 'Open with one concrete moment around the dish: a smell, a sound, a gesture, a time of day.',
  curiosity: 'Open with a curiosity hook: a secret, a tip, a surprise.',
  promise: 'Open with a confident promise about the result.',
};
export const VOICES = {
  warm: 'warm and family, like a friend sharing a favourite dish',
  short: 'short and punchy, very few words per line',
  chef: 'a chef giving one practical tip',
  gourmand: 'gourmand and sensory: texture, smell, crunch',
  everyday: 'practical everyday cooking for busy weeknights',
} as const;
export type Voice = keyof typeof VOICES;

/** A channel's voice: the one chosen, or with « per-page » a stable voice of its own. */
export function voiceFor(setting: AutopilotSettings['captions']['voice'], channelIndex: number): Voice {
  if (setting !== 'per-page') return setting;
  const order: Voice[] = ['warm', 'gourmand', 'everyday', 'short', 'chef'];
  return order[channelIndex % order.length]!;
}

/** Stable 0–99 number from a text (a slot key), so a slot always gets the same choices. */
export function bucket(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100;
}

/** The style a slot's caption opens with: the best known style, or for `share`% of slots another one being tested. */
export function styleFor(seed: string, preferred: HookStyle | null, share: number): { style: HookStyle; test: boolean } {
  const best = preferred ?? 'question';
  const b = bucket(seed);
  if (b >= share) return { style: best, test: false };
  const others = HOOK_STYLES.filter(style => style !== best);
  return { style: others[b % others.length]!, test: true };
}

/** The style that did best: average result per style (1 = usual), with at least `min` posts each. */
export function bestStyle(results: ReadonlyArray<{ style?: string | null; relative: number }>, min = 5): { style: HookStyle | null; stats: Record<string, { posts: number; average: number }> } {
  const stats: Record<string, { posts: number; average: number }> = {};
  for (const r of results) {
    if (!r.style || !(HOOK_STYLES as readonly string[]).includes(r.style)) continue;
    const s = stats[r.style] ?? { posts: 0, average: 0 };
    s.average = (s.average * s.posts + r.relative) / (s.posts + 1); s.posts++; stats[r.style] = s;
  }
  const ranked = Object.entries(stats).filter(([, s]) => s.posts >= min).sort((a, b) => b[1].average - a[1].average);
  return { style: (ranked[0]?.[0] as HookStyle | undefined) ?? null, stats };
}

export function captionPrompt(input: { channel: string; voice: Voice; style: HookStyle; question: boolean; emoji: AutopilotSettings['captions']['emoji']; title: string; caption: string; ingredients: readonly string[]; avoid?: readonly string[];
  /** What works on this page, from its memory (2026-11-18). */
  guidance?: readonly string[];
  /** When the post goes out, in the page's time (2026-11-20: « Le dimanche matin… » went out on a Wednesday evening). */
  when?: { weekday: string; moment: string } }): { system: string; prompt: string } {
  const emoji = input.emoji === 'none' ? 'Use no emoji.' : input.emoji === 'few' ? 'Use one or two emojis.' : 'Use several fitting emojis to make it lively, without overdoing it.';
  const system = [
    `You write the Facebook caption of one recipe for the French page « ${input.channel} ».`,
    `Voice: ${VOICES[input.voice]}.`,
    STYLE_TEXT[input.style],
    'Write in French, 2 to 4 short lines, about 40 to 70 words.',
    emoji,
    input.question ? 'End with one short question that invites people to comment.' : 'Do not end with a question.',
    'No link, no hashtag, no price. Never invent an ingredient or a step that is not in the recipe. Do not mention that you are an AI.',
    `Avoid worn-out phrases: ${CLICHES.map(phrase => `« ${phrase} »`).join(', ')}.`,
    input.when ? `This post goes out on ${input.when.weekday} ${input.when.moment} (French time). If you mention a day or a time of day, it must be exactly this one; otherwise mention none (no other weekday, no « ce matin » in the evening, no « ce soir » in the morning).` : 'Do not mention a weekday or a time of day.',
    ...(input.guidance ?? []),
    'Answer with the caption only.',
    // Channels must not read alike (2026-11-16): openings written lately are listed so this one differs.
    ...(input.avoid?.length ? ['Your first words must differ from these recent openings (do not start with the same word):', ...input.avoid.slice(0, 10).map(text => `- ${text.slice(0, 90)}`)] : []),
  ].join('\n');
  const prompt = [`Recipe: ${input.title}`, input.caption ? `About it: ${input.caption.slice(0, 600)}` : '', input.ingredients.length ? `Ingredients: ${input.ingredients.slice(0, 10).join(', ').slice(0, 500)}` : ''].filter(Boolean).join('\n');
  return { system, prompt };
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/** The posting moment in French words, from a local date (YYYY-MM-DD) and hour. */
export function postingMoment(date: string, hour: number): { weekday: string; moment: string } {
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
  const moment = hour < 11 ? 'matin' : hour < 14 ? 'midi' : hour < 18 ? 'après-midi' : 'soir';
  return { weekday, moment };
}

/** True when a caption starts with the same two words as one of the recent openings. */
/**
 * Phrases the captions kept repeating on every Page (2026-11-21: « La famille se retrouve autour de la table… » opened
 * about half of the queued captions in several forms). The prompt names them; a caption still using one is rewritten once.
 */
export const CLICHES = ['la famille se retrouve', 'on se retrouve autour', 'autour de la table', 'les sourires', 'tout le monde se régale', 'met tout le monde d’accord'] as const;
const foldText = (text: string) => ` ${text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
/** The first worn-out phrase a caption uses, as written in CLICHES; null when none. */
export function clicheIn(caption: string): string | null {
  const text = foldText(caption);
  return CLICHES.find(phrase => text.includes(foldText(phrase))) ?? null;
}

export function opensLike(caption: string, openings: readonly string[]): string | null {
  const head = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9’' ]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  const mine = head(caption);
  return mine.split(' ').length === 2 && openings.some(opening => head(opening) === mine) ? caption.trim().split(/\s+/).slice(0, 2).join(' ') : null;
}

/** The AI's caption, cleaned; null when it is unusable (empty, too long, a link). */
export function cleanCaption(raw: string, max: number): string | null {
  let text = raw.trim().replace(/^```[a-z]*\s*|```$/g, '').trim();
  if (/^« ?[\s\S]*?» ?$/.test(text) || /^"[\s\S]*"$/.test(text)) text = text.replace(/^[«"]\s?|\s?[»"]$/g, '').trim();
  text = text.replace(/^(caption|légende)\s*:\s*/i, '').trim();
  if (!text || text.length > max || /https?:\/\/|www\./i.test(text)) return null;
  return text;
}

/** Calls to action rotated at the top of the first comment (French pages). */
export const CTA_LINES = {
  save: '📌 Enregistrez cette recette pour la refaire plus tard !',
  tag: '👥 Identifiez la personne avec qui vous allez la cuisiner !',
  variant: '💬 Et vous, quelle est votre variante ? Dites-le en commentaire !',
  share: '❤️ Partagez-la à quelqu’un qui adore cuisiner !',
} as const;

export function ctaFor(mode: AutopilotSettings['comment']['cta'], seed: string): string | null {
  if (mode === 'none') return null;
  if (mode === 'save') return CTA_LINES.save;
  if (mode === 'tag') return CTA_LINES.tag;
  const lines = Object.values(CTA_LINES);
  return lines[bucket(`cta:${seed}`) % lines.length]!;
}

/** The first comment with its call to action on top, kept within the comment limit. */
export function withCta(comment: string, cta: string | null, max: number): string {
  if (!cta || comment.includes(cta)) return comment;
  const joined = `${cta}\n\n${comment}`;
  return joined.length <= max ? joined : comment;
}
