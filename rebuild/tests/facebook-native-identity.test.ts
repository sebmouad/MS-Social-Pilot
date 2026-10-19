import { describe, expect, it, vi } from 'vitest';
import { snapshotFacebookNativePlan } from '../src/platforms/facebook/formats/identity';
import { createMemoryAttemptStore, executeFacebookNative } from '../src/platforms/facebook/formats/execute';
import { FacebookNativePayloadConflictError, type FacebookNativeAttemptStore, type FacebookNativePlan, type FacebookNativeMedia } from '../src/platforms/facebook/formats/types';

const reel = (): FacebookNativePlan => ({ format: 'reel', targetId: 'page', description: 'Original caption', media: {
  kind: 'video', bytes: Buffer.from([1, 2, 3]), sizeBytes: 3, durationSeconds: 10, width: 540, height: 960, mimeType: 'video/mp4', fileName: 'original.mp4',
} });
const video = (): FacebookNativePlan => ({ format: 'video', targetId: 'page', description: 'Original caption', scheduledUnix: null,
  media: { kind: 'video', url: 'https://example.invalid/video.mp4' } });
const transport = () => ({ postGraph: vi.fn(async () => ({ id: 'video' })), upload: vi.fn() });

describe('native payload identity', () => {
  it('is deterministic across field order and copies Buffer memory', () => {
    const plan = reel(); const snapshot = snapshotFacebookNativePlan(plan);
    expect(snapshot.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.payloadHash).toBe(snapshotFacebookNativePlan({ ...plan, media: { fileName: 'original.mp4', mimeType: 'video/mp4', height: 960,
      width: 540, durationSeconds: 10, sizeBytes: 3, bytes: new Uint8Array([1, 2, 3]), kind: 'video' } }).payloadHash);
    expect(snapshot.plan.media.bytes).not.toBe(plan.media.bytes);
    plan.media.bytes!.fill(9);
    expect([...snapshot.plan.media.bytes!]).toEqual([1, 2, 3]);
    expect(Object.isFrozen(snapshot.plan)).toBe(true);
    expect(Object.isFrozen(snapshot.plan.media)).toBe(true);
  });

  it.each(['target', 'description', 'bytes', 'url', 'size', 'duration', 'width', 'height', 'mime', 'filename', 'schedule', 'format'])(
    'binds %s changes', field => {
      const original = field === 'schedule' || field === 'url' ? video() : reel(); const changed = structuredClone(original);
      switch (field) {
        case 'target': changed.targetId = 'other'; break;
        case 'description': if ('description' in changed) changed.description = 'Changed'; break;
        case 'bytes': changed.media.bytes![1] = 9; break;
        case 'url': changed.media.url = 'https://example.invalid/other.mp4'; break;
        case 'size': delete changed.media.sizeBytes; break;
        case 'duration': changed.media.durationSeconds = 20; break;
        case 'width': changed.media.width = 1080; break;
        case 'height': changed.media.height = 1920; break;
        case 'mime': changed.media.mimeType = 'video/other'; break;
        case 'filename': changed.media.fileName = 'other.mp4'; break;
        case 'schedule': if (changed.format === 'video') changed.scheduledUnix = 1800000000; break;
        case 'format': changed.format = 'story_video'; delete (changed as { description?: string }).description; break;
      }
      expect(snapshotFacebookNativePlan(changed).payloadHash).not.toBe(snapshotFacebookNativePlan(original).payloadHash);
    });

  it.each([NaN, Infinity, -1, 0])('rejects invalid metadata %s before storage', async value => {
    const plan = reel(); plan.media.durationSeconds = value;
    const attempts = { begin: vi.fn(), update: vi.fn(), get: vi.fn() }; const remote = transport();
    await expect(executeFacebookNative(plan, 'op', { attempts, transport: remote })).rejects.toThrow('payload is invalid');
    expect(attempts.begin).not.toHaveBeenCalled(); expect(remote.postGraph).not.toHaveBeenCalled();
  });

  it('refuses ambiguous sources, credential URLs, invalid schedules and malformed destinations', () => {
    const dual = reel(); dual.media.url = 'https://example.invalid/v';
    const secret = video(); secret.media.url = 'https://user:secret@example.invalid/v';
    const scheduled = video(); if (scheduled.format === 'video') scheduled.scheduledUnix = NaN;
    const malformed = video(); malformed.targetId = 'page/videos';
    for (const plan of [dual, secret, scheduled, malformed]) expect(() => snapshotFacebookNativePlan(plan)).toThrow('payload is invalid');
  });

  it.each([5, 'abc', [1, 2, 3], { length: 3 }])('rejects non-byte runtime values %s', bytes => {
    const plan = reel(); plan.media.bytes = bytes as unknown as Uint8Array;
    expect(() => snapshotFacebookNativePlan(plan)).toThrow('payload is invalid');
  });

  it('refuses unsupported plan fields and absent media before claiming an operation', async () => {
    const attempts = { begin: vi.fn(), get: vi.fn(), update: vi.fn() }; const remote = transport();
    const plans = [{ ...reel(), scheduledUnix: 1800000000 }, { format: 'story_photo', targetId: 'page', description: 'Discarded',
      media: { kind: 'image', url: 'https://example.invalid/i.jpg' } }, { ...video(), media: undefined }];
    for (const value of plans) {
      await expect(executeFacebookNative(value as FacebookNativePlan, 'op', { attempts, transport: remote })).rejects.toThrow('payload is invalid');
    }
    expect(attempts.begin).not.toHaveBeenCalled(); expect(remote.postGraph).not.toHaveBeenCalled();
  });

  it.each([undefined, null, { created: 1 }, { created: false }])('refuses malformed begin result %s before dispatch', async result => {
    const base = createMemoryAttemptStore(); const remote = transport();
    const attempts = { ...base, begin: vi.fn(async () => result) } as unknown as FacebookNativeAttemptStore;
    await expect(executeFacebookNative(video(), 'op', { attempts, transport: remote })).rejects.toThrow('attempt record is unavailable');
    expect(remote.postGraph).not.toHaveBeenCalled();
  });

  it('keeps hashless historical attempts held rather than claiming a payload match', async () => {
    const attempts = createMemoryAttemptStore(); const remote = transport();
    await attempts.begin({ operationId: 'old', format: 'video', state: 'uncertain', knownIds: ['old-id'] });
    await expect(executeFacebookNative(video(), 'old', { attempts, transport: remote })).rejects.toBeInstanceOf(FacebookNativePayloadConflictError);
    expect(remote.postGraph).not.toHaveBeenCalled();
    expect(await attempts.get('old')).toMatchObject({ state: 'uncertain', knownIds: ['old-id'] });
  });

  it('dispatches the snapshot when caller mutates content during begin', async () => {
    const input = reel(); const base = createMemoryAttemptStore();
    const attempts: FacebookNativeAttemptStore = { ...base, async begin(row) {
      input.targetId = 'other'; if ('description' in input) input.description = 'Changed';
      input.media.bytes!.fill(9); input.media.fileName = 'changed.mp4';
      await Promise.resolve(); return base.begin(row);
    } };
    const postGraph = vi.fn().mockResolvedValueOnce({ video_id: 'video', upload_url: 'https://example.invalid/upload' }).mockResolvedValueOnce({ success: true });
    const upload = vi.fn(async (_url: string, media: FacebookNativeMedia) => {
      expect([...media.bytes!]).toEqual([1, 2, 3]); expect(media.fileName).toBe('original.mp4');
    });
    expect(await executeFacebookNative(input, 'op', { attempts, transport: { postGraph, upload } })).toMatchObject({ status: 'submitted', url: null, readbackRequired: true });
    expect(postGraph.mock.calls[0][0]).toBe('page/video_reels');
    expect(postGraph.mock.calls[1][1]).toMatchObject({ description: 'Original caption' });
    expect((await base.get('op'))?.payloadHash).toBe(snapshotFacebookNativePlan(reel()).payloadHash);
  });

  it('rejects changed content under a reused operation without a second provider call', async () => {
    const attempts = createMemoryAttemptStore(); const remote = transport();
    await executeFacebookNative(video(), 'op', { attempts, transport: remote });
    const changed = video(); if ('description' in changed) changed.description = 'Other';
    await expect(executeFacebookNative(changed, 'op', { attempts, transport: remote })).rejects.toBeInstanceOf(FacebookNativePayloadConflictError);
    expect((await executeFacebookNative(video(), 'op', { attempts, transport: remote })).status).toBe('already_attempted');
    expect(remote.postGraph).toHaveBeenCalledTimes(1);
  });
});

