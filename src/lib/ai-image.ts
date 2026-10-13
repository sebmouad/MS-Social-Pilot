import { assertMonthlyRoom } from './plans';
import { assertWithinBudget, assertWithinRateLimit } from './ai';
import { AiProviderError, providerKey } from './ai-providers';
import { errors } from './errors';
import { storeFile } from './media';
import { prisma } from './prisma';

/**
 * Pictures from a description, through OpenAI's image models.
 *
 * The model is never typed here: it is the newest image model the operator's
 * own key lists. Counted against the same hourly allowance, monthly credits
 * and budget as the AI that writes text, and kept in the workspace's media
 * library like any upload.
 */

export const IMAGE_SIZES = { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' } as const;
export type ImageSize = keyof typeof IMAGE_SIZES;

/** The newest image model this key may use, read from the provider; null when it lists none. */
export async function resolveImageModel(apiKey: string): Promise<string | null> {
  const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = (await response.json().catch(() => ({}))) as { data?: Array<{ id: string; created?: number }>; error?: { message?: string } };
  if (!response.ok) throw new AiProviderError(body.error?.message ?? `HTTP ${response.status}`, response.status);
  const models = (body.data ?? []).filter((model) => /image/i.test(model.id)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return models[0]?.id ?? null;
}

export function imageAvailable(): boolean {
  return providerKey('openai') !== null;
}

export async function generateImage(options: { workspaceId: string; userId: string; prompt: string; size: ImageSize }) {
  const apiKey = providerKey('openai');
  if (!apiKey) throw errors.aiNotConfigured();
  await assertWithinRateLimit(options.workspaceId);
  await assertMonthlyRoom(options.workspaceId, 'aiCredits');
  await assertWithinBudget();

  const model = await resolveImageModel(apiKey);
  if (!model) throw errors.aiNotConfigured();

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: options.prompt, size: IMAGE_SIZES[options.size], n: 1 }),
  });
  const body = (await response.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } };
  if (!response.ok) throw new AiProviderError(body.error?.message ?? `HTTP ${response.status}`, response.status);
  const first = body.data?.[0];
  let data: Buffer | null = null;
  if (first?.b64_json) data = Buffer.from(first.b64_json, 'base64');
  else if (first?.url) data = Buffer.from(await (await fetch(first.url)).arrayBuffer());
  if (!data) throw new AiProviderError('The provider returned no picture.', 502);

  const stored = await storeFile({ workspaceId: options.workspaceId, data, mimeType: 'image/png', originalName: 'ai-picture.png' });
  const media = await prisma.media.create({
    data: { workspaceId: options.workspaceId, filename: 'ai-picture.png', mimeType: 'image/png', size: stored.size, kind: stored.kind, storageKey: stored.storageKey, url: '' },
  });
  const updated = await prisma.media.update({ where: { id: media.id }, data: { url: `/api/media/${media.id}/raw` } });

  try {
    await prisma.aiGeneration.create({
      data: { workspaceId: options.workspaceId, userId: options.userId, kind: 'image', prompt: options.prompt.slice(0, 4000), output: updated.url, model, inputTokens: 0, outputTokens: 0, provider: 'openai', costUsd: null },
    });
  } catch (error) {
    console.error('[ai] could not record the picture', error);
  }
  return { id: updated.id, url: updated.url };
}
