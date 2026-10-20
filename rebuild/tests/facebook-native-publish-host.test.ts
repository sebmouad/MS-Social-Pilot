import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/platforms/facebook/formats/journal', () => ({ executeFacebookNativeWithJournal: vi.fn() }));

import { createFacebookNativePublisher, type FacebookNativeInspected } from '../src/platforms/facebook/formats/publish';
import { createMemoryAttemptStore, executeFacebookNative } from '../src/platforms/facebook/formats/execute';
import { facebookNativePolicyFrom } from '../src/platforms/facebook/native-config';
import { createFacebookAdapter, FacebookApiError } from '../src/platforms/facebook/publishing';
import type { PublishRequest } from '../src/platforms/types';
import type { FacebookNativeTransport } from '../src/platforms/facebook/formats/types';

const policy = facebookNativePolicyFrom();
/** The shared claim is released only for a definite rejection; this is the adapter's own classifier. */
const config = { graphBaseUrl: 'https://graph.example.com', oauthBaseUrl: 'https://www.example.com', graphVersion: 'v21.0', requestTimeoutMs: 1000, maxPages: 1, pageSize: 10,
  pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1000, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false };
const classifyFacebook = (error: unknown) => createFacebookAdapter(config).classifyPublishingFailure!(error);
const NOW = new Date('2026-10-20T12:00:00Z');
const GOOD: FacebookNativeInspected = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'video/mp4', sizeBytes: 4, width: 1080, height: 1920, durationSeconds: 20 };
const LANDSCAPE: FacebookNativeInspected = { ...GOOD, width: 1920, height: 1080 };
const publication = { workspaceId: 'w1', postId: 'p1', postTargetId: 'pt1', targetId: 't1', actorId: 'u1' };

function request(over: Partial<PublishRequest> = {}): PublishRequest {
  return { credential: { accessToken: 'tok', grantedScopes: ['pages_manage_posts'] } as PublishRequest['credential'], target: { id: 'page-1', name: '', kind: 'page' },
    operationId: 'op-1', formatId: 'video', text: 'Hello', link: null, publication,
    media: [{ kind: 'video', url: 'media:11111111-1111-1111-1111-111111111111', localFile: { bytes: GOOD.bytes, mimeType: 'video/mp4', fileName: 'clip.mp4' } }], ...over };
}

function harness(opts: { inspected?: FacebookNativeInspected; transport?: Partial<FacebookNativeTransport> } = {}) {
  const attempts = createMemoryAttemptStore();
  const transport: FacebookNativeTransport = {
    postGraph: vi.fn(async (_path: string, body: Record<string, string>) => body.upload_phase === 'finish' ? { success: true } : { video_id: 'v1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/v1' }),
    postGraphFile: vi.fn(async () => ({ id: 'vid-1' })),
    upload: vi.fn(async () => undefined), ...opts.transport,
  };
  const bindings: unknown[] = [];
  const execute = vi.fn(async (binding: { operationId: string }, plan: Parameters<typeof executeFacebookNative>[0], deps: { transport: FacebookNativeTransport }) => {
    bindings.push(binding);
    return executeFacebookNative(plan, binding.operationId, { transport: deps.transport, attempts });
  });
  const makeTransport = vi.fn(async () => transport);
  const inspect = vi.fn(async () => opts.inspected ?? GOOD);
  const resolveRemote = vi.fn(async () => opts.inspected ?? LANDSCAPE);
  const publish = createFacebookNativePublisher({ policy, transport: makeTransport, inspect, resolveRemote, execute: execute as never, now: () => NOW });
  return { publish, transport, execute, bindings, makeTransport, inspect, resolveRemote, attempts };
}

