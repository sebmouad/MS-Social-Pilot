import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeConfigBatch, runtimeSecret } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { fsMediaStore, type MediaStore } from '@/modules/media/server/store';
import { bounds as mediaBounds } from '@/modules/media/server/library';
import { authorizeAi, type AiActor } from '../../server/access';
import { claim, workspaceContext } from '../../server/ai';
import { METERING_KEYS, meteringFrom, monthlyUsage, type Metering } from '../../server/usage';
import { imagePolicySchema, toolsLimitsSchema, videoPolicySchema, voicePolicySchema } from '../../config';
import { toolsCopy, type Locale } from './copy-loader';
import { openaiImagePort, openaiVoicePort } from './media-openai';
import { geminiVideoPort } from './media-gemini';
import { pickModel, type ImagePort, type MediaPorts, type VideoPort, type VoicePort } from './media-ports';

export const IMAGE_CONFIRMATION = 'GENERATE IMAGE';
export const VOICE_CONFIRMATION = 'GENERATE VOICE';
export const VIDEO_CONFIRMATION = 'GENERATE VIDEO';
const COMPOSER = 'publishing/posts';
const LIBRARY = 'publishing/media';
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type MediaActor = AiActor & { apiKeyId?: string };
export type MediaDeps = { ports?: MediaPorts; store?: MediaStore; now?: () => Date; locale?: Locale };
type Kind = 'image' | 'voice' | 'video';
type Tx = Pick<typeof prisma, '$executeRaw' | '$queryRaw'>;

async function fail(code: OperationErrorCode, locale: Locale = 'en') {
  const copy = await toolsCopy(locale);
  const text = { invalid_request: copy.errInvalid, unauthorized: copy.errUnauthorized, forbidden: copy.errForbidden, not_found: copy.errNotFound, unavailable: copy.errUnavailable, reconnect_required: copy.errReconnect, conflict: copy.errConflict, upstream_failure: copy.errUpstream }[code];
  return new OperationError(code, text);
}
/** Re-localise any service failure so the customer never sees English text in a French session or provider text at all. */
async function localise(error: unknown, locale: Locale): Promise<never> {
  throw await fail(error instanceof OperationError ? error.code : 'upstream_failure', locale);
}

type Resolved<P> = { policy: P; limits: { hourly: number; txTimeout: number; txWait: number; metering: Metering }; model: string; ready: true };

async function base(kind: Kind, deps: MediaDeps) {
  const read = <S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> | null => { const r = schema.safeParse(raw); return r.success ? r.data : null; };
  const key = { image: 'ai.imagePolicy', voice: 'ai.voicePolicy', video: 'ai.videoPolicy' }[kind] as 'ai.imagePolicy';
  const [raw, config, toolLimitsRaw] = await Promise.all([
    runtimeConfig(key), runtimeConfigBatch(['ai.enabled', 'ai.hourlyRequestsPerWorkspace', ...METERING_KEYS]), runtimeConfig('ai.toolsLimits'),
  ]);
  const schema = kind === 'image' ? imagePolicySchema : kind === 'voice' ? voicePolicySchema : videoPolicySchema;
  const policy = read(raw, schema); const toolLimits = read(toolLimitsRaw, toolsLimitsSchema);
  const hourly = config['ai.hourlyRequestsPerWorkspace'];
  if (!policy || !toolLimits || config['ai.enabled'] !== true || !(policy as { enabled: boolean }).enabled || typeof hourly !== 'number') return null;
  return { policy: policy as never, config, hourly, toolLimits, deps };
}

