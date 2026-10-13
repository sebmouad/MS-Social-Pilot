import { z } from 'zod';

import { assertWithinBudget, assertWithinRateLimit } from './ai';
import { AiProviderError, providerKey } from './ai-providers';
import { errors } from './errors';
import { assertMonthlyRoom } from './plans';
import { VOICE_NAMES } from './voice-names';
import { prisma } from './prisma';

/**
 * A spoken version of a text, through OpenAI's speech models.
 *
 * The model is never typed here: it is the newest speech model the operator's
 * own key lists. The voices are the names OpenAI documents for its speech
 * endpoint (a setting of the call, not a model; there is no endpoint that
 * lists them). The audio is returned to the person to play or download: a
 * Facebook post cannot carry audio alone, so it is not kept in the library.
 */
export const VOICES = VOICE_NAMES;

export const voiceSchema = z.object({
  text: z.string().trim().min(3).max(2000),
  voice: z.enum(VOICES).default('marin'),
});

export function voiceAvailable(): boolean {
  return providerKey('openai') !== null;
}

/** The newest speech model this key may use, read from the provider; null when it lists none. */
export async function resolveVoiceModel(apiKey: string): Promise<string | null> {
  const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = (await response.json().catch(() => ({}))) as { data?: Array<{ id: string; created?: number }>; error?: { message?: string } };
  if (!response.ok) throw new AiProviderError(body.error?.message ?? `HTTP ${response.status}`, response.status);
  const models = (body.data ?? []).filter((model) => /tts/i.test(model.id)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return models[0]?.id ?? null;
}

export async function speak(options: { workspaceId: string; userId: string; text: string; voice: (typeof VOICES)[number] }): Promise<Buffer> {
  const apiKey = providerKey('openai');
  if (!apiKey) throw errors.aiNotConfigured();
  await assertWithinRateLimit(options.workspaceId);
  await assertMonthlyRoom(options.workspaceId, 'aiCredits');
  await assertWithinBudget();

  const model = await resolveVoiceModel(apiKey);
  if (!model) throw errors.aiNotConfigured();

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: options.text, voice: options.voice, response_format: 'mp3' }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new AiProviderError(body.error?.message ?? `HTTP ${response.status}`, response.status);
  }
  const audio = Buffer.from(await response.arrayBuffer());

  try {
    await prisma.aiGeneration.create({
      data: { workspaceId: options.workspaceId, userId: options.userId, kind: 'voice', prompt: options.text.slice(0, 4000), output: '', model, inputTokens: 0, outputTokens: 0, provider: 'openai', costUsd: null },
    });
  } catch (error) {
    console.error('[ai] could not record the voice', error);
  }
  return audio;
}
