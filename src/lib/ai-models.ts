import Anthropic from '@anthropic-ai/sdk';

import { env } from './env';

/**
 * The models the configured AI provider offers, read from its API.
 *
 * Never a list typed into the code: providers add and retire models faster
 * than releases ship, and a stale list either hides the newest model or offers
 * one that no longer answers. The list is fetched with the operator's own key,
 * so it is exactly what that account may use.
 */
export interface AiModel {
  id: string;
  label: string;
  createdAt: string | null;
}

const CACHE_MS = 60 * 60 * 1000;
let cache: { key: string; at: number; models: AiModel[] } | null = null;

/** Newest first, as the provider lists them. Cached for an hour per key. */
export async function listAiModels(options: { refresh?: boolean } = {}): Promise<AiModel[]> {
  const apiKey = env.anthropicApiKey;
  if (!apiKey) return [];
  if (!options.refresh && cache && cache.key === apiKey && Date.now() - cache.at < CACHE_MS) {
    return cache.models;
  }

  const client = new Anthropic({ apiKey });
  const models: AiModel[] = [];
  for await (const model of client.models.list({ limit: 100 })) {
    models.push({ id: model.id, label: model.display_name || model.id, createdAt: model.created_at ?? null });
  }
  cache = { key: apiKey, at: Date.now(), models };
  return models;
}

/**
 * The model to call: the one the operator chose, or — when none is chosen —
 * the newest model the provider lists.
 */
export async function resolveAiModel(): Promise<string> {
  const chosen = env.aiModel.trim();
  if (chosen) return chosen;
  const [newest] = await listAiModels();
  if (!newest) throw new Error('The AI provider listed no models for this key.');
  return newest.id;
}

/** For tests. */
export function clearAiModelCache(): void {
  cache = null;
}
