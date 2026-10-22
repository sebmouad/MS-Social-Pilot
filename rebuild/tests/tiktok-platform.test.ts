import { describe, expect, it, vi } from 'vitest';
import { createTiktokAdapter } from '../src/platforms/tiktok/adapter';
import { createTiktokApi } from '../src/platforms/tiktok/api';
import { TIKTOK_CONFIG, TIKTOK_POLICY_DEFAULTS, tiktokPolicySchema } from '../src/platforms/tiktok/config';
import { tiktokModule } from '../src/platforms/tiktok/module';
import { ProviderHttpError } from '../src/server/platforms/provider-http';
import type { PublishRequest } from '../src/platforms/types';

const policy = { ...TIKTOK_POLICY_DEFAULTS, statusPollAttempts: 3, statusPollIntervalMs: 100 };
const credential = { accessToken: 'fixture-token', grantedScopes: [...policy.publishScopes] };
const target = { id: 'open-id-1', name: 'Example creator', kind: 'tiktok' };
const request: PublishRequest = { credential, target, text: 'A caption', media: [{ kind: 'video', url: 'https://media.example.test/clip.mp4' }] };
const resolve = async () => ['93.184.216.34'];
const ok = (data: unknown) => new Response(JSON.stringify({ data, error: { code: 'ok', message: '', log_id: 'x' } }), { status: 200 });

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
const creator = (levels: string[]) => () => ok({ privacy_level_options: levels });
const init = () => ok({ publish_id: 'v_pub_1', upload_url: 'https://upload.tiktok.example.test/u/1' });
const uploaded = () => new Response(null, { status: 201 });
const status = (value: string, ids: string[] = []) => () => ok({ status: value, publicaly_available_post_id: ids });
const wait = vi.fn(async () => undefined);
const adapterWith = (fetcher: typeof fetch) => createTiktokAdapter(policy, { fetch: fetcher, clientKey: 'key', clientSecret: 'secret', resolve, wait });

