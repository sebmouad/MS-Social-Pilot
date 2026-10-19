import { describe, expect, it, vi } from 'vitest';
import { FacebookApiError } from '../src/platforms/facebook/publishing';
import {
  createMemoryAttemptStore, deleteFacebookNativeRemote, executeFacebookNative, mapFacebookVideoStatus,
  planFacebookNative, readFacebookNativeStatus, reconcileFacebookNativeAttempt,
} from '../src/platforms/facebook/formats';
import type { FacebookNativeReadTransport } from '../src/platforms/facebook/formats';

const ready = { status: { video_status: 'ready' }, published: true };
const scheduleReceipt = { status: { video_status: 'ready' }, published: false, scheduled_publish_time: 1_800_000_000 };
const sleep = async () => {};

describe('native status requires positive provider evidence', () => {
  it('requires a ready video and explicit published receipt', () => {
    expect(mapFacebookVideoStatus('video', ready).status).toBe('published');
    expect(mapFacebookVideoStatus('video', { status: { video_status: 'processing' }, published: true }).status).toBe('processing');
    expect(mapFacebookVideoStatus('video', { status: { video_status: 'ready' } })).toMatchObject({ status: 'unknown' });
  });

  it('requires explicit schedule evidence when published is false', () => {
    expect(mapFacebookVideoStatus('video', scheduleReceipt).status).toBe('scheduled');
    expect(mapFacebookVideoStatus('video', { status: { video_status: 'ready' }, published: false })).toMatchObject({ status: 'unknown' });
    expect(mapFacebookVideoStatus('video', { ...scheduleReceipt, scheduled_publish_time: 'not-a-time' })).toMatchObject({ status: 'unknown' });
  });

  it('keeps unrecognized provider states unknown', () => {
    expect(mapFacebookVideoStatus('video', { status: { video_status: 'readyish' }, published: true })).toMatchObject({ status: 'unknown' });
    expect(mapFacebookVideoStatus('reel', { status: { video_status: 'ready', publishing_phase: { status: 'mystery' } }, published: true })).toMatchObject({ status: 'unknown' });
  });

  it('does not treat Graph 100/subcode 33 as proof that an object is absent', async () => {
    const transport: FacebookNativeReadTransport = {
      postGraph: vi.fn(async () => ({})), upload: vi.fn(),
      getGraph: vi.fn(async () => { throw new FacebookApiError('inaccessible', 400, 100, 33); }),
      deleteGraph: vi.fn(async () => ({})),
    };
    const status = await readFacebookNativeStatus({ format: 'video', remoteId: 'V1', knownIds: [] }, { transport, sleep });
    expect(status.status).toBe('unknown');
    expect(status.detail).not.toBe('missing');
  });

  it('does not confirm deletion from Graph 100/subcode 33', async () => {
    const attempts = createMemoryAttemptStore();
    const plan = planFacebookNative({
      targetId: 'PAGE1', targetKind: 'page', format: 'post',
      media: [{ kind: 'video', url: 'https://cdn.example/video.mp4', sizeBytes: 1_000_000, durationSeconds: 30, width: 540, height: 960 }],
    });
    await executeFacebookNative(plan, 'publish-1', {
      attempts,
      transport: { postGraph: vi.fn(async () => ({ id: 'VIDEO1' })), upload: vi.fn() },
    });
    const transport: FacebookNativeReadTransport = {
      postGraph: vi.fn(async () => ({})), upload: vi.fn(),
      getGraph: vi.fn(async () => { throw new FacebookApiError('inaccessible', 400, 100, 33); }),
      deleteGraph: vi.fn(async () => { throw new FacebookApiError('inaccessible', 400, 100, 33); }),
    };
    expect(await deleteFacebookNativeRemote('publish-1', { attempts, transport, sleep })).toMatchObject({ status: 'uncertain' });
    expect((await attempts.get('publish-1'))?.state).toBe('published');
  });

  it.each(['comment', 'delete'] as const)('does not reconcile an uncertain :%s child from the parent video', async (kind) => {
    const attempts = createMemoryAttemptStore();
    const operationId = `publish-2:${kind}`;
    await attempts.begin({ operationId, format: 'video', state: 'uncertain', knownIds: ['VIDEO2'], remoteId: null });
    const update = vi.spyOn(attempts, 'update');
    const transport: FacebookNativeReadTransport = {
      postGraph: vi.fn(async () => ({})), upload: vi.fn(),
      getGraph: vi.fn(async () => ready), deleteGraph: vi.fn(async () => ({ success: true })),
    };

    const result = await reconcileFacebookNativeAttempt(operationId, { attempts, transport, sleep });

    expect(result).toEqual({ state: 'uncertain', readback: null });
    expect(transport.getGraph).not.toHaveBeenCalled();
    expect(transport.postGraph).not.toHaveBeenCalled();
    expect(transport.deleteGraph).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect((await attempts.get(operationId))?.state).toBe('uncertain');
  });
});
