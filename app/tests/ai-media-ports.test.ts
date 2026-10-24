import { describe, expect, it, vi } from 'vitest';
import { openaiImagePort, openaiVoicePort } from '../src/modules/studio/content-tools/server/media-openai';
import { geminiVideoPort } from '../src/modules/studio/content-tools/server/media-gemini';
import { readBounded } from '../src/modules/studio/content-tools/server/media-ports';

const signal = new AbortController().signal;
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const base = { apiKey: 'sk-test', endpoint: 'https://api.example.com/v1/images', modelsEndpoint: 'https://api.example.com/v1/models', maxBytes: 1000 };

describe('OpenAI image and voice adapters', () => {
  it('lists models with the bearer key and never follows redirects', async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ id: 'gpt-image-1', created: 7 }, { id: 3 }] }));
    expect(await openaiImagePort({ ...base, fetchImpl: fetchImpl as never }).listModels(signal)).toEqual([{ id: 'gpt-image-1', created: 7 }]);
    expect(fetchImpl).toHaveBeenCalledWith(base.modelsEndpoint, expect.objectContaining({ redirect: 'error', headers: { authorization: 'Bearer sk-test' } }));
  });
  it('sends the picture request and accepts only inline picture data within the ceiling', async () => {
    const bytes = Buffer.from('png-bytes');
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({ data: [{ b64_json: bytes.toString('base64') }] }));
    const port = openaiImagePort({ ...base, fetchImpl: fetchImpl as never });
    expect((await port.generate({ model: 'm', prompt: 'a cat', size: '1024x1024', signal })).toString()).toBe('png-bytes');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1].body))).toEqual({ model: 'm', prompt: 'a cat', size: '1024x1024', n: 1 });
    // A provider-supplied address is never fetched.
    const urlOnly = openaiImagePort({ ...base, fetchImpl: (async () => json({ data: [{ url: 'http://169.254.169.254/' }] })) as never });
    await expect(urlOnly.generate({ model: 'm', prompt: 'x', size: '1x1', signal })).rejects.toMatchObject({ code: 'upstream_failure' });
    const big = openaiImagePort({ ...base, maxBytes: 4, fetchImpl: (async () => json({ data: [{ b64_json: bytes.toString('base64') }] })) as never });
    await expect(big.generate({ model: 'm', prompt: 'x', size: '1x1', signal })).rejects.toMatchObject({ code: 'upstream_failure' });
  });
  it('turns transport and provider failures into safe errors without provider text', async () => {
    for (const fetchImpl of [async () => { throw new Error('socket sk-secret'); }, async () => new Response('{"error":{"message":"sk-secret leaked"}}', { status: 401 })]) {
      const error = await openaiVoicePort({ ...base, fetchImpl: fetchImpl as never }).speak({ model: 'm', text: 'hi there', voice: 'nova', format: 'mp3', signal }).catch((e: Error) => e);
      expect(error).toMatchObject({ code: 'upstream_failure' }); expect((error as Error).message).not.toContain('sk-secret');
    }
  });
  it('reads speech audio within the ceiling and refuses oversize audio', async () => {
    const ok = openaiVoicePort({ ...base, fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]))) as never });
    expect((await ok.speak({ model: 'm', text: 'hi there', voice: 'nova', format: 'mp3', signal })).length).toBe(3);
    const big = openaiVoicePort({ ...base, maxBytes: 2, fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]))) as never });
    await expect(big.speak({ model: 'm', text: 'hi there', voice: 'nova', format: 'mp3', signal })).rejects.toMatchObject({ code: 'upstream_failure' });
    await expect(readBounded(new Response(new Uint8Array(10), { headers: { 'content-length': '10' } }), 5)).rejects.toMatchObject({ code: 'upstream_failure' });
  });
});

describe('Gemini video adapter', () => {
  const settings = { apiKey: 'g-key', baseEndpoint: 'https://video.example.com/v1beta' };
  it('lists only models that can run long operations, without the models/ prefix', async () => {
    const fetchImpl = vi.fn(async () => json({ models: [{ name: 'models/veo-3', supportedGenerationMethods: ['predictLongRunning'] }, { name: 'models/gemini', supportedGenerationMethods: ['generateContent'] }] }));
    expect(await geminiVideoPort({ ...settings, fetchImpl: fetchImpl as never }).listModels(signal)).toEqual([{ id: 'veo-3', created: 0 }]);
    expect(fetchImpl).toHaveBeenCalledWith('https://video.example.com/v1beta/models?pageSize=1000', expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'g-key' }) }));
  });
  it('starts an operation and validates the operation name before it is ever used in a path', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({ name: 'operations/abc' }));
    const port = geminiVideoPort({ ...settings, fetchImpl: fetchImpl as never });
    expect(await port.start({ model: 'veo-3', prompt: 'waves', aspectRatio: '16:9', signal })).toBe('operations/abc');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://video.example.com/v1beta/models/veo-3:predictLongRunning');
    await expect(geminiVideoPort({ ...settings, fetchImpl: (async () => json({ name: '../../evil' })) as never }).start({ model: 'm', prompt: 'x', aspectRatio: '16:9', signal })).rejects.toMatchObject({ code: 'upstream_failure' });
    await expect(port.poll('../secrets', signal)).rejects.toMatchObject({ code: 'upstream_failure' });
  });
  it('maps polling states: working, failed, refused and done', async () => {
    const poll = (body: unknown) => geminiVideoPort({ ...settings, fetchImpl: (async () => json(body)) as never }).poll('operations/abc', signal);
    expect(await poll({ done: false })).toEqual({ state: 'working' });
    expect(await poll({ done: true, error: { message: 'secret' } })).toEqual({ state: 'failed' });
    expect(await poll({ done: true, response: { generateVideoResponse: {} } })).toEqual({ state: 'refused' });
    expect(await poll({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://video.example.com/f' } }] } } })).toEqual({ state: 'done', uri: 'https://video.example.com/f' });
  });
  it('downloads only from the provider host over https and within the ceiling', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init: RequestInit) => new Response(new Uint8Array([1, 2, 3])));
    const port = geminiVideoPort({ ...settings, fetchImpl: fetchImpl as never });
    expect((await port.download('https://video.example.com/files/x', 100, signal)).length).toBe(3);
    for (const uri of ['https://evil.example.net/x', 'http://video.example.com/x', 'not a url']) await expect(port.download(uri, 100, signal)).rejects.toMatchObject({ code: 'upstream_failure' });
    await expect(port.download('https://video.example.com/files/x', 2, signal)).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
