import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { FacebookConfig } from '../src/platforms/facebook/config';
import { createFacebookNativeTransport } from '../src/platforms/facebook/formats/transport';
import { executeFacebookNative, createMemoryAttemptStore } from '../src/platforms/facebook/formats/execute';
import { planFacebookNative } from '../src/platforms/facebook/formats/plan';
import { FacebookApiError } from '../src/platforms/facebook/publishing';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: true, appSecret: 'app-secret',
};
const policy = { uploadOrigins: ['https://rupload.facebook.test'], maxUploadBytes: 8, maxResponseBytes: 128 } as const;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Facebook native signed transport', () => {
  it('refuses configured Graph endpoint query and fragment ambiguity before dispatch',()=>{
    const fetchImpl=vi.fn<typeof fetch>();
    for(const graphBaseUrl of ['https://graph.facebook.test?override=1','https://graph.facebook.test#fragment']){
      expect(()=>createFacebookNativeTransport({...config,graphBaseUrl},'token',policy,fetchImpl)).toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('signs GET, POST, and DELETE with the configured appsecret_proof', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ id: 'ok', success: true }));
    const transport = createFacebookNativeTransport(config, 'page-token', policy, fetchImpl);
    await transport.getGraph('123/videos', ['id', 'status']);
    await transport.postGraph('123/videos', { description: 'hello' });
    await transport.deleteGraph('123/videos/456');
    const expected = createHmac('sha256', 'app-secret').update('page-token').digest('hex');
    const getUrl = new URL(fetchImpl.mock.calls[0]![0] as URL);
    expect(getUrl.searchParams.get('access_token')).toBe('page-token');
    expect(getUrl.searchParams.get('appsecret_proof')).toBe(expected);
    expect(getUrl.searchParams.get('fields')).toBe('id,status');
    const postBody = fetchImpl.mock.calls[1]![1]!.body as URLSearchParams;
    expect(postBody.get('access_token')).toBe('page-token');
    expect(postBody.get('appsecret_proof')).toBe(expected);
    const deleteUrl = new URL(fetchImpl.mock.calls[2]![0] as URL);
    expect(deleteUrl.searchParams.get('appsecret_proof')).toBe(expected);
    expect(fetchImpl.mock.calls[0]![1]!.redirect).toBe('error');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects unsafe Graph paths and reserved credential fields before dispatch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({}));
    const transport = createFacebookNativeTransport(config, 'secret-token', policy, fetchImpl);
    for (const path of ['//attacker.test/x', '../escape', '123/%2e%2e/x', '123\\x', 'https://attacker.test']) {
      await expect(transport.getGraph(path, [])).rejects.toBeInstanceOf(FacebookApiError);
    }
    await expect(transport.postGraph('123/videos', { ACCESS_TOKEN: 'attacker' })).rejects.toBeInstanceOf(FacebookApiError);
    await expect(transport.postGraph('123/videos', { appsecret_proof: 'fake' })).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('restricts uploads to exact approved origins and documented upload paths', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ success: true }));
    const transport = createFacebookNativeTransport(config, 'token', policy, fetchImpl);
    for (const url of [
      'http://rupload.facebook.test/video-upload/123',
      'https://rupload.facebook.test.evil/video-upload/123',
      'https://user@rupload.facebook.test/video-upload/123',
      'https://rupload.facebook.test/video-upload/123?redirect=https://evil.test',
      'https://rupload.facebook.test/video-upload/v99.0/123 ',
      'https://rupload.facebook.test/video-upload/v99.0/123\n',
      'https://rupload.facebook.test/other/123',
      'https://rupload.facebook.test/video-upload/../123',
    ]) await expect(transport.upload(url, { kind: 'video', url: 'https://media.test/video.mp4' })).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends remote file_url or bounded binary with documented headers and requires success true', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ success: true }));
    const transport = createFacebookNativeTransport(config, 'token', policy, fetchImpl);
  const uploadUrl = 'https://rupload.facebook.test/video-upload/v99.0/123';
    await transport.upload(uploadUrl, { kind: 'video', url: 'https://media.test/video.mp4', sizeBytes: 3 });
    const remoteHeaders = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(remoteHeaders).toMatchObject({ Authorization: 'OAuth token', file_url: 'https://media.test/video.mp4' });
    const originalBytes = new Uint8Array([1, 2, 3]);
    await transport.upload(uploadUrl, { kind: 'video', bytes: originalBytes, sizeBytes: 3 });
    const binaryCall = fetchImpl.mock.calls[1]![1]!;
    expect(binaryCall.headers).toMatchObject({ Authorization: 'OAuth token', offset: '0', file_size: '3' });
    expect(binaryCall.body).not.toBe(originalBytes);
    expect(binaryCall.body).toEqual(new Uint8Array([1, 2, 3]));
    originalBytes[0] = 9;
    expect(binaryCall.body).toEqual(new Uint8Array([1, 2, 3]));
    await expect(transport.upload(uploadUrl, { kind: 'video', bytes: new Uint8Array(9), sizeBytes: 9 })).rejects.toBeInstanceOf(FacebookApiError);
    fetchImpl.mockResolvedValueOnce(response({ success: false }));
    await expect(transport.upload(uploadUrl, { kind: 'video', url: 'https://media.test/video.mp4', sizeBytes: 3 })).rejects.toBeInstanceOf(FacebookApiError);
  });

  it('requires safe remote metadata, canonical URLs, and an unambiguous media source before dispatch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ success: true }));
    const transport = createFacebookNativeTransport(config, 'token', policy, fetchImpl);
    const uploadUrl = 'https://rupload.facebook.test/video-upload/v99.0/123';
    for (const media of [
      { kind: 'video' as const, url: 'https://media.test/video.mp4' },
      { kind: 'video' as const, url: 'https://media.test/video.mp4', sizeBytes: 0 },
      { kind: 'video' as const, url: 'https://media.test/video.mp4', sizeBytes: 9 },
      { kind: 'video' as const, url: 'https://media.test/video.mp4 ', sizeBytes: 3 },
      { kind: 'video' as const, url: 'https://media.test/video.mp4', bytes: new Uint8Array([1]), sizeBytes: 1 },
      { kind: 'video' as const, bytes: new Uint8Array([1]) },
    ]) await expect(transport.upload(uploadUrl, media)).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('supports an explicit configured Graph base path prefix', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ id: 'ok' }));
    const prefixed = { ...config, graphBaseUrl: 'https://graph.facebook.test/proxy' };
    const transport = createFacebookNativeTransport(prefixed, 'token', policy, fetchImpl);
    await transport.getGraph('123/videos', ['id']);
    expect(new URL(fetchImpl.mock.calls[0]![0] as URL).pathname).toBe('/proxy/v99.0/123/videos');
  });

  it('does not treat a bodyless 204 as confirmed delete success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const transport = createFacebookNativeTransport(config, 'token', policy, fetchImpl);
    await expect(transport.deleteGraph('123')).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds streamed JSON, hides provider bodies, and refuses malformed responses', async () => {
    const oversized = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"data":"' + 'x'.repeat(256))); controller.close(); },
    }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(oversized).mockResolvedValueOnce(response({ error: { message: 'secret-token provider detail', code: 190 } }, 400)).mockResolvedValueOnce(new Response('{bad json'));
    const transport = createFacebookNativeTransport(config, 'secret-token', policy, fetchImpl);
    await expect(transport.getGraph('123', [])).rejects.toMatchObject({ message: 'Facebook request failed.' });
    await expect(transport.getGraph('123', [])).rejects.toMatchObject({ message: 'Facebook request failed.', code: 190 });
    await expect(transport.getGraph('123', [])).rejects.toMatchObject({ message: 'Facebook request failed.' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('enforces the request timeout while a response body is stalled and sanitizes Graph errors on HTTP 200', async () => {
    const shortConfig = { ...config, requestTimeoutMs: 10 };
    const stalled = new Response(new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); } }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(stalled).mockResolvedValueOnce(response({ error: { message: 'token leaked', code: 190 } }));
    const transport = createFacebookNativeTransport(shortConfig, 'secret-token', policy, fetchImpl);
    await expect(transport.getGraph('123', [])).rejects.toMatchObject({ message: 'Facebook request failed.', status: 0 });
    await expect(transport.getGraph('123', [])).rejects.toMatchObject({ message: 'Facebook request failed.', status: 200, code: 190 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('copies the policy at construction so later caller mutation cannot widen upload access', async () => {
    const origins = ['https://rupload.facebook.test'];
    const mutablePolicy = { uploadOrigins: origins, maxUploadBytes: 8, maxResponseBytes: 128 };
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ success: true }));
    const transport = createFacebookNativeTransport(config, 'token', mutablePolicy, fetchImpl);
    origins[0] = 'https://evil.test';
    mutablePolicy.maxUploadBytes = 500;
    await expect(transport.upload('https://evil.test/video-upload/v99.0/123', { kind: 'video', url: 'https://media.test/v.mp4', sizeBytes: 1 })).rejects.toBeInstanceOf(FacebookApiError);
    await expect(transport.upload('https://rupload.facebook.test/video-upload/v99.0/123', { kind: 'video', bytes: new Uint8Array(9), sizeBytes: 9 })).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honors abort and redirect errors without leaking details or retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('secret-token redirect target'); });
    const transport = createFacebookNativeTransport(config, 'secret-token', policy, fetchImpl);
    await expect(transport.getGraph('123', [])).rejects.toMatchObject({ message: 'Facebook request failed.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]!.redirect).toBe('error');
    const controller = new AbortController(); controller.abort();
    const aborted = createFacebookNativeTransport(config, 'secret-token', policy, fetchImpl, controller.signal);
    await expect(aborted.deleteGraph('123')).rejects.toBeInstanceOf(FacebookApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects access tokens containing whitespace or control characters', () => {
    expect(() => createFacebookNativeTransport(config, 'token with-space', policy)).toThrow('Facebook access token is invalid.');
    expect(() => createFacebookNativeTransport(config, 'token\nvalue', policy)).toThrow('Facebook access token is invalid.');
  });
});

 it('holds a native attempt after an ambiguous upload error and never repeats its remote writes',async()=>{
   const fetchImpl=vi.fn<typeof fetch>().mockResolvedValueOnce(response({video_id:'123',upload_url:'https://rupload.facebook.test/video-upload/v99.0/123'})).mockRejectedValueOnce(new Error('uncertain network outcome'));
   const transport=createFacebookNativeTransport(config,'token',policy,fetchImpl);
   const plan=planFacebookNative({targetId:'page1',targetKind:'page',format:'reel',media:[{kind:'video',url:'https://media.test/video.mp4',sizeBytes:4,durationSeconds:30,width:540,height:960}]});
   const deps={transport,attempts:createMemoryAttemptStore()};
   expect(await executeFacebookNative(plan,'synthetic-native-operation',deps)).toMatchObject({status:'uncertain',phase:'upload_transfer',knownIds:['123']});
   expect(await executeFacebookNative(plan,'synthetic-native-operation',deps)).toMatchObject({status:'already_attempted',previous:{state:'uncertain'}});
   expect(fetchImpl).toHaveBeenCalledTimes(2);
 });
