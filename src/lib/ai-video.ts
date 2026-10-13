import { z } from 'zod';

import { assertWithinBudget, assertWithinRateLimit } from './ai';
import { AiProviderError, providerKey } from './ai-providers';
import { errors } from './errors';
import { storeFile } from './media';
import { assertMonthlyRoom } from './plans';
import { prisma } from './prisma';

/**
 * Short videos from a description, through Google's Veo models.
 *
 * OpenAI's own video API was shut down on 24 September 2026 (its docs, checked
 * 2026-10-13), so Gemini's key, the one already in Root, makes them. Video takes
 * minutes, so a request is stored and the worker polls it; the finished file
 * lands in the media library like any upload.
 *
 * The model is never typed here: it is the newest Veo model the operator's key
 * lists as able to generate videos.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const VIDEO_ASPECTS = ['16:9', '9:16'] as const;
/** A video not finished by then is given up on. */
const GIVE_UP_MS = 30 * 60 * 1000;

export const videoSchema = z.object({
  prompt: z.string().trim().min(3).max(1000),
  aspectRatio: z.enum(VIDEO_ASPECTS).default('16:9'),
});

export function videoAvailable(): boolean {
  return providerKey('gemini') !== null;
}

const headers = (apiKey: string) => ({ 'x-goog-api-key': apiKey, 'content-type': 'application/json' });

async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = parsed.error as { message?: string } | undefined;
    throw new AiProviderError(error?.message ?? `HTTP ${response.status}`, response.status);
  }
  return parsed;
}

/** The newest full-size Veo model this key may use, read from the provider; null when it lists none. */
export async function resolveVideoModel(apiKey: string): Promise<string | null> {
  const listed = await body(await fetch(`${BASE}/models?pageSize=1000`, { headers: headers(apiKey) }));
  const models = ((listed.models as Array<{ name?: string; supportedGenerationMethods?: string[] }> | undefined) ?? [])
    .filter((model) => /veo/i.test(model.name ?? '') && model.supportedGenerationMethods?.includes('predictLongRunning'))
    .map((model) => (model.name ?? '').replace(/^models\//, ''));
  const full = models.filter((id) => !/fast|lite/i.test(id));
  const pool = full.length ? full : models;
  return pool.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0] ?? null;
}

export async function startVideo(options: { workspaceId: string; userId: string; prompt: string; aspectRatio: (typeof VIDEO_ASPECTS)[number] }) {
  const apiKey = providerKey('gemini');
  if (!apiKey) throw errors.aiNotConfigured();
  await assertWithinRateLimit(options.workspaceId);
  await assertMonthlyRoom(options.workspaceId, 'aiCredits');
  await assertWithinBudget();

  const model = await resolveVideoModel(apiKey);
  if (!model) throw errors.aiNotConfigured();

  const started = await body(
    await fetch(`${BASE}/models/${model}:predictLongRunning`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({ instances: [{ prompt: options.prompt }], parameters: { aspectRatio: options.aspectRatio } }),
    }),
  );
  const operation = typeof started.name === 'string' ? started.name : null;
  if (!operation) throw new AiProviderError('The provider did not start the video.', 502);

  return prisma.aiVideo.create({
    data: { workspaceId: options.workspaceId, userId: options.userId, prompt: options.prompt, aspectRatio: options.aspectRatio, operation },
  });
}

export async function listVideos(workspaceId: string) {
  return prisma.aiVideo.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10 });
}

async function finish(video: { id: string; workspaceId: string; userId: string; prompt: string }, apiKey: string, uri: string): Promise<void> {
  const download = await fetch(uri, { headers: { 'x-goog-api-key': apiKey }, redirect: 'follow' });
  if (!download.ok) throw new AiProviderError(`The finished video could not be downloaded (HTTP ${download.status}).`, 502);
  const data = Buffer.from(await download.arrayBuffer());
  const stored = await storeFile({ workspaceId: video.workspaceId, data, mimeType: 'video/mp4', originalName: 'ai-video.mp4' });
  const media = await prisma.media.create({
    data: { workspaceId: video.workspaceId, filename: 'ai-video.mp4', mimeType: 'video/mp4', size: stored.size, kind: stored.kind, storageKey: stored.storageKey, url: '' },
  });
  const url = `/api/media/${media.id}/raw`;
  await prisma.media.update({ where: { id: media.id }, data: { url } });
  await prisma.aiVideo.update({ where: { id: video.id }, data: { status: 'ready', mediaId: media.id } });
  try {
    await prisma.aiGeneration.create({
      data: { workspaceId: video.workspaceId, userId: video.userId, kind: 'video', prompt: video.prompt.slice(0, 4000), output: url, model: 'veo', inputTokens: 0, outputTokens: 0, provider: 'gemini', costUsd: null },
    });
  } catch (error) {
    console.error('[ai] could not record the video', error);
  }
}

/** Check every video still being made. Returns how many finished. */
export async function pollVideos(now: Date = new Date()): Promise<number> {
  const apiKey = providerKey('gemini');
  const working = await prisma.aiVideo.findMany({ where: { status: 'working' }, orderBy: { createdAt: 'asc' }, take: 20 });
  let finished = 0;
  for (const video of working) {
    const fail = (message: string) => prisma.aiVideo.update({ where: { id: video.id }, data: { status: 'failed', error: message.slice(0, 500) } });
    if (now.getTime() - video.createdAt.getTime() > GIVE_UP_MS) {
      await fail('The provider took too long. Try again.');
      continue;
    }
    if (!apiKey) continue;
    try {
      const state = await body(await fetch(`${BASE}/${video.operation}`, { headers: headers(apiKey) }));
      if (state.done !== true) continue;
      const error = state.error as { message?: string } | undefined;
      if (error) {
        await fail(error.message ?? 'The provider could not make that video.');
        continue;
      }
      const samples = (state.response as { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } } | undefined)?.generateVideoResponse?.generatedSamples;
      const uri = samples?.[0]?.video?.uri;
      if (!uri) {
        await fail('The provider returned no video. Its safety rules may have refused the description.');
        continue;
      }
      await finish(video, apiKey, uri);
      finished += 1;
    } catch (error) {
      // A hiccup is tried again on the next pass; the time limit ends it.
      console.error('[ai] video check failed', error);
    }
  }
  return finished;
}
