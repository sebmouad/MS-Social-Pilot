import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { catalogFor, guarded, toolFailure, type Locale } from '../tool-kit';
import { toolErrorCopy } from '../tool-config';
import { authorizeAi, type AiActor } from '../access';
import { claim, COMPOSER_FEATURE, settings, type AiDeps } from '../ai';
import { aiVideoCopySchema, aiVideoPolicySchema, type AiVideoPolicy } from './config';

export type AiVideoStatus = 'working' | 'ready' | 'failed';
export type AiVideoRow = { id: string; prompt: string; aspectRatio: string; status: AiVideoStatus; mediaId: string | null; error: string | null; createdAt: Date | string };
export type VideoDeps = AiDeps & { fetchImpl?: typeof fetch };

export const videoRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('start'), prompt: z.string(), aspectRatio: z.string(), confirmation: z.string() }).strict(),
]);
export const VIDEO_CONFIRMATION = 'MAKE VIDEO';
export const videoPolicy = async (): Promise<AiVideoPolicy> => aiVideoPolicySchema.parse(await runtimeConfig('ai.video.policy'));
export const videoCopy = (locale: Locale) => catalogFor('ai.video.copy', aiVideoCopySchema, locale);

const headers = (apiKey: string) => ({ 'x-goog-api-key': apiKey, 'content-type': 'application/json' });
/** Provider failures carry a stable code only; provider wording never reaches a customer. */
export class VideoProviderError extends Error { constructor(readonly code: 'provider' | 'refused' | 'timeout') { super(code); } }

async function providerJson(doFetch: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store' }); }
  catch (error) { throw new VideoProviderError(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'provider'); }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new VideoProviderError('provider');
  return body;
}

/** The newest full-size model whose name matches the Root pattern and that can run long video jobs; null when none. */
export async function resolveVideoModel(apiKey: string, policy: AiVideoPolicy, doFetch: typeof fetch = fetch): Promise<string | null> {
  const listed = await providerJson(doFetch, `${policy.baseUrl}/models?pageSize=1000`, { headers: headers(apiKey) }, policy.requestTimeoutMs);
  const include = new RegExp(policy.modelPattern, 'i'); const exclude = policy.excludeModelPattern ? new RegExp(policy.excludeModelPattern, 'i') : null;
  const models = ((listed.models as Array<{ name?: string; supportedGenerationMethods?: string[] }> | undefined) ?? [])
    .filter(model => include.test(model.name ?? '') && model.supportedGenerationMethods?.includes('predictLongRunning'))
    .map(model => (model.name ?? '').replace(/^models\//, ''));
  const preferred = exclude ? models.filter(id => !exclude.test(id)) : models;
  return (preferred.length ? preferred : models).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0] ?? null;
}

async function audit(workspaceId: string, actorId: string | null, action: string, detail: object, db: Pick<typeof prisma, '$executeRaw'> = prisma) {
  await db.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb, now())`;
}

/** UI, REST and MCP share this: list recent videos or start one. Starting is metered like every AI request. */
export async function aiVideos(actor: AiActor, raw: unknown, deps: VideoDeps & { locale?: Locale } = {}) {
  const locale = deps.locale ?? 'en';
  const errors = await toolErrorCopy(locale);
  return guarded(errors, async () => {
    const parsed = videoRequest.safeParse(raw);
    if (!parsed.success) throw toolFailure(errors, 'invalid_request');
    const input = parsed.data;
    const policy = await videoPolicy();
    await authorizeAi(actor, COMPOSER_FEATURE, input.action === 'list' ? 'read' : 'write');
    if (input.action === 'list') {
      const videos = await prisma.$queryRaw<AiVideoRow[]>`SELECT id, prompt, "aspectRatio", status, "mediaId", error, "createdAt" FROM ai_videos WHERE "workspaceId" = ${actor.workspaceId} ORDER BY "createdAt" DESC, id DESC LIMIT ${policy.listLimit}`;
      return { videos, aspectRatios: policy.aspectRatios };
    }
    const copy = await videoCopy(locale);
    if (input.confirmation !== VIDEO_CONFIRMATION) throw new OperationError('invalid_request', copy.confirmation!);
    const prompt = input.prompt.trim();
    if (prompt.length < policy.promptMinCharacters || prompt.length > policy.promptMaxCharacters || !policy.aspectRatios.includes(input.aspectRatio)) throw toolFailure(errors, 'invalid_request');
    const apiKey = await runtimeSecret('ai.geminiApiKey');
    const s = await settings(deps);
    const workspace = await prisma.$queryRaw<Array<{ aiEnabled: boolean }>>`SELECT "aiEnabled" FROM workspaces WHERE id = ${actor.workspaceId}`;
    if (!apiKey || !s || !workspace[0]?.aiEnabled) throw toolFailure(errors, 'unavailable');
    const working = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM ai_videos WHERE "workspaceId" = ${actor.workspaceId} AND status = 'working'`;
    if (Number(working[0]?.count ?? 0) >= policy.maxWorkingPerWorkspace) throw new OperationError('conflict', copy.busy!);
    const now = (deps.now ?? (() => new Date()))();
    // The claim counts against the hourly limit and monthly budget even when the provider then fails.
    await claim(actor, s, 'video', prompt.length, now);
    const doFetch = deps.fetchImpl ?? fetch;
    const model = await resolveVideoModel(apiKey, policy, doFetch).catch(() => null);
    if (!model) throw toolFailure(errors, 'unavailable');
    const started = await providerJson(doFetch, `${policy.baseUrl}/models/${encodeURIComponent(model)}:predictLongRunning`, { method: 'POST', headers: headers(apiKey), body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: input.aspectRatio } }) }, policy.requestTimeoutMs).catch(() => null);
    const operation = started && typeof started.name === 'string' && /^[A-Za-z0-9_./-]{1,300}$/.test(started.name) ? started.name : null;
    if (!operation) throw toolFailure(errors, 'upstream_failure');
    const id = randomUUID();
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO ai_videos (id, "workspaceId", "userId", prompt, "aspectRatio", operation, status, "createdAt") VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${prompt}, ${input.aspectRatio}, ${operation}, 'working', ${now})`;
      await audit(actor.workspaceId, actor.userId, 'ai.video_started', { id, aspectRatio: input.aspectRatio, promptLength: prompt.length }, tx);
    });
    return { id, status: 'working' as const, message: copy.started };
  });
}
