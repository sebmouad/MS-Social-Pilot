import { FacebookApiError } from '../publishing';
import { isFacebookDefiniteRejection } from '../protocol';
import { FacebookAttemptStoreUnavailableError } from './types';
import { interpretFacebookThrottle } from './throttle';
import type {
  FacebookNativeMedia, FacebookNativeAttemptStore, FacebookNativeOutcome, FacebookNativePlan, FacebookNativeStep, FacebookNativeTransport,
} from './types';

function str(v: unknown): string | null { return typeof v === 'string' && v.trim() && v.length <= 2048 ? v.trim() : null; }
const reelUrl = (id: string) => `https://www.facebook.com/reel/${id}`;
const storyUrl = (pageId: string) => `https://www.facebook.com/stories/${pageId}`;
const videoUrl = (pageId: string, id: string) => `https://www.facebook.com/${pageId}/videos/${id}/`;

class Stop extends Error { constructor(readonly outcome: FacebookNativeOutcome) { super('stop'); } }

/**
 * Execute one planned native format. Each Graph POST is dispatched at most once:
 * a failure with a definite Graph rejection code is `rejected`; any other failure
 * after dispatch (timeout, 5xx, malformed answer) is `uncertain` and is recorded,
 * never retried. A repeated operationId returns `already_attempted` without I/O.
 */
