import { describe, expect, it, vi } from 'vitest';
import { createYoutubeAdapter } from '../src/platforms/youtube/adapter';
import { createYoutubeApi, youtubeDescription, youtubeTitle } from '../src/platforms/youtube/api';
import { YOUTUBE_CONFIG, YOUTUBE_POLICY_DEFAULTS, youtubePolicySchema } from '../src/platforms/youtube/config';
import { youtubeModule } from '../src/platforms/youtube/module';
import { ProviderHttpError } from '../src/server/platforms/provider-http';
import type { PublishRequest } from '../src/platforms/types';

const policy = YOUTUBE_POLICY_DEFAULTS;
const credential = { accessToken: 'fixture-token', grantedScopes: [...policy.publishScopes, ...policy.deleteScopes] };
const target = { id: 'UC-channel-1', name: 'Example channel', kind: 'youtube' };
const request: PublishRequest = { credential, target, text: 'First line title\nSecond line body', media: [{ kind: 'video', url: 'https://media.example.test/clip.mp4' }] };
const resolve = async () => ['93.184.216.34'];
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

type Call = { url: string; method: string; headers: Headers; body: unknown };
function fixture(handlers: Array<(call: Call) => Response | Error>) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body };
    calls.push(call);
    const handler = handlers.shift();
    if (!handler) throw new Error(`Unexpected request ${call.method} ${call.url}`);
    const response = handler(call);
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const media = () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '4' } });
const adapterWith = (fetcher: typeof fetch) => createYoutubeAdapter(policy, { fetch: fetcher, clientId: 'client', clientSecret: 'secret', resolve });