function portFor(kind: Kind, policy: Record<string, unknown>, apiKey: string, deps: MediaDeps): ImagePort | VoicePort | VideoPort {
  const injected = deps.ports?.[kind]; if (injected) return injected;
  if (kind === 'image') { const p = policy as z.infer<typeof imagePolicySchema>; return openaiImagePort({ apiKey, endpoint: p.endpoint, modelsEndpoint: p.modelsEndpoint, maxBytes: p.maxDownloadBytes }); }
  if (kind === 'voice') { const p = policy as z.infer<typeof voicePolicySchema>; return openaiVoicePort({ apiKey, endpoint: p.endpoint, modelsEndpoint: p.modelsEndpoint, maxBytes: p.maxAudioBytes }); }
  return geminiVideoPort({ apiKey, baseEndpoint: (policy as z.infer<typeof videoPolicySchema>).baseEndpoint });
}
const SECRET_KEY: Record<Kind, 'ai.openaiApiKey' | 'ai.geminiApiKey'> = { image: 'ai.openaiApiKey', voice: 'ai.openaiApiKey', video: 'ai.geminiApiKey' };

/** Everything one generation needs, or null (never an error) when the kind is off, unkeyed or the workspace opted out. */
async function resolve(kind: 'image', actor: AiActor, deps: MediaDeps): Promise<(Resolved<z.infer<typeof imagePolicySchema>> & { port: ImagePort }) | null>;
async function resolve(kind: 'voice', actor: AiActor, deps: MediaDeps): Promise<(Resolved<z.infer<typeof voicePolicySchema>> & { port: VoicePort }) | null>;
async function resolve(kind: 'video', actor: AiActor, deps: MediaDeps): Promise<(Resolved<z.infer<typeof videoPolicySchema>> & { port: VideoPort }) | null>;
async function resolve(kind: Kind, actor: AiActor, deps: MediaDeps): Promise<unknown> {
  try {
    const [b, workspace] = await Promise.all([base(kind, deps), workspaceContext(actor.workspaceId)]);
    if (!b || !workspace?.enabled) return null;
    const apiKey = deps.ports?.[kind] ? 'injected' : await runtimeSecret(SECRET_KEY[kind]);
    if (!apiKey) return null;
    const policy = b.policy as Record<string, unknown> & { model: string; modelPattern: string; excludePattern?: string };
    const port = portFor(kind, policy, apiKey, deps);
    const model = policy.model || 'auto';
    const metering = meteringFrom(b.config, model);
    if (!metering) return null;
    return { policy: b.policy, port, model: policy.model, limits: { hourly: b.hourly, txTimeout: b.toolLimits.transactionTimeoutMs, txWait: b.toolLimits.transactionMaxWaitMs, metering }, ready: true };
  } catch { return null; }
}

async function chooseModel(port: ImagePort | VoicePort | VideoPort, policy: { model: string; modelPattern: string; excludePattern?: string }, signal: AbortSignal): Promise<string> {
  if (policy.model) return policy.model;
  const model = pickModel('', await port.listModels(signal), policy.modelPattern, policy.excludePattern);
  if (!model) throw new OperationError('unavailable', 'unavailable');
  return model;
}

async function audit(db: Tx, actor: MediaActor, action: string, detail: Record<string, unknown>, now: Date) {
  const payload = JSON.stringify({ ...detail, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, authSource: 'api_key' } : {}) });
  const count = await db.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${payload}::jsonb, ${now})`;
  if (count !== 1) throw new OperationError('unavailable', 'unavailable');
}
/** Priced requests carry a cost; unpriced ones count as unknown, never zero (see monthlyUsage). */
async function recordUsage(actor: MediaActor, kind: Kind, model: string, costUsd: number, now: Date) {
  const detail = JSON.stringify({ kind, model, ...(costUsd > 0 ? { costUsd } : {}) });
  try { await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'ai.completed', ${detail}::jsonb, ${now})`; } catch { /* the result already exists */ }
}
async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms);
  try { return await run(controller.signal); } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('upstream_failure', 'upstream_failure'); } finally { clearTimeout(timer); }
}
const noControl = (value: string) => !CONTROL.test(value);
const textField = (min: number, max: number) => z.string().trim().min(min).max(max).refine(noControl, 'Control characters are not allowed.');

