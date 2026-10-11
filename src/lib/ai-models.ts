import { activeAiProvider, listProviderModels, providerKey, type AiModel } from './ai-providers';
import { env } from './env';

export type { AiModel } from './ai-providers';

/**
 * The models the configured AI provider offers, read from its API.
 *
 * Never a list typed into the code: providers add and retire models faster
 * than releases ship, and a stale list either hides the newest model or offers
 * one that no longer answers. The list is fetched with the operator's own key,
 * so it is exactly what that account may use.
 */
const CACHE_MS = 60 * 60 * 1000;
let cache: { key: string; at: number; models: AiModel[] } | null = null;

/** Newest first where the provider says so. Cached for an hour per provider and key. */
export async function listAiModels(options: { refresh?: boolean } = {}): Promise<AiModel[]> {
  const provider = activeAiProvider();
  const apiKey = provider ? providerKey(provider) : null;
  if (!provider || !apiKey) return [];
  const cacheKey = `${provider}:${apiKey}`;
  if (!options.refresh && cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_MS) {
    return cache.models;
  }

  const models = await listProviderModels(provider, apiKey);
  cache = { key: cacheKey, at: Date.now(), models };
  return models;
}

/**
 * The model to call: the one the operator chose if the provider still offers
 * it, otherwise the first model the provider lists. Switching provider never
 * leaves the app calling another provider's model.
 */
export async function resolveAiModel(): Promise<string> {
  const chosen = env.aiModel.trim();
  const models = await listAiModels();
  if (chosen && (models.length === 0 || models.some((model) => model.id === chosen))) return chosen;
  const [first] = models;
  if (!first) throw new Error('The AI provider listed no models for this key.');
  return first.id;
}

/** For tests. */
export function clearAiModelCache(): void {
  cache = null;
}
