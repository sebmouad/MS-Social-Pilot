import { AiGenerationKind, Locale } from '@prisma/client';

import { prisma } from './prisma';
import { resolveAiModel } from './ai-models';
import { activeAiProvider, generateWith, providerKey } from './ai-providers';
import { costUsd, priceFor, type AiSpendView } from './ai-prices';
import { env } from './env';
import { errors } from './errors';
import { keepTokens } from './translation';

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

export function aiAvailable(): boolean {
  return activeAiProvider() !== null;
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

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Every workspace's priced spend since the 1st of this month (UTC). */
async function monthSpendUsd(now: Date): Promise<number> {
  const result = await prisma.aiGeneration.aggregate({
    where: { createdAt: { gte: startOfMonth(now) } },
    _sum: { costUsd: true },
  });
  return result._sum.costUsd ?? 0;
}

/**
 * Root's monthly budget covers the whole installation, because it is root's
 * key that gets billed. Same check-then-record trade as the rate limit: calls
 * already in flight when the budget is reached can overshoot it by their cost.
 */
async function assertWithinBudget(): Promise<void> {
  const budget = env.aiMonthlyBudgetUsd;
  if (budget > 0 && (await monthSpendUsd(new Date())) >= budget) throw errors.aiBudgetReached();
}

/** The audience a post is for (H0): BCP-47 languages and ISO country codes. */
export interface AiAudience {
  languages: string[];
  countries: string[];
}

/** The language to write in: the audience's first, else the workspace's. */
function writingLanguage(locale: Locale, audience?: AiAudience | null): string {
  const tag = audience?.languages[0];
  if (tag) {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
    } catch {
      return tag;
    }
  }
  return locale === Locale.fr ? 'French' : 'English';
}

function audienceLine(audience?: AiAudience | null): string {
  if (!audience?.countries.length) return '';
  const regions = new Intl.DisplayNames(['en'], { type: 'region' });
  return `The audience is mainly in: ${audience.countries.map((code) => regions.of(code) ?? code).join(', ')}.`;
}