async function libraryBytes(workspaceId: string, store: MediaStore): Promise<number> {
  const images = await store.listImages(workspaceId, 1);
  const rows = await prisma.$queryRaw<Array<{ bytes: number | null }>>`SELECT COALESCE(SUM(size), 0)::float8 AS bytes FROM media WHERE "workspaceId" = ${workspaceId}`;
  return (images.totalBytes ?? 0) + Number(rows[0]?.bytes ?? 0);
}

// ------------------------------------------------------------------ status

export type MediaStatus = {
  image: { available: boolean; sizes: Array<{ id: string; label: { en: string; fr: string } }>; defaultSize: string | null; promptMaxCharacters: number | null };
  voice: { available: boolean; voices: string[]; defaultVoice: string | null; textMaxCharacters: number | null };
  video: { available: boolean; aspectRatios: Array<{ id: string; label: { en: string; fr: string } }>; defaultAspectRatio: string | null; promptMaxCharacters: number | null };
  confirmations: { image: string; voice: string; video: string };
  usage?: Awaited<ReturnType<typeof monthlyUsage>>;
};

/** What this member may offer in the interface now; everything unavailable when the member cannot write posts. */
export async function aiMediaStatus(actor: MediaActor, deps: MediaDeps = {}): Promise<MediaStatus> {
  const none: MediaStatus = {
    image: { available: false, sizes: [], defaultSize: null, promptMaxCharacters: null }, voice: { available: false, voices: [], defaultVoice: null, textMaxCharacters: null },
    video: { available: false, aspectRatios: [], defaultAspectRatio: null, promptMaxCharacters: null }, confirmations: { image: IMAGE_CONFIRMATION, voice: VOICE_CONFIRMATION, video: VIDEO_CONFIRMATION },
  };
  try { await authorizeAi(actor, COMPOSER, 'write'); } catch { return none; }
  let canSave = true; try { await authorizeAi(actor, LIBRARY, 'write'); } catch { canSave = false; }
  const [image, voice, video] = await Promise.all([resolve('image', actor, deps), resolve('voice', actor, deps), resolve('video', actor, deps)]);
  const result: MediaStatus = {
    ...none,
    image: image && canSave ? { available: true, sizes: image.policy.sizes.map(s => ({ id: s.id, label: s.label })), defaultSize: image.policy.defaultSize, promptMaxCharacters: image.policy.promptMaxCharacters } : none.image,
    voice: voice ? { available: true, voices: voice.policy.voices, defaultVoice: voice.policy.defaultVoice, textMaxCharacters: voice.policy.textMaxCharacters } : none.voice,
    video: video && canSave ? { available: true, aspectRatios: video.policy.aspectRatios.map(a => ({ id: a.id, label: a.label })), defaultAspectRatio: video.policy.defaultAspectRatio, promptMaxCharacters: video.policy.promptMaxCharacters } : none.video,
  };
  const limits = (image ?? voice ?? video)?.limits;
  if (limits) { try { result.usage = await monthlyUsage(actor.workspaceId, limits.metering.budgetUsd, (deps.now ?? (() => new Date()))()); } catch { /* usage is advisory */ } }
  return result;
}

// ------------------------------------------------------------------ picture

export type ImageResult = { id: string; kind: 'image'; mimeType: string; size: number; name: string };

