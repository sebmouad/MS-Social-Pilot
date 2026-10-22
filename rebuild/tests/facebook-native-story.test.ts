import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/platforms/facebook/formats/journal', () => ({ executeFacebookNativeWithJournal: vi.fn() }));

import { createFacebookNativePublisher, isFacebookNativePublishFormat, type FacebookNativeInspected } from '../src/platforms/facebook/formats/publish';
import { createMemoryAttemptStore, executeFacebookNative } from '../src/platforms/facebook/formats/execute';
import { mapFacebookStoryStatus } from '../src/platforms/facebook/formats/status';
import { facebookNativeStatusEligible } from '../src/platforms/facebook/formats/status-recovery-contract';
import { facebookNativePolicyFrom } from '../src/platforms/facebook/native-config';
import { createFacebookAdapter, FacebookApiError } from '../src/platforms/facebook/publishing';
import type { PublishRequest } from '../src/platforms/types';
import type { FacebookNativeTransport } from '../src/platforms/facebook/formats/types';

const policy = facebookNativePolicyFrom();
const config = { graphBaseUrl: 'https://graph.example.com', oauthBaseUrl: 'https://www.example.com', graphVersion: 'v21.0', requestTimeoutMs: 1000, maxPages: 1, pageSize: 10,
  pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1000, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false };
const classifyFacebook = (error: unknown) => createFacebookAdapter(config).classifyPublishingFailure!(error);
const labels = { videoLabel: 'Video post', reelLabel: 'Reel', storyPhotoLabel: 'Photo Story', storyVideoLabel: 'Video Story' };
const publication = { workspaceId: 'w1', postId: 'p1', postTargetId: 'pt1', targetId: 't1', actorId: 'u1' };
const PHOTO: FacebookNativeInspected = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', sizeBytes: 3, width: 1080, height: 1920 };
const VIDEO: FacebookNativeInspected = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'video/mp4', sizeBytes: 4, width: 1080, height: 1920, durationSeconds: 15 };

function request(formatId: string, over: Partial<PublishRequest> = {}): PublishRequest {
  const photo = formatId === 'story_photo';
  return { credential: { accessToken: 'tok', grantedScopes: ['pages_manage_posts'] } as PublishRequest['credential'], target: { id: 'page-1', name: '', kind: 'page' },
    operationId: 'op-1', formatId, text: '', link: null, publication,
    media: [{ kind: photo ? 'image' : 'video', url: 'media:11111111-1111-1111-1111-111111111111',
      localFile: { bytes: (photo ? PHOTO : VIDEO).bytes, mimeType: photo ? 'image/jpeg' : 'video/mp4', fileName: photo ? 'a.jpg' : 'a.mp4' } }], ...over };
}

function harness(inspected: FacebookNativeInspected, transport: Partial<FacebookNativeTransport> = {}) {
  const attempts = createMemoryAttemptStore();
  const full: FacebookNativeTransport = {
    postGraph: vi.fn(async (path: string, body: Record<string, string>) => {
      if (path.endsWith('/photos')) return { id: 'photo-1' };
      if (path.endsWith('/photo_stories')) return { post_id: 'story-1' };
      return body.upload_phase === 'finish' ? { success: true, post_id: 'story-2' } : { video_id: 'v1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/v1' };
    }),
    postGraphFile: vi.fn(async () => ({ id: 'photo-2' })),
    upload: vi.fn(async () => undefined), ...transport,
  };
  const execute = vi.fn(async (binding: { operationId: string }, plan: Parameters<typeof executeFacebookNative>[0], deps: { transport: FacebookNativeTransport }) =>
    executeFacebookNative(plan, binding.operationId, { transport: deps.transport, attempts }));
  const inspect = vi.fn(async () => inspected);
  const resolveRemote = vi.fn(async () => inspected);
  const publish = createFacebookNativePublisher({ policy, transport: async () => full, inspect, resolveRemote, execute: execute as never, now: () => new Date('2026-10-20T12:00:00Z') });
  return { publish, transport: full, execute, inspect, resolveRemote, attempts };
}