describe('native receipt truthfulness', () => {
  it.each(['throw', 'false', 'void'])('holds a provider success when settlement returns %s', async mode => {
    const base = createMemoryAttemptStore(); const attempts: FacebookNativeAttemptStore = { ...base, async update(id, patch, expected) {
      if (patch.state === 'published') { if (mode === 'throw') throw new Error('database unavailable'); return (mode === 'false' ? false : undefined) as boolean; }
      return base.update(id, patch, expected);
    } };
    const remote = transport();
    expect(await executeFacebookNative(video(), 'op', { attempts, transport: remote })).toMatchObject({ status: 'uncertain', phase: 'receipt_settlement', knownIds: ['video'] });
    expect((await base.get('op'))?.state).toBe('started');
    expect((await executeFacebookNative(video(), 'op', { attempts, transport: remote })).status).toBe('already_attempted');
    expect(remote.postGraph).toHaveBeenCalledTimes(1);
  });

  it('keeps an upload ID separate from a final publication ID on ambiguity', async () => {
    const attempts = createMemoryAttemptStore(); const postGraph = vi.fn().mockResolvedValueOnce({ video_id: 'upload', upload_url: 'https://example.invalid/upload' }).mockRejectedValueOnce(new Error('network'));
    expect((await executeFacebookNative(reel(), 'op', { attempts, transport: { postGraph, upload: vi.fn() } })).status).toBe('uncertain');
    expect(await attempts.get('op')).toMatchObject({ remoteId: null, knownIds: ['upload'] });
  });

  it('deduplicates IDs returned by separate phases while preserving both receipts', async () => {
    const attempts = createMemoryAttemptStore(); const plan: FacebookNativePlan = { format: 'story_photo', targetId: 'page', media: { kind: 'image', url: 'https://example.invalid/i.jpg' } };
    const postGraph = vi.fn().mockResolvedValueOnce({ id: 'same' }).mockResolvedValueOnce({ post_id: 'same' });
    expect((await executeFacebookNative(plan, 'op', { attempts, transport: { postGraph, upload: vi.fn() } })).status).toBe('submitted');
    expect(await attempts.get('op')).toMatchObject({ knownIds: ['same'], remoteId: 'same', steps: [{ phase: 'photo_upload', confirmed: true }, { phase: 'story_create', confirmed: true }] });
  });
});
