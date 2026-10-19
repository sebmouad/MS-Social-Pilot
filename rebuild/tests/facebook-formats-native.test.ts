import { describe, expect, it, vi } from 'vitest';
import { FacebookApiError } from '../src/platforms/facebook/publishing';
import { createMemoryAttemptStore, executeFacebookNative, planFacebookNative, FacebookNativeValidationError, FACEBOOK_NATIVE_CAPABILITIES } from '../src/platforms/facebook/formats';
import type { FacebookNativeMedia, FacebookNativeTransport } from '../src/platforms/facebook/formats';

const now = new Date('2026-01-01T00:00:00Z');
const vid: FacebookNativeMedia = { kind: 'video', url: 'https://cdn.example/v.mp4', sizeBytes: 1e6, durationSeconds: 30, width: 540, height: 960 };
const img: FacebookNativeMedia = { kind: 'image', url: 'https://cdn.example/i.png', sizeBytes: 1e5, width: 540, height: 960 };
const base = { targetId: 'P1', targetKind: 'page', media: [vid], now };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as FacebookNativeValidationError).code; } return null; };

describe('planFacebookNative', () => {
  it('routes formats', () => {
    expect(planFacebookNative({ ...base, format: 'post', text: 'hi', link: 'https://x.y' })).toMatchObject({ format: 'video', description: 'hi\n\nhttps://x.y' });
    expect(planFacebookNative({ ...base, format: 'reel' }).format).toBe('reel');
    expect(planFacebookNative({ ...base, format: 'story' }).format).toBe('story_video');
    expect(planFacebookNative({ ...base, format: 'story', media: [img] }).format).toBe('story_photo');
  });
  it('validates', () => {
    expect(code(() => planFacebookNative({ ...base, format: 'reel', targetKind: 'group' }))).toBe('target_kind_unsupported');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [vid, vid] }))).toBe('single_video_required');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [vid, img] }))).toBe('mixed_media');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [img] }))).toBe('single_video_required');
    expect(code(() => planFacebookNative({ ...base, format: 'story', media: [img, img] }))).toBe('single_media_required');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', scheduledAt: new Date(now.getTime() + 3600e3) }))).toBe('schedule_unsupported_for_format');
    expect(code(() => planFacebookNative({ ...base, format: 'post', scheduledAt: new Date(now.getTime() + 60e3) }))).toBe('schedule_too_soon');
    expect(code(() => planFacebookNative({ ...base, format: 'post', scheduledAt: new Date(now.getTime() + 31 * 86400e3) }))).toBe('schedule_too_far');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [{ ...vid, url: 'http://a/b' }] }))).toBe('media_url_not_https');
    expect(code(() => planFacebookNative({ ...base, format: 'reel', media: [{ kind: 'video' }] }))).toBe('media_source_missing');
    expect(code(() => planFacebookNative({ ...base, format: 'post', media: [img] }))).toBe('format_not_planned');
  });
  it('plans native schedule', () => {
    const p = planFacebookNative({ ...base, format: 'post', scheduledAt: new Date(now.getTime() + 3600e3) });
    expect(p).toMatchObject({ scheduledUnix: now.getTime() / 1000 + 3600 });
  });
  it('declares no wired capability', () => {
    expect(FACEBOOK_NATIVE_CAPABILITIES.every((c) => c.wired === false)).toBe(true);
  });
});

function mk(responses: Array<Record<string, unknown> | Error>, upload?: Error) {
  const post = vi.fn(async (..._a: unknown[]) => { const r = responses.shift()!; if (r instanceof Error) throw r; return r; });
  const up = vi.fn(async () => { if (upload) throw upload; });
  return { transport: { postGraph: post, upload: up } as FacebookNativeTransport, post, up, attempts: createMemoryAttemptStore() };
}
const plan = (format: 'post' | 'reel' | 'story', media = [vid]) => planFacebookNative({ ...base, format, media });

