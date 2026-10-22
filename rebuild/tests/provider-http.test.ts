import { describe, expect, it, vi } from 'vitest';
import { fetchPublicMedia, isPublicAddress, ProviderHttpError, providerRequest } from '../src/server/platforms/provider-http';

const messages = { unavailable: 'unavailable', permission: 'permission', uncertain: 'uncertain' };
const mediaMessages = { invalid: 'invalid', tooLarge: 'tooLarge', unavailable: 'unavailable' };
const resolve = async () => ['93.184.216.34'];

describe('isPublicAddress', () => {
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('accepts %s', address => expect(isPublicAddress(address)).toBe(true));
  it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', 'not-an-address'])('rejects %s', address => expect(isPublicAddress(address)).toBe(false));
  it('treats 172.32.x as public', () => expect(isPublicAddress('172.32.0.1')).toBe(true));
});

describe('providerRequest', () => {
  const run = (response: Response | Error, extra: Partial<Parameters<typeof providerRequest>[0]> = {}) => providerRequest({
    fetch: (async () => { if (response instanceof Error) throw response; return response; }) as unknown as typeof fetch, url: 'https://api.example.test/x', timeoutMs: 1000, messages, ...extra,
  });
  it('returns parsed JSON', async () => expect((await run(new Response('{"a":1}'))).json).toEqual({ a: 1 }));
  it('maps auth failures to the permission message and server failures to a retryable one, without provider text', async () => {
    const denied = await run(new Response('{"error":"leak"}', { status: 401 })).catch(error => error);
    expect(denied).toMatchObject({ message: 'permission', outcome: 'rejected', retryable: false, status: 401 });
    const busy = await run(new Response('boom', { status: 503 })).catch(error => error);
    expect(busy).toMatchObject({ message: 'unavailable', outcome: 'rejected', retryable: true, status: 503 });
    expect((await run(new Response('', { status: 429 })).catch(error => error)).retryable).toBe(true);
  });
  it('treats a lost answer as rejected before commitment and uncertain after', async () => {
    expect(await run(new Error('reset')).catch(error => error)).toMatchObject({ outcome: 'rejected', retryable: true });
    expect(await run(new Error('reset'), { committing: true }).catch(error => error)).toMatchObject({ outcome: 'uncertain', retryable: false });
  });
  it('requires a JSON body unless empty answers are allowed', async () => {
    expect(await run(new Response('')).catch(error => error)).toBeInstanceOf(ProviderHttpError);
    expect(await run(new Response('not json')).catch(error => error)).toBeInstanceOf(ProviderHttpError);
    expect((await run(new Response(''), { allowEmpty: true })).json).toEqual({});
    expect(await run(new Response(''), { committing: true }).catch(error => error)).toMatchObject({ outcome: 'uncertain' });
  });
  it('never follows redirects and honours an already-aborted signal', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { expect(init?.redirect).toBe('error'); return new Response('{"a":1}'); });
    await providerRequest({ fetch: fetcher as unknown as typeof fetch, url: 'https://api.example.test/x', timeoutMs: 1000, messages });
    const controller = new AbortController(); controller.abort();
    await expect(providerRequest({ fetch: fetcher as unknown as typeof fetch, url: 'https://api.example.test/x', timeoutMs: 1000, messages, signal: controller.signal })).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('fetchPublicMedia', () => {
  const body = (bytes: number[], headers: Record<string, string> = { 'content-type': 'video/mp4' }) => new Response(new Uint8Array(bytes), { status: 200, headers });
  const fetchMedia = (response: Response | (() => Response), extra: Partial<Parameters<typeof fetchPublicMedia>[0]> = {}) => fetchPublicMedia({
    url: 'https://media.example.test/a.mp4', maxBytes: 10, timeoutMs: 1000, messages: mediaMessages, resolve,
    fetch: (async () => (typeof response === 'function' ? response() : response)) as unknown as typeof fetch, ...extra,
  });
  it('returns bytes and the media type', async () => {
    const file = await fetchMedia(body([1, 2, 3]));
    expect([...file.bytes]).toEqual([1, 2, 3]);
    expect(file.mimeType).toBe('video/mp4');
  });
  it.each(['http://media.example.test/a.mp4', 'ftp://media.example.test/a', 'https://user:pass@media.example.test/a', 'not a url'])('refuses %s', async url => {
    await expect(fetchMedia(body([1]), { url })).rejects.toMatchObject({ message: 'invalid' });
  });
  it('refuses hosts that resolve to private addresses or nothing', async () => {
    await expect(fetchMedia(body([1]), { resolve: async () => ['93.184.216.34', '10.0.0.1'] })).rejects.toMatchObject({ message: 'invalid' });
    await expect(fetchMedia(body([1]), { resolve: async () => [] })).rejects.toMatchObject({ message: 'invalid' });
    await expect(fetchMedia(body([1]), { url: 'https://127.0.0.1/a.mp4' })).rejects.toMatchObject({ message: 'invalid' });
    await expect(fetchMedia(body([1]), { url: 'https://[::1]/a.mp4' })).rejects.toMatchObject({ message: 'invalid' });
  });
  it('stops at the size ceiling whether declared or streamed', async () => {
    await expect(fetchMedia(body([1], { 'content-length': '11', 'content-type': 'video/mp4' }))).rejects.toMatchObject({ message: 'tooLarge' });
    await expect(fetchMedia(body(new Array(11).fill(1)))).rejects.toMatchObject({ message: 'tooLarge' });
  });
  it('treats a failed or empty download as unavailable or invalid', async () => {
    await expect(fetchMedia(new Response('', { status: 404 }))).rejects.toMatchObject({ message: 'unavailable', retryable: false });
    await expect(fetchMedia(new Response('', { status: 502 }))).rejects.toMatchObject({ retryable: true });
    await expect(fetchMedia(body([]))).rejects.toMatchObject({ message: 'invalid' });
    await expect(fetchMedia(() => { throw new Error('reset'); })).rejects.toMatchObject({ message: 'unavailable', retryable: true });
  });
});