describe('YouTube module declaration', () => {
  it('declares only operations it implements', () => {
    expect(youtubeModule.capabilities).toMatchObject({ connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' });
    const adapter = adapterWith(vi.fn() as unknown as typeof fetch);
    expect(adapter.capabilities).toEqual(youtubeModule.capabilities);
    expect(adapter.listInbox).toBeUndefined();
    expect(adapter.getAnalytics).toBeUndefined();
    expect(adapter.publishFirstComment).toBeUndefined();
  });
  it('registers a switch, access policy, credentials and a validated policy default', () => {
    const keys = YOUTUBE_CONFIG.map(item => item.key);
    expect(keys).toEqual(expect.arrayContaining([youtubeModule.enabledKey, youtubeModule.access.includedByDefaultKey, youtubeModule.access.planFeaturesKey, 'youtube.policy', ...youtubeModule.requiredSettings]));
    expect(YOUTUBE_CONFIG.find(item => item.key === 'youtube.clientSecret')?.kind).toBe('secret');
    expect(YOUTUBE_CONFIG.find(item => item.key === 'platforms.youtube.enabled')?.defaultValue).toBe(false);
    expect(youtubePolicySchema.safeParse(policy).success).toBe(true);
    expect(youtubePolicySchema.safeParse({ ...policy, tokenUrl: 'http://insecure.example.test/token' }).success).toBe(false);
  });
  it('offers one video format with no first comment and no provider-held schedule', () => {
    const adapter = adapterWith(vi.fn() as unknown as typeof fetch);
    expect(adapter.publishingFormats).toHaveLength(1);
    expect(adapter.publishingFormats![0]).toMatchObject({ id: 'video', firstComment: false, remoteDelete: true, scheduling: { application: true, native: false } });
    expect(adapter.publishingMedia).toMatchObject({ kinds: ['video'], maxImages: 0, maxVideos: 1 });
  });
  it('localises the format label', () => {
    expect(createYoutubeAdapter(policy, { locale: 'fr' }).publishingFormats![0]!.label).toBe('Vidéo');
  });
});

describe('YouTube credential rules', () => {
  const adapter = adapterWith(vi.fn() as unknown as typeof fetch);
  it('requires the upload scopes to publish and the management scope to delete', () => {
    expect(adapter.canUseCredential!(credential, 'publishing')).toBe(true);
    expect(adapter.canUseCredential!({ accessToken: 't', grantedScopes: policy.publishScopes }, 'remoteDelete')).toBe(false);
    expect(adapter.canUseCredential!({ accessToken: 't', grantedScopes: policy.deleteScopes }, 'publishing')).toBe(false);
    expect(adapter.canUseCredential!(credential, 'firstComment')).toBe(false);
  });
});

describe('YouTube text mapping', () => {
  it('uses the first non-empty line as a title without angle brackets, within the limit', () => {
    expect(youtubeTitle('\n  Hello <b>world</b>  \nbody', 100, 'Video')).toBe('Hello bworld/b');
    expect(youtubeTitle('x'.repeat(150), 100, 'Video')).toHaveLength(100);
    expect(youtubeTitle('   ', 100, 'Video')).toBe('Video');
  });
  it('appends the link once and enforces the description limit', () => {
    expect(youtubeDescription('Body', 'https://example.test/a', 5000)).toBe('Body\n\nhttps://example.test/a');
    expect(youtubeDescription('See https://example.test/a', 'https://example.test/a', 5000)).toBe('See https://example.test/a');
    expect(youtubeDescription('y'.repeat(6000), null, 5000)).toHaveLength(5000);
  });
});

describe('YouTube publishing', () => {
  it('downloads the video, starts a resumable upload on the configured origin and uploads the bytes', async () => {
    const { fetcher, calls } = fixture([
      () => media(),
      () => new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc' } }),
      () => json({ id: 'vid123' }),
    ]);
    const result = await adapterWith(fetcher).publish!({ ...request, link: 'https://example.test/post' });
    expect(result).toEqual({ remoteId: 'vid123', url: 'https://www.youtube.com/watch?v=vid123', state: 'published' });
    expect(calls.map(call => call.method)).toEqual(['GET', 'POST', 'PUT']);
    const start = calls[1]!;
    expect(new URL(start.url).searchParams.get('uploadType')).toBe('resumable');
    expect(start.headers.get('authorization')).toBe('Bearer fixture-token');
    expect(start.headers.get('x-upload-content-length')).toBe('4');
    const body = JSON.parse(String(start.body));
    expect(body.snippet).toMatchObject({ title: 'First line title', channelId: 'UC-channel-1' });
    expect(body.snippet.description).toBe('First line title\nSecond line body\n\nhttps://example.test/post');
    expect(body.status).toEqual({ privacyStatus: 'public', selfDeclaredMadeForKids: false });
    // The access token is never sent with the media download or the upload session.
    expect(calls[0]!.headers.get('authorization')).toBeNull();
    expect(calls[2]!.headers.get('authorization')).toBeNull();
  });
  it('uses the renewed access token supplied for the publication', async () => {
    const { fetcher, calls } = fixture([() => media(), () => new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc' } }), () => json({ id: 'v' })]);
    const freshToken = vi.fn(async () => 'renewed-token');
    const adapter = createYoutubeAdapter(policy, { fetch: fetcher, resolve, freshToken });
    await adapter.publish!({ ...request, publication: { workspaceId: 'w', postId: 'p', postTargetId: 'pt', targetId: 't', actorId: 'a' } });
    expect(freshToken).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w', targetId: 't' }), 'fixture-token');
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer renewed-token');
  });
  it('refuses unsupported requests before any network call', async () => {
    const { fetcher } = fixture([]);
    const adapter = adapterWith(fetcher);
    const refuse = async (patch: Partial<PublishRequest>) => {
      const error = await adapter.publish!({ ...request, ...patch }).catch(caught => caught);
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(adapter.classifyPublishingFailure!(error)).toBe('rejected');
    };
    await refuse({ media: [] });
    await refuse({ media: [{ kind: 'image', url: 'https://media.example.test/a.jpg' }] });
    await refuse({ media: [{ kind: 'video', url: 'https://media.example.test/a.mp4' }, { kind: 'video', url: 'https://media.example.test/b.mp4' }] });
    await refuse({ scheduledAt: new Date(Date.now() + 3_600_000) });
    await refuse({ formatId: 'story' });
    await refuse({ target: { ...target, kind: 'page' } });
    await refuse({ credential: { accessToken: 't', grantedScopes: [] } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses media that is not public https, private-address or too large', async () => {
    const adapter = adapterWith(fixture([]).fetcher);
    await expect(adapter.publish!({ ...request, media: [{ kind: 'video', url: 'http://media.example.test/a.mp4' }] })).rejects.toBeInstanceOf(ProviderHttpError);
    const priv = createYoutubeAdapter(policy, { fetch: fixture([]).fetcher, resolve: async () => ['10.0.0.5'] });
    await expect(priv.publish!(request)).rejects.toBeInstanceOf(ProviderHttpError);
    const big = createYoutubeAdapter({ ...policy, maxVideoBytes: 2 }, { fetch: fixture([() => media()]).fetcher, resolve });
    await expect(big.publish!(request)).rejects.toThrow(policy.copy.tooLarge.en);
  });
  it('treats a refused upload start as rejected (nothing exists remotely)', async () => {
    const { fetcher } = fixture([() => media(), () => new Response('{}', { status: 403 })]);
    const adapter = adapterWith(fetcher);
    const error = await adapter.publish!(request).catch(caught => caught);
    expect(adapter.classifyPublishingFailure!(error)).toBe('rejected');
    expect(error.message).toBe(policy.copy.permission.en);
    expect(error.message).not.toMatch(/403|googleapis/);
  });
  it('rejects an upload session on a different origin', async () => {
    const { fetcher } = fixture([() => media(), () => new Response('', { status: 200, headers: { location: 'https://evil.example.test/upload' } })]);
    await expect(adapterWith(fetcher).publish!(request)).rejects.toBeInstanceOf(ProviderHttpError);
  });
  it('holds a lost upload answer as uncertain and never retries it', async () => {
    const { fetcher, calls } = fixture([() => media(), () => new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc' } }), () => new Error('socket closed')]);
    const adapter = adapterWith(fetcher);
    const error = await adapter.publish!(request).catch(caught => caught);
    expect(adapter.classifyPublishingFailure!(error)).toBe('uncertain');
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  });
  it('holds an upload answer without a video id as uncertain', async () => {
    const { fetcher } = fixture([() => media(), () => new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc' } }), () => json({ kind: 'youtube#video' })]);
    const adapter = adapterWith(fetcher);
    expect(adapter.classifyPublishingFailure!(await adapter.publish!(request).catch(caught => caught))).toBe('uncertain');
  });
  it('classifies unknown errors as uncertain', () => {
    expect(adapterWith(vi.fn() as unknown as typeof fetch).classifyPublishingFailure!(new Error('boom'))).toBe('uncertain');
  });
});

describe('YouTube status and removal', () => {
  const status = { credential, target, remoteId: 'vid123' };
  it('confirms a video that belongs to the destination channel', async () => {
    const { fetcher, calls } = fixture([() => json({ items: [{ id: 'vid123', snippet: { channelId: 'UC-channel-1', publishedAt: '2026-10-20T10:00:00Z' }, status: { uploadStatus: 'processed', privacyStatus: 'public' } }] })]);
    const result = await adapterWith(fetcher).getRemoteStatus!(status);
    expect(result).toMatchObject({ state: 'published', remoteId: 'vid123', targetId: 'UC-channel-1' });
    expect(new URL(calls[0]!.url).searchParams.get('id')).toBe('vid123');
  });
  it('does not confirm another channel’s video, a missing video or a failed upload', async () => {
    for (const body of [
      { items: [{ id: 'vid123', snippet: { channelId: 'UC-other' }, status: { uploadStatus: 'processed' } }] },
      { items: [] },
      { items: [{ id: 'vid123', snippet: { channelId: 'UC-channel-1' }, status: { uploadStatus: 'failed' } }] },
    ]) {
      expect(await adapterWith(fixture([() => json(body)]).fetcher).getRemoteStatus!(status)).toEqual({ state: 'unknown' });
    }
  });
  it('deletes a video and treats an already-removed video as removed', async () => {
    const ok = fixture([() => new Response(null, { status: 204 })]);
    await adapterWith(ok.fetcher).deleteRemote!({ credential, remoteId: 'vid123' });
    expect(ok.calls[0]).toMatchObject({ method: 'DELETE' });
    expect(new URL(ok.calls[0]!.url).searchParams.get('id')).toBe('vid123');
    await expect(adapterWith(fixture([() => new Response('{}', { status: 404 })]).fetcher).deleteRemote!({ credential, remoteId: 'gone' })).resolves.toBeUndefined();
    await expect(adapterWith(fixture([() => new Response('{}', { status: 403 })]).fetcher).deleteRemote!({ credential, remoteId: 'x' })).rejects.toBeInstanceOf(ProviderHttpError);
  });
  it('refuses to delete without the management scope', async () => {
    const { fetcher } = fixture([]);
    await expect(adapterWith(fetcher).deleteRemote!({ credential: { accessToken: 't', grantedScopes: policy.publishScopes }, remoteId: 'v' })).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('YouTube OAuth', () => {
  const api = (fetcher: typeof fetch) => createYoutubeApi(policy, { clientId: 'client', clientSecret: 'secret', fetch: fetcher });
  it('builds an offline authorization request with every connect scope', () => {
    const url = new URL(api(vi.fn() as unknown as typeof fetch).authorizationUrl({ redirectUri: 'https://app.example.test/api/connections/youtube/callback', state: 's1' }));
    expect(url.origin + url.pathname).toBe(policy.authorizeUrl);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(policy.connectScopes);
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });
  it('exchanges a code and keeps the refresh token and granted scopes', async () => {
    const { fetcher, calls } = fixture([() => json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'one two' })]);
    const token = await api(fetcher).exchange({ code: 'code', redirectUri: 'https://app.example.test/cb' });
    expect(token).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', scopes: ['one', 'two'] });
    expect(token.accessExpiresAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
    const form = calls[0]!.body as URLSearchParams;
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_secret')).toBe('secret');
  });
  it('keeps the existing refresh token when Google sends none, and never expires the grant', async () => {
    const renewed = await api(fixture([() => json({ access_token: 'a2', expires_in: 3600 })]).fetcher).refresh('r1');
    expect(renewed).toMatchObject({ accessToken: 'a2', refreshToken: 'r1', grantExpiresAt: null });
  });
  it('surfaces a rejected refresh grant as a 400 so the connection can be marked for reconnection', async () => {
    const error = await api(fixture([() => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })]).fetcher).refresh('dead').catch(caught => caught);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.status).toBe(400);
  });
  it('lists every managed channel across pages and flags a truncated list', async () => {
    const channel = (id: string) => ({ id, snippet: { title: `Channel ${id}`, thumbnails: { default: { url: `https://img.example.test/${id}.jpg` } } } });
    const two = fixture([() => json({ items: [channel('a')], nextPageToken: 'n' }), () => json({ items: [channel('b')] })]);
    expect(await api(two.fetcher).channels('t')).toEqual({ items: [{ id: 'a', title: 'Channel a', pictureUrl: 'https://img.example.test/a.jpg' }, { id: 'b', title: 'Channel b', pictureUrl: 'https://img.example.test/b.jpg' }], truncated: false });
    expect(new URL(two.calls[1]!.url).searchParams.get('pageToken')).toBe('n');
    const bounded = createYoutubeApi({ ...policy, channelMaxPages: 1 }, { clientId: 'c', clientSecret: 's', fetch: fixture([() => json({ items: [channel('a')], nextPageToken: 'n' })]).fetcher });
    expect((await bounded.channels('t')).truncated).toBe(true);
  });
  it('returns no channels for an account without a YouTube channel', async () => {
    expect((await api(fixture([() => json({ items: [] })]).fetcher).channels('t')).items).toEqual([]);
  });
});