describe('Story formats through the host publisher', () => {
  it('recognises both Story format ids', () => {
    expect(isFacebookNativePublishFormat('story_photo')).toBe(true);
    expect(isFacebookNativePublishFormat('story_video')).toBe(true);
    expect(isFacebookNativePublishFormat('story')).toBe(false);
  });

  it('publishes a stored photo as an unpublished photo then a photo Story, returning a submission', async () => {
    const h = harness(PHOTO);
    const result = await h.publish(request('story_photo'));
    // The staged photo id is never the publication identity; the Story post id is.
    expect(result).toEqual({ remoteId: 'story-1', url: null, state: 'submitted' });
    expect(h.inspect).toHaveBeenCalledWith(PHOTO.bytes, undefined, 'image');
    expect(h.transport.postGraphFile).toHaveBeenCalledWith('page-1/photos', { published: 'false' }, expect.objectContaining({ kind: 'image', width: 1080, height: 1920 }));
    expect(h.transport.postGraph).toHaveBeenCalledWith('page-1/photo_stories', { photo_id: 'photo-2' });
    const record = await h.attempts.get('op-1');
    expect(record?.steps?.map(s => s.phase)).toEqual(['photo_upload', 'story_create']);
  });

  it('lets Facebook fetch a remote photo after the guarded probe and returns the final Story id', async () => {
    const h = harness(PHOTO);
    const remote = request('story_photo', { media: [{ kind: 'image', url: 'https://cdn.example.com/a.jpg' }] });
    const result = await h.publish(remote);
    expect(result).toEqual({ remoteId: 'story-1', url: null, state: 'submitted' });
    expect(h.resolveRemote).toHaveBeenCalledWith('https://cdn.example.com/a.jpg', undefined, 'image');
    expect(h.transport.postGraph).toHaveBeenCalledWith('page-1/photos', { published: 'false', url: 'https://cdn.example.com/a.jpg' });
  });

  it('uploads a video Story through the resumable phases and returns the Story post id, not the staged video', async () => {
    const h = harness(VIDEO);
    const result = await h.publish(request('story_video'));
    expect(result).toEqual({ remoteId: 'story-2', url: null, state: 'submitted' });
    expect(h.inspect).toHaveBeenCalledWith(VIDEO.bytes, undefined, 'video');
    expect(h.transport.upload).toHaveBeenCalledOnce();
    expect(h.transport.postGraph).toHaveBeenCalledWith('page-1/video_stories', { upload_phase: 'start' });
    expect(h.transport.postGraph).toHaveBeenCalledWith('page-1/video_stories', { upload_phase: 'finish', video_id: 'v1' });
    const record = await h.attempts.get('op-1');
    expect(record?.steps?.map(s => s.phase)).toEqual(['upload_start', 'upload_transfer', 'story_finish']);
    expect(record?.knownIds).toEqual(['v1', 'story-2']);
  });

  it('refuses caption, link, schedule, wrong media kind and out-of-policy frames before any claim or transport', async () => {
    const cases: Array<[string, PublishRequest, FacebookNativeInspected]> = [
      ['caption on a photo Story', request('story_photo', { text: 'Hello' }), PHOTO],
      ['link on a video Story', request('story_video', { link: 'https://example.com' }), VIDEO],
      ['schedule on a Story', request('story_video', { scheduledAt: new Date('2026-10-21T12:00:00Z') }), VIDEO],
      ['video for a photo Story', request('story_photo', { media: request('story_video').media }), PHOTO],
      ['photo for a video Story', request('story_video', { media: request('story_photo').media }), VIDEO],
      ['two photos', request('story_photo', { media: [request('story_photo').media![0]!, request('story_photo').media![0]!] }), PHOTO],
      ['landscape photo', request('story_photo'), { ...PHOTO, width: 1920, height: 1080 }],
      ['video too long', request('story_video'), { ...VIDEO, durationSeconds: 600 }],
      ['no publication context', request('story_photo', { publication: undefined }), PHOTO],
    ];
    for (const [label, req, inspected] of cases) {
      const h = harness(inspected);
      const error = await h.publish(req).catch((e: unknown) => e);
      expect(error, label).toBeInstanceOf(FacebookApiError);
      expect(classifyFacebook(error), label).toBe('rejected');
      expect(h.execute, label).not.toHaveBeenCalled();
    }
  });

  it('never resends an uncertain Story step and holds staged objects after a later rejection', async () => {
    const timeout = harness(PHOTO, { postGraph: vi.fn(async (path: string) => { if (path.endsWith('/photos')) return { id: 'photo-1' }; throw new FacebookApiError('timeout', 0); }) });
    const remote = request('story_photo', { media: [{ kind: 'image', url: 'https://cdn.example.com/a.jpg' }] });
    expect(classifyFacebook(await timeout.publish(remote).catch((e: unknown) => e))).toBe('uncertain');
    expect(classifyFacebook(await timeout.publish(remote).catch((e: unknown) => e))).toBe('uncertain');
    expect((timeout.transport.postGraph as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0].endsWith('/photo_stories'))).toHaveLength(1);
    const staged = harness(PHOTO, { postGraph: vi.fn(async (path: string) => { if (path.endsWith('/photos')) return { id: 'photo-1' }; throw new FacebookApiError('bad', 400, 100); }) });
    expect(classifyFacebook(await staged.publish(remote).catch((e: unknown) => e))).toBe('uncertain');
  });

  it('keeps a Story submission without a final identity uncertain', async () => {
    const h = harness(VIDEO, { postGraph: vi.fn(async (_p: string, body: Record<string, string>) => body.upload_phase === 'finish' ? { success: true } : { video_id: 'v1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/v1' }) });
    expect(classifyFacebook(await h.publish(request('story_video')).catch((e: unknown) => e))).toBe('uncertain');
  });
});

