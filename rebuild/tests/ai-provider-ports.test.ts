import { describe, expect, it } from 'vitest';
import { openaiPort } from '@/modules/studio/server/openai';
import { geminiPort } from '@/modules/studio/server/gemini';

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
    for (const make of [openaiPort, geminiPort]) {
      const port = make({ apiKey: 'k', endpoint: 'https://x.example.test/', fetchImpl: (async () => json(401, { error: { message: 'secret provider detail' } })) as typeof fetch });
      await expect(port.complete({ ...call, signal: new AbortController().signal })).rejects.toThrow(/could not complete this request/);
    }
  });
});
