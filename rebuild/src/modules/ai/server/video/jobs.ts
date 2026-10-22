import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { jobStopRequested } from '@/server/jobs/job-context';
import { fsMediaStore, type MediaStore } from '@/modules/media/server/store';
import { authorizeAi } from '../access';
import { COMPOSER_FEATURE } from '../ai';
import { resolveVideoModel, VideoProviderError, videoPolicy, type VideoDeps } from './service';
import type { AiVideoPolicy } from './config';

type Working = { id: string; workspaceId: string; userId: string; prompt: string; operation: string; createdAt: Date };
export type VideoJobSummary = { examined: number; ready: number; failed: number; pending: number };
export type VideoJobDeps = VideoDeps & { store?: MediaStore };
const headers = (apiKey: string) => ({ 'x-goog-api-key': apiKey, 'content-type': 'application/json' });
const mp4 = (bytes: Buffer) => bytes.length > 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp';

/** Stream the finished file under a byte cap; the provider-supplied address must be HTTPS on an allowed host. */
async function download(uri: string, apiKey: string, policy: AiVideoPolicy, maxBytes: number, doFetch: typeof fetch): Promise<Buffer> {
  let url: URL;
  try { url = new URL(uri); } catch { throw new VideoProviderError('provider'); }
  if (url.protocol !== 'https:' || !policy.downloadHostSuffixes.some(suffix => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) throw new VideoProviderError('provider');
  let response: Response;
  try { response = await doFetch(url, { headers: { 'x-goog-api-key': apiKey }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(policy.downloadTimeoutMs) }); }
  catch (error) { throw new VideoProviderError(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'provider'); }
  if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); throw new VideoProviderError('provider'); }
  const chunks: Buffer[] = []; let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new OperationError('invalid_request', 'too_large');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => undefined); if (error instanceof OperationError) throw error; throw new VideoProviderError('provider'); }
  return Buffer.concat(chunks);
}

