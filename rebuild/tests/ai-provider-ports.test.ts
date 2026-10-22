import { describe, expect, it } from 'vitest';
import { openaiPort } from '@/modules/studio/server/openai';
import { geminiPort } from '@/modules/studio/server/gemini';
import { llamaPort } from '@/modules/studio/server/llama';

const call = { system: 'sys', prompt: 'hello', model: 'm-1', maxTokens: 50 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('AI provider ports', () => {
  it('OpenAI sends bearer auth and returns the first choice', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const port = openaiPort({ apiKey: 'k1', endpoint: 'https://api.example.test/v1/chat/completions', fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return json(200, { choices: [{ message: { content: 'hi there' } }] }); }) as typeof fetch });
    expect(await port.complete({ ...call, signal: new AbortController().signal })).toBe('hi there');
    expect(seen?.url).toBe('https://api.example.test/v1/chat/completions');
    expect((seen?.init.headers as Record<string, string>).authorization).toBe('Bearer k1');
    expect(JSON.parse(String(seen?.init.body))).toMatchObject({ model: 'm-1', max_completion_tokens: 50, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }] });
  });

  it('Gemini appends the model to the Root endpoint and joins text parts', async () => {
    let url = '';
    const port = geminiPort({ apiKey: 'k2', endpoint: 'https://gl.example.test/v1beta/models/', fetchImpl: (async (u: string) => { url = u; return json(200, { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }); }) as typeof fetch });
    expect(await port.complete({ ...call, signal: new AbortController().signal })).toBe('ab');
    expect(url).toBe('https://gl.example.test/v1beta/models/m-1:generateContent');
  });

  it('never exposes provider error text', async () => {
    for (const make of [openaiPort, geminiPort, llamaPort]) {
      const port = make({ apiKey: 'k', endpoint: 'https://x.example.test/', fetchImpl: (async () => json(401, { error: { message: 'secret provider detail' } })) as typeof fetch });
      await expect(port.complete({ ...call, signal: new AbortController().signal })).rejects.toThrow(/could not complete this request/);
    }
  });
});

describe('Llama adapter', () => {
  const endpoint = 'https://api.meta.ai/v1/chat/completions';
  it('sends Bearer k3 and returns the first choice', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const port = llamaPort({ apiKey: 'k3', endpoint, fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return json(200, { choices: [{ message: { content: 'hello back' } }] }); }) as typeof fetch });
    expect(await port.complete({ ...call, signal: new AbortController().signal })).toBe('hello back');
    expect(seen?.url).toBe(endpoint);
    expect((seen?.init.headers as Record<string, string>).authorization).toBe('Bearer k3');
    expect(seen?.init.redirect).toBe('error');
    expect(String(seen?.init.body)).not.toContain('k3');
    expect(JSON.parse(String(seen?.init.body))).toMatchObject({ model: 'm-1', max_completion_tokens: 50, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }] });
  });

  it('sends vision input as an image_url data URL', async () => {
    let body = '';
    const port = llamaPort({ apiKey: 'k3', endpoint, fetchImpl: (async (_u: string, init: RequestInit) => { body = String(init.body); return json(200, { choices: [{ message: { content: 'a cat' } }] }); }) as typeof fetch });
    expect(await port.complete({ ...call, signal: new AbortController().signal, image: { mimeType: 'image/png', base64: 'aGk=' } })).toBe('a cat');
    expect(JSON.parse(body).messages[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }] });
  });

  it('maps non-ok, unreadable, empty and aborted answers to safe messages', async () => {
    const signal = new AbortController().signal;
    const nonOk = llamaPort({ apiKey: 'k', endpoint, fetchImpl: (async () => json(429, { error: { message: 'quota hit for k' } })) as typeof fetch });
    const nonOkError = await nonOk.complete({ ...call, signal }).catch(e => e);
    expect(nonOkError).toMatchObject({ code: 'upstream_failure' });
    expect(nonOkError.message).not.toMatch(/quota|k/);
    const unreadable = llamaPort({ apiKey: 'k', endpoint, fetchImpl: (async () => new Response('not json{', { status: 200 })) as typeof fetch });
    await expect(unreadable.complete({ ...call, signal })).rejects.toThrow(/unreadable answer/);
    for (const body of [{ choices: [{ message: { content: '   ' } }] }, { choices: [] }, {}]) {
      const empty = llamaPort({ apiKey: 'k', endpoint, fetchImpl: (async () => json(200, body)) as typeof fetch });
      await expect(empty.complete({ ...call, signal })).rejects.toThrow(/empty answer/);
    }
  });

  it('reports a timeout when the request is aborted', async () => {
    const controller = new AbortController();
    const port = llamaPort({
      apiKey: 'k', endpoint,
      fetchImpl: (async (_u: string, init: RequestInit) => { controller.abort(); init.signal?.throwIfAborted(); return json(200, {}); }) as typeof fetch,
    });
    await expect(port.complete({ ...call, signal: controller.signal })).rejects.toThrow(/took too long/);
  });
});