function systemPrompt(options: {
  locale: Locale;
  tone: string | null;
  brandVoice: string | null;
  audience?: AiAudience | null;
}): string {
  const language = writingLanguage(options.locale, options.audience);

  return [
    'You write short social media posts for Facebook Pages on behalf of a business.',
    `Write in ${language}.`,
    audienceLine(options.audience),
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
  await assertWithinBudget();

  const provider = activeAiProvider();
  const apiKey = provider ? providerKey(provider) : null;
  if (!provider || !apiKey) throw errors.aiNotConfigured();

  const model = await resolveAiModel();
  const generated = await generateWith(provider, apiKey, {
    model,
    system: options.system,
    prompt: options.prompt,
    maxTokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
  });
  const text = generated.text;

  const result: GenerationResult = {
    text,
    model,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
  };

  const price = priceFor(model, env.aiPriceOverrides);
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
        provider,
        costUsd: price ? costUsd(price, result.inputTokens, result.outputTokens) : null,
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
  audience?: AiAudience | null;
}): Promise<GenerationResult> {
  return complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.generate,
    system: systemPrompt({
      locale: options.locale,
      tone: options.tone ?? null,
      brandVoice: options.brandVoice ?? null,
      audience: options.audience,
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
  audience?: AiAudience | null;
}): Promise<GenerationResult> {
  return complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.improve,
    system: systemPrompt({
      locale: options.locale,
      tone: options.tone ?? null,
      brandVoice: options.brandVoice ?? null,
      audience: options.audience,
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
 * The post in another language, for the Pages whose audience reads it (G11).
 * Links, hashtags and @mentions stay exactly as written.
 */
export async function translateCaption(options: {
  workspaceId: string;
  userId: string;
  text: string;
  /** BCP-47 tag. */
  language: string;
  countries?: string[];
  brandVoice?: string | null;
}): Promise<GenerationResult> {
  const result = await complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.translate,
    system: [
      'You translate social media posts for Facebook Pages.',
      `Translate into ${writingLanguage(Locale.en, { languages: [options.language], countries: [] })} (${options.language}).`,
      audienceLine({ languages: [], countries: options.countries ?? [] }),
      '',
      'Rules:',
      '- Return only the translated post. No preamble, no explanation, no surrounding quotes.',
      '- Keep every link, hashtag, @mention, emoji and line break exactly as in the original.',
      '- Keep the meaning and every concrete detail; do not add or remove facts.',
      '- Write naturally for that audience rather than word for word.',
      options.brandVoice ? `\nHow this brand sounds:\n${options.brandVoice}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    prompt: options.text,
  });
  return { ...result, text: keepTokens(options.text, result.text.trim()) };
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
  audience?: AiAudience | null;
}): Promise<string[]> {
  const result = await complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.hashtags,
    system: [
      'You suggest hashtags for Facebook Page posts.',
      `The audience reads ${writingLanguage(options.locale, options.audience)}; use hashtags in that language where natural.`,
      audienceLine(options.audience),
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
  audience?: AiAudience | null;
}): Promise<PlannedPost[]> {
  const result = await complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.plan,
    maxTokens: PLAN_OUTPUT_TOKENS,
    system: [
      systemPrompt({ locale: options.locale, tone: options.tone ?? null, brandVoice: options.brandVoice ?? null, audience: options.audience }),
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

/** The figures a report recap may talk about: this period against the one before. */
export interface RecapFigures {
  posts: number;
  reach: number;
  engagement: number;
  /** The best posts' openings with their interactions. */
  topPosts: Array<{ text: string; engagement: number }>;
}

/**
 * Three or four plain sentences for the top of a scheduled report: what
 * changed against the period before, and what in the figures explains it.
 * Only these figures go to the model, and it is told to name no cause they
 * do not show.
 */
export async function writeReportRecap(options: {
  workspaceId: string;
  userId: string;
  pageName: string;
  periodLabel: string;
  current: RecapFigures;
  previous: RecapFigures;
  locale: Locale;
}): Promise<string> {
  const language = options.locale === Locale.fr ? 'French' : 'English';
  const result = await complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.recap,
    maxTokens: 400,
    system: [
      'You summarise a social media Page report for a busy business owner.',
      `Write in ${language}, three or four short sentences, plain words, no headings, no lists, no emoji.`,
      'Say what went up or down against the previous period, with the numbers, then what in the figures explains it (number of posts, the best posts).',
      'Only use the figures given. Never invent a cause, an event, a statistic or advice the figures do not support.',
      'If the previous period has no figures, describe this period alone.',
    ].join('\n'),
    prompt: JSON.stringify({ page: options.pageName, period: options.periodLabel, current: options.current, previous: options.previous }),
  });
  return result.text.trim().slice(0, 1200);
}

export type Sentiment = 'negative' | 'neutral' | 'positive';
const SENTIMENTS: Sentiment[] = ['negative', 'neutral', 'positive'];

/** The mood of a batch of comments (H15), in the order given. */
export async function readCommentSentiments(options: {
  workspaceId: string;
  userId: string;
  comments: string[];
}): Promise<Array<Sentiment | null>> {
  const result = await complete({
    workspaceId: options.workspaceId,
    userId: options.userId,
    kind: AiGenerationKind.sentiment,
    maxTokens: 20 + options.comments.length * 6,
    system: [
      'You read comments left on a business Facebook Page, in any language.',
      'For each comment, say whether it is negative (a complaint, anger, a bad experience, an insult), positive, or neutral (a question, a tag, anything else).',
      'Answer with JSON only: an array of the words "negative", "neutral" or "positive", one per comment, in the same order.',
    ].join('\n'),
    prompt: JSON.stringify(options.comments.map((text) => text.slice(0, 500))),
  });
  return parseSentiments(result.text, options.comments.length);
}

/** The model's answer, made safe: one known word per comment, else null. */
export function parseSentiments(text: string, count: number): Array<Sentiment | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  } catch {
    parsed = null;
  }
  const list = Array.isArray(parsed) && parsed.length === count ? parsed : [];
  return Array.from({ length: count }, (_, index) => {
    const word = list[index];
    return SENTIMENTS.includes(word as Sentiment) ? (word as Sentiment) : null;
  });
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

/**
 * What AI has cost, for root's Configuration screen: this month against the
 * budget, and the last 30 days by model and by workspace. Generations whose
 * price was unknown are counted apart instead of as $0.
 */
export async function aiSpend(now: Date = new Date()): Promise<AiSpendView> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const window = { createdAt: { gte: since } };
  const unpricedWindow = { ...window, costUsd: null };

  const [monthUsd, last30, models, unpricedModels, workspaces, unpricedWorkspaces] = await Promise.all([
    monthSpendUsd(now),
    prisma.aiGeneration.aggregate({ where: window, _sum: { costUsd: true } }),
    prisma.aiGeneration.groupBy({
      by: ['provider', 'model'],
      where: window,
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    prisma.aiGeneration.groupBy({ by: ['provider', 'model'], where: unpricedWindow, _count: true }),
    prisma.aiGeneration.groupBy({ by: ['workspaceId'], where: window, _count: true, _sum: { costUsd: true } }),
    prisma.aiGeneration.groupBy({ by: ['workspaceId'], where: unpricedWindow, _count: true }),
  ]);

  const names = new Map(
    (
      await prisma.workspace.findMany({
        where: { id: { in: workspaces.map((row) => row.workspaceId) } },
        select: { id: true, name: true },
      })
    ).map((workspace) => [workspace.id, workspace.name]),
  );
  const unpricedByModel = new Map(unpricedModels.map((row) => [`${row.provider}:${row.model}`, row._count]));
  const unpricedByWorkspace = new Map(unpricedWorkspaces.map((row) => [row.workspaceId, row._count]));
  const byCost = (a: { costUsd: number; generations: number }, b: { costUsd: number; generations: number }) =>
    b.costUsd - a.costUsd || b.generations - a.generations;

  return {
    monthUsd,
    last30Usd: last30._sum.costUsd ?? 0,
    budgetUsd: env.aiMonthlyBudgetUsd,
    byModel: models
      .map((row) => ({
        provider: row.provider,
        model: row.model,
        generations: row._count,
        unpriced: unpricedByModel.get(`${row.provider}:${row.model}`) ?? 0,
        inputTokens: row._sum.inputTokens ?? 0,
        outputTokens: row._sum.outputTokens ?? 0,
        costUsd: row._sum.costUsd ?? 0,
      }))
      .sort(byCost),
    byWorkspace: workspaces
      .map((row) => ({
        workspaceId: row.workspaceId,
        name: names.get(row.workspaceId) ?? row.workspaceId,
        generations: row._count,
        unpriced: unpricedByWorkspace.get(row.workspaceId) ?? 0,
        costUsd: row._sum.costUsd ?? 0,
      }))
      .sort(byCost),
  };
}