describe('TikTok module declaration', () => {
  it('declares only operations it implements', () => {
    expect(tiktokModule.capabilities).toMatchObject({ connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' });
    const adapter = adapterWith(vi.fn() as unknown as typeof fetch);
    expect(adapter.capabilities).toEqual(tiktokModule.capabilities);
    expect(adapter.deleteRemote).toBeUndefined();
    expect(adapter.publishFirstComment).toBeUndefined();
    expect(adapter.canUseCredential!(credential, 'remoteDelete')).toBe(false);
    expect(adapter.canUseCredential!(credential, 'publishing')).toBe(true);
    expect(adapter.canUseCredential!({ accessToken: 't', grantedScopes: ['user.info.basic'] }, 'publishing')).toBe(false);
  });
  it('registers a switch, access policy, credentials and a validated policy default', () => {
    const keys = TIKTOK_CONFIG.map(item => item.key);
    expect(keys).toEqual(expect.arrayContaining([tiktokModule.enabledKey, tiktokModule.access.includedByDefaultKey, tiktokModule.access.planFeaturesKey, 'tiktok.policy', ...tiktokModule.requiredSettings]));
    expect(TIKTOK_CONFIG.find(item => item.key === 'tiktok.clientSecret')?.kind).toBe('secret');
    expect(TIKTOK_CONFIG.find(item => item.key === 'platforms.tiktok.enabled')?.defaultValue).toBe(false);
    expect(tiktokPolicySchema.safeParse(TIKTOK_POLICY_DEFAULTS).success).toBe(true);
    expect(tiktokPolicySchema.safeParse({ ...TIKTOK_POLICY_DEFAULTS, apiBaseUrl: 'http://open.example.test' }).success).toBe(false);
  });
  it('offers one video format that carries no link and no provider-held schedule', () => {
    const adapter = adapterWith(vi.fn() as unknown as typeof fetch);
    expect(adapter.publishingFormats![0]).toMatchObject({ id: 'video', firstComment: false, remoteDelete: false, scheduling: { application: true, native: false } });
    expect(adapter.publishingMedia).toMatchObject({ kinds: ['video'], linkWithMedia: false });
  });
});

describe('TikTok publishing', () => {
  it('uploads in one chunk and reports a completed post', async () => {
    const { fetcher, calls } = fixture([() => media(), creator(['SELF_ONLY', 'PUBLIC_TO_EVERYONE']), init, uploaded, status('PUBLISH_COMPLETE', ['7300000000000000001'])]);
    const result = await adapterWith(fetcher).publish!(request);
    expect(result).toEqual({ remoteId: 'v_pub_1', url: 'https://www.tiktok.com/@/video/7300000000000000001', state: 'published' });
    const initBody = JSON.parse(String(calls[2]!.body));
    expect(initBody.post_info).toEqual({ title: 'A caption', privacy_level: 'PUBLIC_TO_EVERYONE' });
    expect(initBody.source_info).toEqual({ source: 'FILE_UPLOAD', video_size: 4, chunk_size: 4, total_chunk_count: 1 });
    const put = calls[3]!;
    expect(put.method).toBe('PUT');
    expect(put.headers.get('content-range')).toBe('bytes 0-3/4');
    // Credentials never go to the upload host or the media host.
    expect(put.headers.get('authorization')).toBeNull();
    expect(calls[0]!.headers.get('authorization')).toBeNull();
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer fixture-token');
  });
  it('falls back to the private level when the creator allows nothing more open', async () => {
    const { fetcher, calls } = fixture([() => media(), creator(['SELF_ONLY']), init, uploaded, status('PUBLISH_COMPLETE')]);
    const result = await adapterWith(fetcher).publish!(request);
    expect(JSON.parse(String(calls[2]!.body)).post_info.privacy_level).toBe('SELF_ONLY');
    expect(result.url).toBeNull();
  });
  it('follows Root’s privacy preference order', async () => {
    const strict = createTiktokAdapter({ ...policy, privacyPreference: ['MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] }, { fetch: undefined, clientKey: 'k', clientSecret: 's', resolve, wait });
    expect(strict).toBeDefined();
    const api = createTiktokApi({ ...policy, privacyPreference: ['MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] }, { clientKey: 'k', clientSecret: 's' });
    expect(api.pickPrivacy(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'])).toBe('MUTUAL_FOLLOW_FRIENDS');
    expect(api.pickPrivacy([])).toBe('SELF_ONLY');
  });
  it('reports a submission while TikTok is still processing, after a bounded number of checks', async () => {
    const { fetcher, calls } = fixture([() => media(), creator(['SELF_ONLY']), init, uploaded, status('PROCESSING_UPLOAD'), status('PROCESSING_UPLOAD'), status('PROCESSING_UPLOAD')]);
    wait.mockClear();
    const result = await adapterWith(fetcher).publish!(request);
    expect(result).toEqual({ remoteId: 'v_pub_1', url: null, state: 'submitted' });
    expect(calls.filter(call => call.url.endsWith('/post/publish/status/fetch/'))).toHaveLength(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it('still reports a submission when a status check itself fails: the bytes are already with TikTok', async () => {
    const { fetcher } = fixture([() => media(), creator(['SELF_ONLY']), init, uploaded, () => new Response('{}', { status: 500 })]);
    expect(await adapterWith(fetcher).publish!(request)).toMatchObject({ remoteId: 'v_pub_1', state: 'submitted' });
  });
  it('rejects a post TikTok failed to process', async () => {
    const { fetcher } = fixture([() => media(), creator(['SELF_ONLY']), init, uploaded, status('FAILED')]);
    const adapter = adapterWith(fetcher);
    const error = await adapter.publish!(request).catch(caught => caught);
    expect(adapter.classifyPublishingFailure!(error)).toBe('rejected');
    expect(error.message).toBe(policy.copy.processingFailed.en);
  });
  it('refuses unsupported requests before any network call', async () => {
    const { fetcher } = fixture([]);
    const adapter = adapterWith(fetcher);
    for (const patch of [
      { media: [] }, { media: [{ kind: 'image' as const, url: 'https://media.example.test/a.jpg' }] }, { link: 'https://example.test' },
      { scheduledAt: new Date(Date.now() + 3_600_000) }, { formatId: 'photo' }, { target: { ...target, kind: 'youtube' } },
      { text: 'x'.repeat(2201) }, { credential: { accessToken: 't', grantedScopes: [] } },
    ] satisfies Partial<PublishRequest>[]) {
      const error = await adapter.publish!({ ...request, ...patch }).catch(caught => caught);
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(adapter.classifyPublishingFailure!(error)).toBe('rejected');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects videos above the single-chunk limit without uploading', async () => {
    const { fetcher } = fixture([() => media()]);
    const small = createTiktokAdapter({ ...policy, maxVideoBytes: 2 }, { fetch: fetcher, resolve, wait });
    await expect(small.publish!(request)).rejects.toThrow(policy.copy.tooLarge.en);
  });
  it('treats an authorization error on a 200 answer as a permission failure, not an upload', async () => {
    const { fetcher, calls } = fixture([() => media(), () => new Response(JSON.stringify({ error: { code: 'access_token_invalid', message: 'x' } }), { status: 200 })]);
    const adapter = adapterWith(fetcher);
    const error = await adapter.publish!(request).catch(caught => caught);
    expect(error.message).toBe(policy.copy.permission.en);
    expect(adapter.classifyPublishingFailure!(error)).toBe('rejected');
    expect(calls).toHaveLength(2);
  });
  it('holds a lost upload answer as uncertain and does not check or resend', async () => {
    const { fetcher, calls } = fixture([() => media(), creator(['SELF_ONLY']), init, () => new Error('socket closed')]);
    const adapter = adapterWith(fetcher);
    const error = await adapter.publish!(request).catch(caught => caught);
    expect(adapter.classifyPublishingFailure!(error)).toBe('uncertain');
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  });
  it('refuses an upload address that is not https', async () => {
    const { fetcher } = fixture([() => media(), creator(['SELF_ONLY']), () => ok({ publish_id: 'p', upload_url: 'http://upload.example.test/u' })]);
    await expect(adapterWith(fetcher).publish!(request)).rejects.toBeInstanceOf(ProviderHttpError);
  });
});

describe('TikTok status', () => {
  const query = { credential, target, remoteId: 'v_pub_1' };
  it('confirms a completed publication for the destination', async () => {
    expect(await adapterWith(fixture([status('PUBLISH_COMPLETE', ['1'])]).fetcher).getRemoteStatus!(query)).toMatchObject({ state: 'published', remoteId: 'v_pub_1', targetId: 'open-id-1' });
  });
  it('leaves processing and failed publications unconfirmed', async () => {
    expect(await adapterWith(fixture([status('PROCESSING_UPLOAD')]).fetcher).getRemoteStatus!(query)).toEqual({ state: 'unknown' });
    expect(await adapterWith(fixture([status('FAILED')]).fetcher).getRemoteStatus!(query)).toEqual({ state: 'unknown' });
  });
});

describe('TikTok OAuth', () => {
  const api = (fetcher: typeof fetch) => createTiktokApi(policy, { clientKey: 'key', clientSecret: 'secret', fetch: fetcher });
  it('builds a PKCE authorization request with comma-separated scopes', () => {
    const url = new URL(api(vi.fn() as unknown as typeof fetch).authorizationUrl({ redirectUri: 'https://app.example.test/api/connections/tiktok/callback', state: 's1', challenge: 'chal' }));
    expect(url.searchParams.get('client_key')).toBe('key');
    expect(url.searchParams.get('scope')).toBe('user.info.basic,video.publish');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });
  it('exchanges a code with the verifier and records both lifetimes', async () => {
    const { fetcher, calls } = fixture([() => new Response(JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'open-id-1', scope: 'user.info.basic,video.publish' }), { status: 200 })]);
    const token = await api(fetcher).exchange({ code: 'c', redirectUri: 'https://app.example.test/cb', verifier: 'ver' });
    expect(token).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', openId: 'open-id-1', scopes: ['user.info.basic', 'video.publish'] });
    expect(token.grantExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30_000_000_000);
    const form = calls[0]!.body as URLSearchParams;
    expect(form.get('code_verifier')).toBe('ver');
    expect(form.get('grant_type')).toBe('authorization_code');
  });
  it('rotates the refresh token on renewal', async () => {
    const renewed = await api(fixture([() => new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 86400, refresh_expires_in: 31536000 }), { status: 200 })]).fetcher).refresh('r1');
    expect(renewed).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
    expect(renewed.grantExpiresAt).toBeInstanceOf(Date);
  });
  it('maps an error body on a 200 token answer to a rejected grant (400)', async () => {
    const error = await api(fixture([() => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }), { status: 200 })]).fetcher).refresh('dead').catch(caught => caught);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.status).toBe(400);
    expect(error.message).not.toMatch(/expired/);
  });
  it('reads the connected account', async () => {
    const user = await api(fixture([() => ok({ user: { open_id: 'open-id-1', display_name: 'Example creator', avatar_url: 'https://img.example.test/a.jpg' } })]).fetcher).user('t');
    expect(user).toEqual({ openId: 'open-id-1', name: 'Example creator', pictureUrl: 'https://img.example.test/a.jpg' });
  });
});
