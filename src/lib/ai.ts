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
}): Promise<GenerationResult> {
  await assertWithinRateLimit(options.workspaceId);

  const model = env.aiModel;
  const response = await anthropic().messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
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