export async function executeFacebookNative(plan: FacebookNativePlan, operationId: string,
  deps: { transport: FacebookNativeTransport; attempts: FacebookNativeAttemptStore }): Promise<FacebookNativeOutcome> {
  let begun;
  try { begun = await deps.attempts.begin({ operationId, format: plan.format, state: 'started', knownIds: [], targetId: plan.targetId }); }
  catch { throw new FacebookAttemptStoreUnavailableError(); } // fail closed: nothing dispatched
  if (!begun.created) return { status: 'already_attempted', previous: begun.existing };
  const steps: FacebookNativeStep[] = [];
  const known: string[] = [];
  const settle = async (o: FacebookNativeOutcome) => {
    const state = o.status === 'published' ? 'published' : o.status === 'rejected' ? 'rejected' : 'uncertain';
    const remoteId = o.status === 'published' ? o.remoteId : known[0] ?? null;
    try { await deps.attempts.update(operationId, { state, knownIds: [...known], remoteId, steps: steps.map(s => ({ ...s })) }, ['started']); } catch { /* record stays 'started'; reconciliation treats it as uncertain */ }
    return o;
  };
  async function checkpoint(phase: string): Promise<void> {
    try {
      const applied = await deps.attempts.update(operationId, {
        knownIds: [...known], steps: steps.map(s => ({ ...s })),
      }, ['started']);
      if (applied === false) throw new Error('Attempt no longer writable');
    } catch {
      throw new Stop({ status: 'uncertain', phase, knownIds: [...known],
        message: 'Publishing progress could not be saved. Check the Page before trying again.', steps });
    }
  }
  async function call(phase: string, path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const step: FacebookNativeStep = { phase, dispatched: true, confirmed: false };
    steps.push(step);
    await checkpoint(phase); // Intent must commit before dispatch; never replay an intent automatically.
    try {
      const r = await deps.transport.postGraph(path, body);
      step.confirmed = true;
      return r;
    } catch (e) {
      throw new Stop(classify(phase, e));
    }
  }
  function classify(phase: string, e: unknown): FacebookNativeOutcome {
    const th = interpretFacebookThrottle(e);
    const throttle = th ? { throttle: th } : {};
    if (e instanceof FacebookApiError && isFacebookDefiniteRejection(e.status, e.code, e.transient)) {
      return { status: 'rejected', code: e.code ?? null, message: 'Facebook rejected the request.', orphanIds: [...known], steps, ...throttle };
    }
    return { status: 'uncertain', phase, knownIds: [...known], message: 'The outcome at Facebook is unknown. Check the Page before trying again.', steps, ...throttle };
  }
  function need(phase: string, v: unknown): string {
    const id = str(v);
    if (!id) throw new Stop({ status: 'uncertain', phase, knownIds: [...known], message: 'Facebook answered without the expected identity.', steps });
    return id;
  }
  async function resumable(edge: string, media: FacebookNativeMedia): Promise<string> {
    const start = await call('upload_start', edge, { upload_phase: 'start' });
    const videoId = need('upload_start', start.video_id);
    known.push(videoId);
    await checkpoint('upload_start'); // Retain the ID even when the upload address is malformed.
    const uploadUrl = need('upload_start', start.upload_url);
    const step: FacebookNativeStep = { phase: 'upload_transfer', dispatched: true, confirmed: false };
    steps.push(step);
    await checkpoint('upload_transfer');
    try { await deps.transport.upload(uploadUrl, media); step.confirmed = true; }
    catch (e) { throw new Stop(classify('upload_transfer', e)); }
    await checkpoint('upload_transfer');
    return videoId;
  }
  try {
    switch (plan.format) {
      case 'video': {
        if (!plan.media.url) throw new Stop({ status: 'rejected', code: null, message: 'This upload path requires an HTTPS media URL.', orphanIds: [], steps });
        const body: Record<string, string> = { description: plan.description };
        if (!plan.description) delete body.description;
        if (plan.scheduledUnix !== null) { body.published = 'false'; body.scheduled_publish_time = String(plan.scheduledUnix); }
        if (plan.media.url) body.file_url = plan.media.url;
        const r = await call('video_create', `${plan.targetId}/videos`, body);
        const id = need('video_create', r.id); known.push(id);
        await checkpoint('video_create');
        return await settle({ status: 'published', remoteId: id, url: videoUrl(plan.targetId, id), scheduled: plan.scheduledUnix !== null, steps, readbackRequired: true });
      }
      case 'reel': {
        const videoId = await resumable(`${plan.targetId}/video_reels`, plan.media);
        const finish = await call('reel_finish', `${plan.targetId}/video_reels`, {
          upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', ...(plan.description ? { description: plan.description } : {}),
        });
        if (finish.success !== true) throw new Stop({ status: 'uncertain', phase: 'reel_finish', knownIds: [...known], message: 'Facebook did not confirm publication. Check the Page before trying again.', steps });
        return await settle({ status: 'published', remoteId: videoId, url: reelUrl(videoId), scheduled: false, steps, readbackRequired: true });
      }
      case 'story_video': {
        const videoId = await resumable(`${plan.targetId}/video_stories`, plan.media);
        const r = await call('story_finish', `${plan.targetId}/video_stories`, { upload_phase: 'finish', video_id: videoId });
        const id = need('story_finish', r.post_id);
        known.push(id);
        await checkpoint('story_finish');
        return await settle({ status: 'published', remoteId: id, url: storyUrl(plan.targetId), scheduled: false, steps, readbackRequired: true });
      }
      case 'story_photo': {
        if (!plan.media.url) throw new Stop({ status: 'rejected', code: null, message: 'This upload path requires an HTTPS media URL.', orphanIds: [], steps });
        const body: Record<string, string> = { published: 'false' };
        if (plan.media.url) body.url = plan.media.url;
        const photo = await call('photo_upload', `${plan.targetId}/photos`, body);
        const photoId = need('photo_upload', photo.id); known.push(photoId);
        await checkpoint('photo_upload');
        const r = await call('story_create', `${plan.targetId}/photo_stories`, { photo_id: photoId });
        const id = need('story_create', r.post_id ?? r.id);
        known.push(id);
        await checkpoint('story_create');
        return await settle({ status: 'published', remoteId: id, url: storyUrl(plan.targetId), scheduled: false, steps, readbackRequired: true });
      }
    }
  } catch (e) {
    if (e instanceof Stop) return settle(e.outcome);
    throw e;
  }
}

/** In-memory attempt store for tests and single-process previews; production needs a durable implementation. */
export function createMemoryAttemptStore(): FacebookNativeAttemptStore {
  const rows = new Map<string, import('./types').FacebookNativeAttemptRecord>();
  const clone = (r: import('./types').FacebookNativeAttemptRecord) => ({ ...r, knownIds: [...r.knownIds], steps: r.steps?.map(s => ({ ...s })) });
  return {
    async begin(r) { const e = rows.get(r.operationId); if (e) return { created: false, existing: clone(e) }; rows.set(r.operationId, clone(r)); return { created: true }; },
    // A deleted record is terminal: late reconciliation must not resurrect it.
    async update(id, patch, expected) {
      const e = rows.get(id);
      if (!e || e.state === 'deleted' || (expected && !expected.includes(e.state))) return false;
      Object.assign(e, patch, { knownIds: patch.knownIds ? [...patch.knownIds] : e.knownIds, steps: patch.steps ? patch.steps.map(s => ({ ...s })) : e.steps });
      return true;
    },
    async get(id) { const e = rows.get(id); return e ? clone(e) : null; },
  };
}