describe('executeFacebookNative', () => {
  it('publishes a reel via start, upload, finish', async () => {
    const d = mk([{ video_id: 'V1', upload_url: 'https://up/x' }, { success: true }]);
    const o = await executeFacebookNative(plan('reel'), 'op1', d);
    expect(o).toMatchObject({ status: 'submitted', remoteId: 'V1', url: null, readbackRequired: true });
    expect(d.post.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['P1/video_reels', 'P1/video_reels']);
    expect(d.up).toHaveBeenCalledTimes(1);
  });
  it('publishes photo story and scheduled video', async () => {
    const s = mk([{ id: 'PH' }, { post_id: 'S1' }]);
    expect(await executeFacebookNative(plan('story', [img]), 'op2', s)).toMatchObject({ status: 'submitted', remoteId: 'S1' });
    const p = planFacebookNative({ ...base, format: 'post', scheduledAt: new Date(now.getTime() + 3600e3) });
    const v = mk([{ id: 'VID' }]);
    const o = await executeFacebookNative(p, 'op3', v);
    expect(o).toMatchObject({ status: 'submitted', scheduled: true });
    expect((v.post.mock.calls[0] as unknown[])[1]).toMatchObject({ published: 'false', file_url: vid.url });
  });
  it('routes direct video and photo Story bytes only through the binary port', async () => {
    const videoBytes = new Uint8Array([1, 2, 3]);
    const videoPlan = planFacebookNative({ ...base, format: 'post', media: [{ ...vid, url: undefined, bytes: videoBytes, sizeBytes: 3, mimeType: 'video/mp4' }] });
    const postGraphFile = vi.fn(async () => ({ id: 'VID-BYTES' }));
    const videoTransport = { postGraph: vi.fn(), postGraphFile, upload: vi.fn() } as unknown as FacebookNativeTransport;
    expect(await executeFacebookNative(videoPlan, 'bytes-video', { transport: videoTransport, attempts: createMemoryAttemptStore() })).toMatchObject({ status: 'submitted', remoteId: 'VID-BYTES' });
    expect(postGraphFile).toHaveBeenCalledWith('P1/videos', {}, expect.objectContaining({ bytes: new Uint8Array([1, 2, 3]) }));
    expect(videoTransport.postGraph).not.toHaveBeenCalled();

    const photoBytes = new Uint8Array([4, 5]);
    const photoPlan = planFacebookNative({ ...base, format: 'story', media: [{ ...img, url: undefined, bytes: photoBytes, sizeBytes: 2, mimeType: 'image/jpeg' }] });
    const photoPort = vi.fn(async (_path: string, _body: Record<string, string>, _media: FacebookNativeMedia) => ({ id: 'PHOTO-BYTES' }));
    const photoPost = vi.fn(async () => ({ post_id: 'STORY-BYTES' }));
    const photoTransport = { postGraph: photoPost, postGraphFile: photoPort, upload: vi.fn() } as unknown as FacebookNativeTransport;
    expect(await executeFacebookNative(photoPlan, 'bytes-photo', { transport: photoTransport, attempts: createMemoryAttemptStore() })).toMatchObject({ status: 'submitted', remoteId: 'STORY-BYTES' });
    expect(photoPort.mock.calls.map(call => call[0])).toEqual(['P1/photos']); // Story creation is form-encoded.
    expect(photoPost).toHaveBeenCalledWith('P1/photo_stories', { photo_id: 'PHOTO-BYTES' });
  });
  it('holds direct bytes when the binary port is unavailable instead of falling back to a URL', async () => {
    const bytePlan = planFacebookNative({ ...base, format: 'post', media: [{ ...vid, url: undefined, bytes: new Uint8Array([1]), sizeBytes: 1, mimeType: 'video/mp4' }] });
    const postGraph = vi.fn();
    const outcome = await executeFacebookNative(bytePlan, 'no-binary-port', { transport: { postGraph, upload: vi.fn() }, attempts: createMemoryAttemptStore() });
    expect(outcome).toMatchObject({ status: 'uncertain', phase: 'video_create' });
    expect(postGraph).not.toHaveBeenCalled();
  });
  it('definite rejection at start is rejected with no orphans', async () => {
    const d = mk([new FacebookApiError('bad', 400, 100)]);
    expect(await executeFacebookNative(plan('reel'), 'op4', d)).toMatchObject({ status: 'rejected', code: 100, orphanIds: [] });
  });
  it('timeout on finish is uncertain, keeps ids, no resend', async () => {
    const d = mk([{ video_id: 'V9', upload_url: 'https://up/y' }, new FacebookApiError('timeout', 0)]);
    const o = await executeFacebookNative(plan('reel'), 'op5', d);
    expect(o).toMatchObject({ status: 'uncertain', phase: 'reel_finish', knownIds: ['V9'] });
    expect(d.post).toHaveBeenCalledTimes(2);
    const again = await executeFacebookNative(plan('reel'), 'op5', d);
    expect(again).toMatchObject({ status: 'already_attempted', previous: { state: 'uncertain', knownIds: ['V9'] } });
    expect(d.post).toHaveBeenCalledTimes(2);
  });
  it('upload failure is uncertain; story second step rejection reports orphan photo', async () => {
    const d = mk([{ video_id: 'V2', upload_url: 'https://up/z' }], new Error('net'));
    expect(await executeFacebookNative(plan('reel'), 'op6', d)).toMatchObject({ status: 'uncertain', phase: 'upload_transfer' });
    const s = mk([{ id: 'PH2' }, new FacebookApiError('perm', 403, 200)]);
    expect(await executeFacebookNative(plan('story', [img]), 'op7', s)).toMatchObject({ status: 'rejected', orphanIds: ['PH2'] });
  });
  it('malformed answers and 5xx are uncertain, not rejected', async () => {
    expect(await executeFacebookNative(plan('post'), 'op8', mk([{}]))).toMatchObject({ status: 'uncertain', phase: 'video_create' });
    expect(await executeFacebookNative(plan('post'), 'op9', mk([new FacebookApiError('x', 400)]))).toMatchObject({ status: 'uncertain' });
  });
});