/** Create one picture, save it to the media library and record usage. Spends the workspace's AI allowance. */
export async function generateImage(actor: MediaActor, raw: unknown, deps: MediaDeps = {}): Promise<ImageResult> {
  const locale = deps.locale ?? 'en';
  try {
    await authorizeAi(actor, COMPOSER, 'write'); await authorizeAi(actor, LIBRARY, 'write');
    const r = await resolve('image', actor, deps);
    if (!r) throw new OperationError('unavailable', 'unavailable');
    const p = r.policy;
    const parsed = z.object({ prompt: textField(p.promptMinCharacters, p.promptMaxCharacters), size: z.string().optional(), confirmation: z.string() }).strict().safeParse(raw);
    const size = parsed.success ? p.sizes.find(s => s.id === (parsed.data.size ?? p.defaultSize)) : undefined;
    if (!parsed.success || !size || parsed.data.confirmation !== IMAGE_CONFIRMATION) throw new OperationError('invalid_request', 'invalid_request');
    const store = deps.store ?? fsMediaStore; const now = (deps.now ?? (() => new Date()))();
    return await withWorkspaceOperation(actor.workspaceId, async () => {
      const limits = await mediaBounds();
      await claim(actor, r.limits, 'image', parsed.data.prompt.length, now);
      const { bytes, model } = await withTimeout(p.timeoutMs, async signal => {
        const model = await chooseModel(r.port, p, signal);
        return { bytes: await r.port.generate({ model, prompt: parsed.data.prompt, size: size.size, signal }), model };
      });
      await recordUsage(actor, 'image', model, p.costPerImageUsd, now);
      if ((await libraryBytes(actor.workspaceId, store)) + bytes.length > limits.quota) throw new OperationError('conflict', 'conflict');
      await authorizeAi(actor, LIBRARY, 'write');
      const stored = await store.putImage({ userId: actor.userId, workspaceId: actor.workspaceId }, new File([new Uint8Array(bytes)], p.fileName, { type: p.mimeType }));
      try { await audit(prisma, actor, 'ai.image.created', { assetId: stored.id, model, size: size.size, bytes: bytes.length }, now); }
      catch (error) { await store.removeImage(actor.workspaceId, stored.id, true).catch(() => undefined); throw error; }
      return { id: stored.id, kind: 'image' as const, mimeType: stored.mimeType, size: bytes.length, name: p.fileName };
    });
  } catch (error) { return localise(error, locale); }
}

// ------------------------------------------------------------------ voice

export type VoiceResult = { audio: Buffer; mimeType: string; bytes: number };

/** Read a text aloud. The audio is returned to the member and not stored. */
export async function generateVoice(actor: MediaActor, raw: unknown, deps: MediaDeps = {}): Promise<VoiceResult> {
  const locale = deps.locale ?? 'en';
  try {
    await authorizeAi(actor, COMPOSER, 'write');
    const r = await resolve('voice', actor, deps);
    if (!r) throw new OperationError('unavailable', 'unavailable');
    const p = r.policy;
    const parsed = z.object({ text: textField(p.textMinCharacters, p.textMaxCharacters), voice: z.string().optional(), confirmation: z.string() }).strict().safeParse(raw);
    const voice = parsed.success ? (parsed.data.voice ?? p.defaultVoice) : '';
    if (!parsed.success || !p.voices.includes(voice) || parsed.data.confirmation !== VOICE_CONFIRMATION) throw new OperationError('invalid_request', 'invalid_request');
    const now = (deps.now ?? (() => new Date()))();
    return await withWorkspaceOperation(actor.workspaceId, async () => {
      await claim(actor, r.limits, 'voice', parsed.data.text.length, now);
      const { audio, model } = await withTimeout(p.timeoutMs, async signal => {
        const model = await chooseModel(r.port, p, signal);
        return { audio: await r.port.speak({ model, text: parsed.data.text, voice, format: p.format, signal }), model };
      });
      await recordUsage(actor, 'voice', model, p.costPerRequestUsd, now);
      await audit(prisma, actor, 'ai.voice.created', { model, voice, characters: parsed.data.text.length, bytes: audio.length }, now);
      return { audio, mimeType: p.mimeType, bytes: audio.length };
    });
  } catch (error) { return localise(error, locale); }
}

// ------------------------------------------------------------------ video

export type VideoRow = { id: string; prompt: string; aspectRatio: string; status: 'working' | 'ready' | 'failed'; mediaId: string | null; error: string | null; createdAt: Date };
type WorkingVideo = { id: string; workspaceId: string; userId: string; prompt: string; operation: string; createdAt: Date };