describe('native video and Reel dispatch through the host', () => {
  it('sends stored video bytes with a native schedule and returns a submission receipt', async () => {
    const h = harness({ inspected: LANDSCAPE });
    const at = new Date(NOW.getTime() + 3600_000);
    const result = await h.publish(request({ scheduledAt: at }));
    expect(result).toEqual({ remoteId: 'vid-1', url: null, state: 'submitted' });
    expect(h.inspect).toHaveBeenCalledOnce();
    expect(h.resolveRemote).not.toHaveBeenCalled();
    expect(h.transport.postGraphFile).toHaveBeenCalledWith('page-1/videos',
      expect.objectContaining({ published: 'false', scheduled_publish_time: String(Math.floor(at.getTime() / 1000)), description: 'Hello' }),
      expect.objectContaining({ kind: 'video', width: 1920, height: 1080 }));
    expect(h.bindings[0]).toEqual({ ...publication, operationId: 'op-1', remoteTargetId: 'page-1', sourceFormatId: 'video' });
    expect(h.makeTransport).toHaveBeenCalledWith('tok', undefined);
  });

  it('publishes a stored video immediately when no schedule is given', async () => {
    const h = harness({ inspected: LANDSCAPE });
    await h.publish(request());
    const body = (h.transport.postGraphFile as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(body.published).toBeUndefined();
    expect(body.scheduled_publish_time).toBeUndefined();
  });

  it('uploads a Reel from stored bytes through the resumable phases', async () => {
    const h = harness();
    const result = await h.publish(request({ formatId: 'reel', text: 'Reel' }));
    expect(result.state).toBe('submitted');
    expect(result.remoteId).toBe('v1');
    expect(h.transport.upload).toHaveBeenCalledOnce();
    expect(h.bindings[0]).toMatchObject({ sourceFormatId: 'reel' });
    expect((await h.attempts.get('op-1'))?.steps?.map(s => s.phase)).toEqual(['upload_start', 'upload_transfer', 'reel_finish']);
  });

  it('downloads a remote Reel through the guarded resolver and lets Facebook fetch a remote video post', async () => {
    const remote = request({ media: [{ kind: 'video', url: 'https://cdn.example.com/a.mp4' }] });
    const reel = harness({ inspected: GOOD });
    await reel.publish({ ...remote, formatId: 'reel' });
    expect(reel.resolveRemote).toHaveBeenCalledWith('https://cdn.example.com/a.mp4', undefined);
    expect(reel.transport.upload).toHaveBeenCalledOnce();
    const video = harness({ inspected: LANDSCAPE, transport: { postGraph: vi.fn(async () => ({ id: 'vid-2' })) } });
    expect((await video.publish(remote)).remoteId).toBe('vid-2');
    expect(video.transport.postGraph).toHaveBeenCalledWith('page-1/videos', expect.objectContaining({ file_url: 'https://cdn.example.com/a.mp4' }));
  });

  it('refuses before any claim or transport when the request cannot be planned', async () => {
    const cases: Array<[string, PublishRequest, ReturnType<typeof harness>?]> = [
      ['a schedule on a Reel', request({ formatId: 'reel', scheduledAt: new Date(NOW.getTime() + 3600_000) })],
      ['a schedule too soon', request({ scheduledAt: new Date(NOW.getTime() + 30_000) })],
      ['no publication context', request({ publication: undefined })],
      ['no operation id', request({ operationId: undefined })],
      ['two videos', request({ media: [request().media![0]!, request().media![0]!] })],
      ['an image', request({ media: [{ kind: 'image', url: 'https://cdn.example.com/a.jpg' }] })],
      ['a feed format', request({ formatId: 'post' })],
      ['a Story', request({ formatId: 'story' })],
      ['a non-Page target', request({ target: { id: 'g1', name: '', kind: 'group' } })],
    ];
    for (const [label, req] of cases) {
      const h = harness({ inspected: LANDSCAPE });
      const error = await h.publish(req).catch((e: unknown) => e);
      expect(error, label).toBeInstanceOf(FacebookApiError);
      expect(classifyFacebook(error), label).toBe('rejected');
      expect(h.execute, label).not.toHaveBeenCalled();
      expect(h.makeTransport, label).not.toHaveBeenCalled();
    }
  });

  it('rejects out-of-policy video metadata from the probe, never from the caller', async () => {
    const h = harness({ inspected: { ...GOOD, durationSeconds: 99999 } });
    const error = await h.publish(request({ formatId: 'reel' })).catch((e: unknown) => e);
    expect(classifyFacebook(error)).toBe('rejected');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('rejects a video that cannot be probed', async () => {
    const h = harness();
    h.inspect.mockRejectedValueOnce(new Error('ffprobe missing'));
    expect(classifyFacebook(await h.publish(request()).catch((e: unknown) => e))).toBe('rejected');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('keeps ambiguous provider outcomes uncertain and never resends', async () => {
    const h = harness({ inspected: LANDSCAPE, transport: { postGraphFile: vi.fn(async () => { throw new FacebookApiError('timeout', 0); }) } });
    const first = await h.publish(request()).catch((e: unknown) => e);
    expect(classifyFacebook(first)).toBe('uncertain');
    const again = await h.publish(request()).catch((e: unknown) => e);
    expect(classifyFacebook(again)).toBe('uncertain');
    expect(h.transport.postGraphFile).toHaveBeenCalledTimes(1);
  });

  it('treats a definite rejection without remote objects as rejected, and with staged objects as uncertain', async () => {
    const clean = harness({ inspected: LANDSCAPE, transport: { postGraphFile: vi.fn(async () => { throw new FacebookApiError('bad', 400, 100); }) } });
    expect(classifyFacebook(await clean.publish(request()).catch((e: unknown) => e))).toBe('rejected');
    const staged = harness({ transport: {
      postGraph: vi.fn().mockResolvedValueOnce({ video_id: 'v1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/v1' }).mockRejectedValueOnce(new FacebookApiError('bad', 400, 100)),
    } });
    expect(classifyFacebook(await staged.publish(request({ formatId: 'reel' })).catch((e: unknown) => e))).toBe('uncertain');
  });

  it('holds when the durable journal is unavailable instead of releasing the claim', async () => {
    const h = harness({ inspected: LANDSCAPE });
    h.execute.mockRejectedValueOnce(new Error('database down'));
    expect(classifyFacebook(await h.publish(request()).catch((e: unknown) => e))).toBe('uncertain');
    expect(h.transport.postGraphFile).not.toHaveBeenCalled();
  });
});

describe('adapter declaration behind the private switch', () => {
  const scopes = { postPublishScopes: ['pages_manage_posts'], postReadScopes: ['pages_read_engagement'] };

  it('declares only the feed format while the switch is off', () => {
    const adapter = createFacebookAdapter(config, fetch, scopes);
    expect(adapter.publishingFormats?.map(f => f.id)).toEqual(['post']);
    expect(adapter.publishingFormats?.some(f => f.scheduling.native)).toBe(false);
  });

  it('declares Video (native schedule) and Reel only while the switch is on', async () => {
    const publish = vi.fn(async () => ({ remoteId: 'x', url: null, state: 'submitted' as const }));
    const adapter = createFacebookAdapter(config, fetch, { ...scopes, native: { publish, videoLabel: 'Video post', reelLabel: 'Reel' } });
    const formats = adapter.publishingFormats!;
    expect(formats.map(f => f.id)).toEqual(['post', 'video', 'reel']);
    expect(formats.find(f => f.id === 'video')?.scheduling).toEqual({ application: true, native: true });
    expect(formats.find(f => f.id === 'reel')).toMatchObject({ scheduling: { application: true, native: false }, firstComment: false, remoteDelete: false, media: { kinds: ['video'], maxVideos: 1 } });
    const credential = { accessToken: 'tok', grantedScopes: ['pages_manage_posts'] } as PublishRequest['credential'];
    await adapter.publish!(request({ credential }));
    expect(publish).toHaveBeenCalledOnce();
  });

  it('refuses native formats and ungranted credentials when the switch is off', async () => {
    const off = createFacebookAdapter(config, fetch, scopes);
    await expect(off.publish!(request({ credential: { accessToken: 't', grantedScopes: ['pages_manage_posts'] } as never }))).rejects.toMatchObject({ status: 400, code: 100 });
    const publish = vi.fn();
    const on = createFacebookAdapter(config, fetch, { ...scopes, native: { publish, videoLabel: 'v', reelLabel: 'r' } });
    await expect(on.publish!(request({ credential: { accessToken: 't', grantedScopes: [] } as never }))).rejects.toBeInstanceOf(FacebookApiError);
    expect(publish).not.toHaveBeenCalled();
  });

  it('reads a native Reel through the Reel status mapper', async () => {
    const calls: string[] = [];
    const reelBody = { id: 'v1', from: { id: 'page-1' }, published: true, status: { video_status: 'ready', publishing_phase: { status: 'processing' } } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response(JSON.stringify(reelBody), { status: 200 }); }) as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetchMock, { ...scopes, native: { publish: vi.fn(), videoLabel: 'v', reelLabel: 'r' } });
    const req = { credential: { accessToken: 'tok', grantedScopes: ['pages_read_engagement'] }, target: { id: 'page-1', name: '', kind: 'page' }, remoteId: 'v1', formatId: 'reel', contentKind: 'video' as const };
    // The Reel publishing phase is still processing, so the shared status stays unknown instead of published.
    expect(await adapter.getRemoteStatus!(req as never)).toMatchObject({ state: 'unknown' });
    const done = { ...reelBody, status: { video_status: 'ready', publishing_phase: { status: 'complete' } } };
    const ok = createFacebookAdapter(config, vi.fn(async () => new Response(JSON.stringify(done), { status: 200 })) as unknown as typeof fetch, { ...scopes, native: { publish: vi.fn(), videoLabel: 'v', reelLabel: 'r' } });
    expect(await ok.getRemoteStatus!(req as never)).toMatchObject({ state: 'published', remoteId: 'v1', targetId: 'page-1' });
    expect(calls.length).toBe(1);
  });
});
