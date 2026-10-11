import Anthropic from '@anthropic-ai/sdk';
import { AiGenerationKind, Locale } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { errors } from './errors';

/**
 * AI writing help for the composer.
 *
 * Two deliberate constraints:
 *
 * 1. **Nothing is ever published straight from the model.** The output lands in
 *    the composer's textarea for a human to edit. There is no path from a
 *    generation to a Facebook Page that does not pass through someone
 *    pressing Schedule.
 *
 * 2. **Every call is logged with token counts**, and capped per workspace per
 *    hour. An agency with a stuck client-side loop should hit a limit, not an
 *    invoice.
 */

const MAX_OUTPUT_TOKENS = 1024;
/** A week of posts needs room for seven of them. */
const PLAN_OUTPUT_TOKENS = 3000;

export type Tone = 'friendly' | 'professional' | 'playful' | 'urgent' | 'informative';

export const TONES: Tone[] = ['friendly', 'professional', 'playful', 'urgent', 'informative'];

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!env.anthropicApiKey) throw errors.aiNotConfigured();
  client ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

export function aiAvailable(): boolean {
  return Boolean(env.anthropicApiKey);
}

/** Refuse once a workspace has burned through its hourly allowance. */
/**
 * The only guard on what this costs.
 *
 * Checked before the call and recorded after it, so several requests arriving
 * together can all pass a check that none of them has yet been counted
 * against. Left that way deliberately: the overshoot is bounded by how many
 * people press the button at the same moment, and the alternative — reserving
 * a row before calling — bills a workspace for generations that failed. A cost
 * guard that is occasionally generous beats one that charges for nothing.
 *
 * Note the related trade in `complete`: a failed audit write is swallowed so
 * nobody loses their draft, which also means that generation is never counted.
 */
async function assertWithinRateLimit(workspaceId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const used = await prisma.aiGeneration.count({
    where: { workspaceId, createdAt: { gte: since } },
  });
  if (used >= env.aiRateLimitPerHour) throw errors.aiRateLimited();
}

function systemPrompt(options: {
  locale: Locale;
  tone: string | null;
  brandVoice: string | null;
}): string {
  const language = options.locale === Locale.fr ? 'French' : 'English';

  return [
    'You write short social media posts for Facebook Pages on behalf of a business.',
    `Write in ${language}.`,
    '',
    'Rules:',
    '- Return only the post text. No preamble, no explanation, no surrounding quotes.',
    '- Keep it under 80 words unless the brief clearly asks for more.',
    '- Do not invent facts, prices, dates, statistics or claims that are not in the brief.',
    '- Do not add hashtags unless the brief asks for them.',
    '- Do not include a link; the scheduler attaches links separately.',
    options.tone ? `- Tone: ${options.tone}.` : '',
    options.brandVoice ? `\nHow this brand sounds:\n${options.brandVoice}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface GenerationResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

async function complete(options: {
  workspaceId: string;
  userId: string;
  kind: AiGenerationKind;
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<GenerationResult> {
  await assertWithinRateLimit(options.workspaceId);

  const model = env.aiModel;
  const response = await anthropic().messages.create({
    model,
    max_tokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
    system: options.system,
    messages: [{ role: 'user', content: options.prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const result: GenerationResult = {
    text,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  try {
    await prisma.aiGeneration.create({
      data: {
        workspaceId: options.workspaceId,
        userId: options.userId,
        kind: options.kind,
        prompt: options.prompt.slice(0, 4000),
        output: text.slice(0, 4000),
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  } catch (error) {
    // Losing the audit row must not lose the user their draft.
    console.error('[ai] could not record generation', error);
  }

  return result;
}

/** Write a post from a short brief. */
export async function generateCaption(options: {
  workspaceId: string;
  userId: string;
  brief: string;
  tone?: string | null;
  brandVoice?: string | null;
  locale: Locale;
}): Promise<GenerationResult> {
  return complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.generate,
    system: systemPrompt({
      locale: options.locale,
      tone: options.tone ?? null,
      brandVoice: options.brandVoice ?? null,
    }),
    prompt: `Write a Facebook post about:\n\n${options.brief}`,
  });
}

/** Rewrite text the user has already drafted, keeping their meaning. */
export async function improveCaption(options: {
  workspaceId: string;
  userId: string;
  draft: string;
  tone?: string | null;
  brandVoice?: string | null;
  locale: Locale;
}): Promise<GenerationResult> {
  return complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.improve,
    system: systemPrompt({
      locale: options.locale,
      tone: options.tone ?? null,
      brandVoice: options.brandVoice ?? null,
    }),
    prompt: [
      'Rewrite this Facebook post so it reads better.',
      'Keep the same meaning and every concrete detail — do not add or remove facts.',
      '',
      options.draft,
    ].join('\n'),
  });
}

/**
 * Hashtags for a post: a handful that people actually search, not a wall.
 * Returned for the person to pick from; nothing is added on its own.
 */
export async function suggestHashtags(options: {
  workspaceId: string;
  userId: string;
  text: string;
  brandVoice?: string | null;
  locale: Locale;
}): Promise<string[]> {
  const result = await complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.hashtags,
    system: [
      'You suggest hashtags for Facebook Page posts.',
      `The audience reads ${options.locale === Locale.fr ? 'French' : 'English'}; use hashtags in that language where natural.`,
      'Return 8 to 12 hashtags, one per line, each starting with #, no explanations.',
      'Prefer specific, commonly used tags over invented ones. No spaces or punctuation inside a tag.',
      options.brandVoice ? `\nAbout the brand:\n${options.brandVoice}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    prompt: options.text,
  });
  return parseHashtags(result.text);
}