async function settle(video: Working, status: 'ready' | 'failed', error: string | null, mediaId: string | null, summary: VideoJobSummary): Promise<boolean> {
  const changed = await prisma.$transaction(async tx => {
    const count = await tx.$executeRaw`UPDATE ai_videos SET status = ${status}, error = ${error}, "mediaId" = ${mediaId} WHERE id = ${video.id} AND "workspaceId" = ${video.workspaceId} AND status = 'working'`;
    if (count !== 1) return false;
    await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${video.workspaceId}, ${video.userId}, ${status === 'ready' ? 'ai.video_ready' : 'ai.video_failed'}, ${JSON.stringify({ id: video.id, ...(mediaId ? { mediaId } : {}), ...(error ? { reason: error } : {}) })}::jsonb, now())`;
    return true;
  });
  if (changed) summary[status === 'ready' ? 'ready' : 'failed'] += 1;
  return changed;
}

/** Save a finished file to the workspace library like any upload. Returns the media id or the failure code. */
async function saveToLibrary(video: Working, bytes: Buffer, store: MediaStore): Promise<{ mediaId: string } | { code: 'storage' | 'too_large' }> {
  const [videoMax, quota] = await Promise.all([runtimeConfig('media.videoMaxBytes'), runtimeConfig('media.workspaceQuotaBytes')]);
  if (bytes.length > Number(videoMax)) return { code: 'too_large' };
  const used = await prisma.$queryRaw<Array<{ bytes: number }>>`SELECT COALESCE(SUM(size), 0)::float8 AS bytes FROM media WHERE "workspaceId" = ${video.workspaceId} AND "derivedFromId" IS NULL`;
  if (Number(used[0]?.bytes ?? 0) + bytes.length > Number(quota)) return { code: 'too_large' };
  const fileId = randomUUID(); const mediaId = `med_${fileId}`;
  let storageKey: string;
  try { ({ storageKey } = await store.putVideo(video.workspaceId, fileId, bytes)); } catch { return { code: 'storage' }; }
  try {
    const inserted = await prisma.$executeRaw`INSERT INTO media (id, "workspaceId", filename, "mimeType", size, kind, "storageProvider", "storageKey", url, "createdAt") VALUES (${mediaId}, ${video.workspaceId}, ${`ai-video-${video.id.slice(0, 8)}.mp4`}, 'video/mp4', ${bytes.length}, 'video'::"MediaKind", 'local'::"StorageProvider", ${storageKey}, ${`media:${mediaId}`}, now())`;
    if (inserted !== 1) throw new Error('not inserted');
  } catch { await store.removeStored(video.workspaceId, storageKey).catch(() => undefined); return { code: 'storage' }; }
  return { mediaId };
}

/**
 * Check every video still being made (bounded batch, oldest first). Idempotent: a video settles only
 * from `working`, so a repeat or concurrent pass cannot save it twice; a file stored for a video that
 * settled elsewhere is removed. Transient provider hiccups leave the video working until the give-up time.
 */
export async function pollAiVideos(now: Date = new Date(), deps: VideoJobDeps = {}): Promise<VideoJobSummary> {
  const summary: VideoJobSummary = { examined: 0, ready: 0, failed: 0, pending: 0 };
  const policy = await videoPolicy();
  const apiKey = await runtimeSecret('ai.geminiApiKey');
  const doFetch = deps.fetchImpl ?? fetch; const store = deps.store ?? fsMediaStore;
  const working = await prisma.$queryRaw<Working[]>`SELECT id, "workspaceId", "userId", prompt, operation, "createdAt" FROM ai_videos WHERE status = 'working' ORDER BY "createdAt" ASC, id ASC LIMIT ${policy.pollBatch}`;
  for (const video of working) {
    if (jobStopRequested()) break;
    summary.examined += 1;
    try {
      if (now.getTime() - new Date(video.createdAt).getTime() > policy.giveUpMs) { await settle(video, 'failed', 'timeout', null, summary); continue; }
      if (!apiKey) { summary.pending += 1; continue; }
      try { await authorizeAi({ userId: video.userId, workspaceId: video.workspaceId }, COMPOSER_FEATURE, 'write'); }
      catch (error) { if (error instanceof OperationError) { await settle(video, 'failed', 'access_changed', null, summary); continue; } throw error; }
      const state = await providerState(video.operation, apiKey, policy, doFetch);
      if (state.kind === 'working') { summary.pending += 1; continue; }
      if (state.kind === 'failed') { await settle(video, 'failed', state.code, null, summary); continue; }
      const bytes = await download(state.uri, apiKey, policy, policy.downloadMaxBytes, doFetch).catch(error => error);
      if (bytes instanceof OperationError) { await settle(video, 'failed', 'too_large', null, summary); continue; }
      if (bytes instanceof VideoProviderError) { if (bytes.code === 'timeout') { summary.pending += 1; continue; } await settle(video, 'failed', 'provider', null, summary); continue; }
      if (!Buffer.isBuffer(bytes) || !mp4(bytes)) { await settle(video, 'failed', 'provider', null, summary); continue; }
      const saved = await saveToLibrary(video, bytes, store);
      if ('code' in saved) { await settle(video, 'failed', saved.code, null, summary); continue; }
      if (!await settle(video, 'ready', null, saved.mediaId, summary)) {
        await prisma.$executeRaw`DELETE FROM media WHERE id = ${saved.mediaId} AND "workspaceId" = ${video.workspaceId}`;
        await store.removeStored(video.workspaceId, `${video.workspaceId}/videos/${saved.mediaId.slice(4)}`).catch(() => undefined);
      }
    } catch { summary.pending += 1; /* A hiccup is retried next pass; the give-up time ends it. */ }
  }
  return summary;
}

type ProviderState = { kind: 'working' } | { kind: 'failed'; code: 'refused' | 'provider' } | { kind: 'ready'; uri: string };
async function providerState(operation: string, apiKey: string, policy: AiVideoPolicy, doFetch: typeof fetch): Promise<ProviderState> {
  let response: Response;
  try { response = await doFetch(`${policy.baseUrl}/${operation}`, { headers: headers(apiKey), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(policy.requestTimeoutMs) }); }
  catch { return { kind: 'working' }; }
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); return response.status >= 500 || response.status === 429 ? { kind: 'working' } : { kind: 'failed', code: 'provider' }; }
  const body = (await response.json().catch(() => ({}))) as { done?: boolean; error?: unknown; response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } } };
  if (body.done !== true) return { kind: 'working' };
  if (body.error) return { kind: 'failed', code: 'provider' };
  const uri = body.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  return uri ? { kind: 'ready', uri } : { kind: 'failed', code: 'refused' };
}

/** Worker entry: one summary line for the shared run history. */
export async function runAiVideoBatch(now: Date = new Date()): Promise<string> {
  const s = await pollAiVideos(now);
  return `examined=${s.examined} ready=${s.ready} failed=${s.failed} pending=${s.pending}`;
}
export { resolveVideoModel };