/** Start one video. The provider makes it in the background; reads (and the worker) finish it into the library. */
export async function startVideo(actor: MediaActor, raw: unknown, deps: MediaDeps = {}): Promise<{ id: string; status: 'working' }> {
  const locale = deps.locale ?? 'en';
  try {
    await authorizeAi(actor, COMPOSER, 'write'); await authorizeAi(actor, LIBRARY, 'write');
    const r = await resolve('video', actor, deps);
    if (!r) throw new OperationError('unavailable', 'unavailable');
    const p = r.policy;
    const parsed = z.object({ prompt: textField(p.promptMinCharacters, p.promptMaxCharacters), aspectRatio: z.string().optional(), confirmation: z.string() }).strict().safeParse(raw);
    const aspect = parsed.success ? (parsed.data.aspectRatio ?? p.defaultAspectRatio) : '';
    if (!parsed.success || !p.aspectRatios.some(a => a.id === aspect) || parsed.data.confirmation !== VIDEO_CONFIRMATION) throw new OperationError('invalid_request', 'invalid_request');
    const now = (deps.now ?? (() => new Date()))();
    return await withWorkspaceOperation(actor.workspaceId, async () => {
      await claim(actor, r.limits, 'video', parsed.data.prompt.length, now);
      const { operation, model } = await withTimeout(p.timeoutMs, async signal => {
        const model = await chooseModel(r.port, p, signal);
        return { operation: await r.port.start({ model, prompt: parsed.data.prompt, aspectRatio: aspect, signal }), model };
      });
      await recordUsage(actor, 'video', model, p.costPerVideoUsd, now);
      const id = randomUUID();
      await prisma.$transaction(async tx => {
        const inserted = await tx.$executeRaw`INSERT INTO ai_videos (id, "workspaceId", "userId", prompt, "aspectRatio", operation, status, "createdAt") VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${parsed.data.prompt}, ${aspect}, ${operation}, 'working', ${now})`;
        if (inserted !== 1) throw new OperationError('unavailable', 'unavailable');
        await audit(tx, actor, 'ai.video.started', { videoId: id, model, aspectRatio: aspect }, now);
      }, { timeout: r.limits.txTimeout, maxWait: r.limits.txWait });
      return { id, status: 'working' as const };
    });
  } catch (error) { return localise(error, locale); }
}

async function failVideo(id: string, code: string) {
  await prisma.$executeRaw`UPDATE ai_videos SET status = 'failed', error = ${code} WHERE id = ${id} AND status = 'working'`;
}

/**
 * Check one working video and, when the provider has finished it, store it in the library.
 * Serialised per video with an advisory lock so a read and the worker never store it twice.
 */
async function settleVideo(video: WorkingVideo, p: z.infer<typeof videoPolicySchema>, port: VideoPort, store: MediaStore, now: Date): Promise<'ready' | 'working' | 'failed'> {
  if (now.getTime() - video.createdAt.getTime() > p.giveUpMs) { await failVideo(video.id, 'timed_out'); return 'failed'; }
  const state = await withTimeout(p.timeoutMs, signal => port.poll(video.operation, signal)).catch(() => null);
  // A hiccup is retried on the next check; the time limit ends it.
  if (!state || state.state === 'working') return 'working';
  if (state.state !== 'done') { await failVideo(video.id, state.state === 'refused' ? 'refused' : 'provider_failed'); return 'failed'; }
  const limits = await mediaBounds();
  const bytes = await withTimeout(p.timeoutMs, signal => port.download(state.uri, Math.min(p.maxDownloadBytes, limits.videoMax), signal)).catch(() => null);
  if (!bytes) { await failVideo(video.id, 'download_failed'); return 'failed'; }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`aivideo:${video.id}`}))::text`;
    const current = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM ai_videos WHERE id = ${video.id} AND "workspaceId" = ${video.workspaceId} FOR UPDATE`;
    if (current[0]?.status !== 'working') return current[0]?.status === 'ready' ? 'ready' as const : 'failed' as const;
    if ((await libraryBytes(video.workspaceId, store)) + bytes.length > limits.quota) { await tx.$executeRaw`UPDATE ai_videos SET status = 'failed', error = 'quota' WHERE id = ${video.id}`; return 'failed' as const; }
    const fileId = randomUUID(); const rowId = `med_${fileId}`;
    const { storageKey } = await store.putVideo(video.workspaceId, fileId, bytes);
    try {
      const inserted = await tx.$executeRaw`INSERT INTO media (id, "workspaceId", filename, "mimeType", size, kind, "storageProvider", "storageKey", url, "createdAt") VALUES (${rowId}, ${video.workspaceId}, ${p.fileName}, ${p.mimeType}, ${bytes.length}, 'video'::"MediaKind", 'local'::"StorageProvider", ${storageKey}, ${`media:${rowId}`}, NOW())`;
      if (inserted !== 1) throw new OperationError('unavailable', 'unavailable');
      await tx.$executeRaw`UPDATE ai_videos SET status = 'ready', "mediaId" = ${rowId}, error = NULL WHERE id = ${video.id}`;
      await audit(tx, { userId: video.userId, workspaceId: video.workspaceId }, 'ai.video.ready', { videoId: video.id, assetId: rowId, bytes: bytes.length }, now);
    } catch (error) { await store.removeStored(video.workspaceId, storageKey).catch(() => undefined); throw error; }
    return 'ready' as const;
  }, { timeout: p.finishTransactionTimeoutMs, maxWait: 10_000 }).catch(() => 'working' as const);
}