/** `#a #b`, one per line or not, de-duplicated, without the junk around them. */
export function parseHashtags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const match of text.matchAll(/#[\p{L}\p{N}_]{2,50}/gu)) {
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(match[0]);
  }
  return tags.slice(0, 15);
}

export interface PlannedPost {
  /** 0 = the first day of the plan. */
  day: number;
  time: string;
  text: string;
}

/**
 * A week of posts from one brief: varied in angle and format, spread over the
 * days, each written in the Page's voice. They become drafts — someone still
 * reads, edits and schedules every one.
 */
export async function planWeek(options: {
  workspaceId: string;
  userId: string;
  brief: string;
  count: number;
  days: number;
  pageName: string;
  bestTimes?: string[];
  brandVoice?: string | null;
  tone?: string | null;
  locale: Locale;
}): Promise<PlannedPost[]> {
  const result = await complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.plan,
    maxTokens: PLAN_OUTPUT_TOKENS,
    system: [
      systemPrompt({ locale: options.locale, tone: options.tone ?? null, brandVoice: options.brandVoice ?? null }),
      '',
      `You are planning ${options.count} posts for the Facebook Page "${options.pageName}" over ${options.days} days.`,
      'Vary the angle: a tip, a question, behind the scenes, an offer, social proof, a story. Never repeat an opening.',
      options.bestTimes?.length ? `Times that work well for this Page: ${options.bestTimes.join(', ')}.` : 'Spread them between 08:00 and 20:00.',
      'Answer with JSON only: an array of objects {"day": 0-based day number, "time": "HH:mm", "text": "the post"}.',
    ].join('\n'),
    prompt: options.brief,
  });
  return parsePlan(result.text, options.days, options.count);
}

/** The model's JSON, made safe: days in range, real times, non-empty texts. */
export function parsePlan(text: string, days: number, count: number): PlannedPost[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => entry as { day?: unknown; time?: unknown; text?: unknown })
    .filter((entry) => typeof entry.text === 'string' && entry.text.trim().length > 0)
    .map((entry) => {
      const day = Math.min(days - 1, Math.max(0, Math.round(Number(entry.day) || 0)));
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(entry.time ?? ''));
      const hour = match ? Math.min(23, Number(match[1])) : 10;
      const minute = match ? Math.min(59, Number(match[2])) : 0;
      return { day, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, text: String(entry.text).trim().slice(0, 5000) };
    })
    .slice(0, count);
}

/** Spend over the last 30 days, for the settings screen. */
export async function usageSummary(workspaceId: string): Promise<{
  generations: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.aiGeneration.aggregate({
    where: { workspaceId, createdAt: { gte: since } },
    _count: true,
    _sum: { inputTokens: true, outputTokens: true },
  });

  return {
    generations: result._count,
    inputTokens: result._sum.inputTokens ?? 0,
    outputTokens: result._sum.outputTokens ?? 0,
  };
}