describe('Story status mapping and eligibility', () => {
  it('is positive only for one exact published entry', () => {
    expect(mapFacebookStoryStatus('s1', { data: [{ post_id: 's1', status: 'PUBLISHED' }] })).toEqual({ status: 'published', detail: null });
    expect(mapFacebookStoryStatus('s1', { data: [{ post_id: 's1', status: 'published' }] }).status).toBe('published');
    expect(mapFacebookStoryStatus('s1', { data: [] })).toEqual({ status: 'unknown', detail: 'story_not_listed' });
    expect(mapFacebookStoryStatus('s1', { data: [{ post_id: 's10', status: 'PUBLISHED' }] }).detail).toBe('story_not_listed');
    expect(mapFacebookStoryStatus('s1', { data: [{ post_id: 's1', status: 'PUBLISHED' }, { post_id: 's1', status: 'PUBLISHED' }] }).detail).toBe('story_ambiguous');
    expect(mapFacebookStoryStatus('s1', { data: [{ post_id: 's1', status: 'ARCHIVED' }] }).status).toBe('unknown');
    expect(mapFacebookStoryStatus('s1', { data: [{ post_id: 's1' }] }).detail).toBe('status_missing');
    expect(mapFacebookStoryStatus('s1', {}).detail).toBe('status_shape_invalid');
  });

  it('adapter reads a Story from the Stories edge only while the switch is on', async () => {
    const scopes = { postPublishScopes: ['pages_manage_posts'], postReadScopes: ['pages_read_engagement'] };
    const calls: string[] = [];
    const answer = (body: unknown, status = 200) => vi.fn(async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
    const req = { credential: { accessToken: 'tok', grantedScopes: ['pages_read_engagement'] }, target: { id: 'page-1', name: '', kind: 'page' }, remoteId: 'story-1', formatId: 'story_photo' };
    const on = createFacebookAdapter(config, answer({ data: [{ post_id: 'story-1', status: 'PUBLISHED' }] }), { ...scopes, native: { publish: vi.fn(), ...labels } });
    expect(await on.getRemoteStatus!(req as never)).toEqual({ state: 'published', remoteId: 'story-1', targetId: 'page-1', publishedAt: null });
    expect(calls[0]).toContain('/page-1/stories');
    expect(calls[0]).toContain('fields=post_id%2Cstatus%2Ccreation_time');
    const missing = createFacebookAdapter(config, answer({ data: [] }), { ...scopes, native: { publish: vi.fn(), ...labels } });
    expect(await missing.getRemoteStatus!(req as never)).toMatchObject({ state: 'unknown' });
    const inaccessible = createFacebookAdapter(config, answer({ error: { message: 'x', code: 100, error_subcode: 33 } }, 400), { ...scopes, native: { publish: vi.fn(), ...labels } });
    expect(await inaccessible.getRemoteStatus!(req as never)).toMatchObject({ state: 'unknown' });
    const off = createFacebookAdapter(config, answer({}), scopes);
    await expect(off.getRemoteStatus!(req as never)).rejects.toBeInstanceOf(FacebookApiError);
  });

  it('accepts a Story for recovery only with its complete chain and exactly staged plus final identities', () => {
    const photo = { format: 'story_photo', state: 'published', remoteId: 'story-1', knownIds: ['photo-1', 'story-1'], conflicted: false,
      steps: [{ phase: 'photo_upload', dispatched: true, confirmed: true }, { phase: 'story_create', dispatched: true, confirmed: true }] };
    expect(facebookNativeStatusEligible(photo)).toBe(true);
    expect(facebookNativeStatusEligible({ ...photo, knownIds: ['story-1'] })).toBe(false);
    expect(facebookNativeStatusEligible({ ...photo, knownIds: ['photo-1', 'photo-2'] })).toBe(false);
    expect(facebookNativeStatusEligible({ ...photo, knownIds: ['photo-1', 'story-1', 'extra'] })).toBe(false);
    expect(facebookNativeStatusEligible({ ...photo, steps: photo.steps.slice(0, 1) })).toBe(false);
    expect(facebookNativeStatusEligible({ ...photo, conflicted: true })).toBe(false);
    const video = { format: 'story_video', state: 'uncertain', remoteId: 'story-2', knownIds: ['v1', 'story-2'], conflicted: false,
      steps: ['upload_start', 'upload_transfer', 'story_finish'].map(phase => ({ phase, dispatched: true, confirmed: true })) };
    expect(facebookNativeStatusEligible(video)).toBe(true);
    // Video and Reel keep the sole-identity rule.
    expect(facebookNativeStatusEligible({ format: 'video', state: 'published', remoteId: 'v', knownIds: ['v', 'x'], conflicted: false,
      steps: [{ phase: 'video_create', dispatched: true, confirmed: true }] })).toBe(false);
  });
});

describe('Reel follow-ups', () => {
  it('delegates a Reel first comment and delete to the same Graph edges as other posts', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify(init?.method === 'DELETE' ? { success: true } : { id: 'c1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetchMock, { postDeleteScopes: ['pages_manage_posts'], firstCommentScopes: ['pages_manage_engagement'], native: { publish: vi.fn(), ...labels } });
    const reel = adapter.publishingFormats!.find(f => f.id === 'reel')!;
    expect(reel).toMatchObject({ firstComment: true, remoteDelete: true });
    expect(await adapter.publishFirstComment!({ credential: { accessToken: 't', grantedScopes: ['pages_manage_engagement'] } as never, remotePostId: 'reel-1', text: 'Hi' })).toEqual({ remoteId: 'c1' });
    await adapter.deleteRemote!({ credential: { accessToken: 't', grantedScopes: ['pages_manage_posts'] } as never, remoteId: 'reel-1' });
    expect(calls.map(c => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /v21.0/reel-1/comments', 'DELETE /v21.0/reel-1']);
    // Without the grants nothing is sent.
    await expect(adapter.deleteRemote!({ credential: { accessToken: 't', grantedScopes: [] } as never, remoteId: 'reel-1' })).rejects.toBeInstanceOf(FacebookApiError);
    expect(calls).toHaveLength(2);
  });
});

describe('Story proof migration', () => {
  const sql = readFileSync(new URL('../prisma/migrations/20261030100000_rebuild_facebook_native_story_proofs/migration.sql', import.meta.url), 'utf8');
  it('is additive: widens the format check and the accepted-proof guard only', () => {
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|ALTER COLUMN|DROP COLUMN/i);
    expect(sql).toContain(`"format" IN ('video', 'reel', 'story_photo', 'story_video')`);
    expect(sql).toContain(`ARRAY['photo_upload', 'story_create']`);
    expect(sql).toContain(`ARRAY['upload_start', 'upload_transfer', 'story_finish']`);
    expect(sql).toContain('jsonb_array_length(child_row."knownIds") <> 2');
    expect(sql).toContain('IF TG_OP = \'UPDATE\' THEN');
  });
});