async function videoRuntime(deps: MediaDeps) {
  const b = await base('video', deps).catch(() => null);
  if (!b) return null;
  const p = b.policy as z.infer<typeof videoPolicySchema>;
  const apiKey = deps.ports?.video ? 'injected' : await runtimeSecret('ai.geminiApiKey').catch(() => '');
  return apiKey ? { p, port: portFor('video', p, apiKey, deps) as VideoPort } : { p, port: null };
}

/** Recent videos of the workspace; up to `pollPerRead` still-working ones are checked with the provider first. */
export async function listVideos(actor: MediaActor, deps: MediaDeps = {}): Promise<{ videos: VideoRow[] }> {
  const locale = deps.locale ?? 'en';
  try {
    await authorizeAi(actor, COMPOSER, 'read');
    const rt = await videoRuntime(deps);
    const listLimit = rt?.p.listLimit ?? 10;
    const now = (deps.now ?? (() => new Date()))();
    if (rt?.port && rt.p.pollPerRead > 0) {
      const working = await prisma.$queryRaw<WorkingVideo[]>`SELECT id, "workspaceId", "userId", prompt, operation, "createdAt" FROM ai_videos WHERE "workspaceId" = ${actor.workspaceId} AND status = 'working' ORDER BY "createdAt" ASC LIMIT ${rt.p.pollPerRead}`;
      for (const video of working) await settleVideo(video, rt.p, rt.port, deps.store ?? fsMediaStore, now);
    }
    const videos = await prisma.$queryRaw<VideoRow[]>`SELECT id, prompt, "aspectRatio", status, "mediaId", error, "createdAt" FROM ai_videos WHERE "workspaceId" = ${actor.workspaceId} ORDER BY "createdAt" DESC, id DESC LIMIT ${listLimit}`;
    return { videos };
  } catch (error) { return localise(error, locale); }
}

/** Worker pass: finish or give up on working videos of every workspace. Returns how many finished. */
export async function pollAiVideos(deps: MediaDeps = {}): Promise<number> {
  const rt = await videoRuntime(deps);
  if (!rt?.port) return 0;
  const now = (deps.now ?? (() => new Date()))();
  const working = await prisma.$queryRaw<WorkingVideo[]>`SELECT v.id, v."workspaceId", v."userId", v.prompt, v.operation, v."createdAt" FROM ai_videos v JOIN workspaces w ON w.id = v."workspaceId" WHERE v.status = 'working' AND w."suspendedAt" IS NULL ORDER BY v."createdAt" ASC LIMIT ${rt.p.workerBatch}`;
  let finished = 0;
  for (const video of working) if (await settleVideo(video, rt.p, rt.port, deps.store ?? fsMediaStore, now) === 'ready') finished += 1;
  return finished;
}
