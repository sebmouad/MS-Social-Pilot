import Anthropic from '@anthropic-ai/sdk';

import { env } from './env';

/**
 * The AI providers the app can write with: Anthropic, OpenAI and Google Gemini.
 *
 * One small interface — list the models a key may use, and generate text —
 * so the rest of the app never knows which provider answered. OpenAI and
 * Gemini are called with `fetch`; no SDK is needed for two endpoints each.
 *
 * Model lists always come from the provider (never from this file): the only
 * thing decided here is which of a provider's models write text at all, by
 * the capability the provider reports or, for OpenAI which reports none, by
 * leaving out the families that are not chat models (embeddings, speech, …).
 */
export type AiProvider = 'anthropic' | 'openai' | 'gemini';

export const AI_PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'gemini'];

export interface AiModel {
  id: string;
  label: string;
  createdAt: string | null;
}

export interface Generated {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** A provider's refusal, with its HTTP status (401 = key rejected). */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function providerKey(provider: AiProvider): string | null {
  if (provider === 'openai') return env.openaiApiKey;
  if (provider === 'gemini') return env.geminiApiKey;
  return env.anthropicApiKey;
}

/** The provider chosen in Configuration, or with "automatic" the first one that has a key. */
export function activeAiProvider(): AiProvider | null {
  const choice = env.aiProvider;
  if (choice === 'anthropic' || choice === 'openai' || choice === 'gemini') {
    return providerKey(choice) ? choice : null;
  }
  return AI_PROVIDERS.find((provider) => providerKey(provider)) ?? null;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as { message?: string } | undefined;
    throw new AiProviderError(error?.message ?? `HTTP ${response.status}`, response.status);
  }
  return body;
}

/** OpenAI lists every model it hosts; these families do not write chat text. */
const OPENAI_NOT_TEXT = /embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search|babbage|davinci|computer-use|sora/i;

export async function listProviderModels(provider: AiProvider, apiKey: string): Promise<AiModel[]> {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey });
    const models: AiModel[] = [];
    for await (const model of client.models.list({ limit: 100 })) {
      models.push({ id: model.id, label: model.display_name || model.id, createdAt: model.created_at ?? null });
    }
    return models;
  }

  if (provider === 'openai') {
    const body = await json(
      await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }),
    );
    const data = (body.data as Array<{ id: string; created?: number }>) ?? [];
    return data
      .filter((model) => /^(gpt|o\d|chatgpt)/i.test(model.id) && !OPENAI_NOT_TEXT.test(model.id))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map((model) => ({
        id: model.id,
        label: model.id,
        createdAt: model.created ? new Date(model.created * 1000).toISOString() : null,
      }));
  }

  const models: AiModel[] = [];
  let pageToken = '';
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const body = await json(await fetch(url, { headers: { 'x-goog-api-key': apiKey } }));
    const page = (body.models as Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>) ?? [];
    for (const model of page) {
      if (!model.supportedGenerationMethods?.includes('generateContent')) continue;
      const id = model.name.replace(/^models\//, '');
      models.push({ id, label: model.displayName || id, createdAt: null });
    }
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
  } while (pageToken);
  return models;
}

export async function generateWith(
  provider: AiProvider,
  apiKey: string,
  request: { model: string; system: string; prompt: string; maxTokens: number },
): Promise<Generated> {
  if (provider === 'anthropic') {
    const response = await new Anthropic({ apiKey }).messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });
    return {
      text: response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim(),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  if (provider === 'openai') {
    const body = await json(
      await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          max_completion_tokens: request.maxTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
      }),
    );
    const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
    const usage = body.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return {
      text: (choices?.[0]?.message?.content ?? '').trim(),
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
    };
  }

  const body = await json(
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: { maxOutputTokens: request.maxTokens },
        }),
      },
    ),
  );
  const candidates = body.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const usage = body.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  return {
    text: (candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim(),
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}
