import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const anthropicList = vi.fn();
const anthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    models = { list: anthropicList };
    messages = { create: anthropicCreate };
  },
}));

const config = {
  aiProvider: 'auto',
  anthropicApiKey: null as string | null,
  openaiApiKey: null as string | null,
  geminiApiKey: null as string | null,
  aiModel: '',
};
vi.mock('@/lib/env', () => ({ env: new Proxy({}, { get: (_t, key: string) => config[key as keyof typeof config] }) }));

const { listAiModels, resolveAiModel, clearAiModelCache } = await import('@/lib/ai-models');
const { activeAiProvider, generateWith } = await import('@/lib/ai-providers');

function anthropicPage(ids: string[]) {
  return (async function* () {
    for (const id of ids) yield { id, display_name: id.toUpperCase(), created_at: '2026-01-01T00:00:00Z' };
  })();
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  clearAiModelCache();
  anthropicList.mockReset();
  anthropicCreate.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(config, { aiProvider: 'auto', anthropicApiKey: null, openaiApiKey: null, geminiApiKey: null, aiModel: '' });
});
afterEach(() => vi.unstubAllGlobals());

describe('choosing the provider', () => {
  it('automatic takes the first provider with a key; nothing without keys', () => {
    expect(activeAiProvider()).toBeNull();
    config.geminiApiKey = 'g';
    expect(activeAiProvider()).toBe('gemini');
    config.openaiApiKey = 'o';
    expect(activeAiProvider()).toBe('openai');
    config.anthropicApiKey = 'a';
    expect(activeAiProvider()).toBe('anthropic');
  });

  it('an explicit choice without its key is not available', () => {
    config.aiProvider = 'openai';
    config.anthropicApiKey = 'a';
    expect(activeAiProvider()).toBeNull();
  });
});

describe('models fetched from the provider, never from the code', () => {
  it('Anthropic: in the order the provider lists them', async () => {
    config.anthropicApiKey = 'a';
    anthropicList.mockReturnValue(anthropicPage(['model-new', 'model-old']));
    expect((await listAiModels()).map((m) => m.id)).toEqual(['model-new', 'model-old']);
  });

  it('OpenAI: chat models only, newest first', async () => {
    config.openaiApiKey = 'o';
    fetchMock.mockResolvedValue(
      respond({
        data: [
          { id: 'gpt-old', created: 100 },
          { id: 'text-embedding-x', created: 300 },
          { id: 'gpt-new', created: 200 },
          { id: 'whisper-1', created: 400 },
          { id: 'gpt-x-tts', created: 500 },
        ],
      }),
    );
    expect((await listAiModels()).map((m) => m.id)).toEqual(['gpt-new', 'gpt-old']);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer o');
  });

  it('Gemini: only models that generate content, across pages', async () => {
    config.geminiApiKey = 'g';
    fetchMock
      .mockResolvedValueOnce(
        respond({
          models: [
            { name: 'models/gem-a', displayName: 'Gem A', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
          ],
          nextPageToken: 'p2',
        }),
      )
      .mockResolvedValueOnce(respond({ models: [{ name: 'models/gem-b', supportedGenerationMethods: ['generateContent'] }] }));
    expect((await listAiModels()).map((m) => m.id)).toEqual(['gem-a', 'gem-b']);
  });

  it('caches the list until a refresh is asked for', async () => {
    config.anthropicApiKey = 'a';
    anthropicList.mockReturnValueOnce(anthropicPage(['a1'])).mockReturnValueOnce(anthropicPage(['b1']));
    await listAiModels();
    expect((await listAiModels()).map((m) => m.id)).toEqual(['a1']);
    expect((await listAiModels({ refresh: true })).map((m) => m.id)).toEqual(['b1']);
  });

  it('uses the chosen model while offered, else the first listed', async () => {
    config.anthropicApiKey = 'a';
    anthropicList.mockReturnValue(anthropicPage(['first', 'chosen']));
    config.aiModel = 'chosen';
    expect(await resolveAiModel()).toBe('chosen');
    clearAiModelCache();
    anthropicList.mockReturnValue(anthropicPage(['first']));
    config.aiModel = 'another-providers-model';
    expect(await resolveAiModel()).toBe('first');
  });

  it('reports a rejected key with its status', async () => {
    config.openaiApiKey = 'bad';
    fetchMock.mockResolvedValue(respond({ error: { message: 'Incorrect API key' } }, 401));
    await expect(listAiModels()).rejects.toMatchObject({ status: 401, message: 'Incorrect API key' });
  });
});

describe('generating text', () => {
  const request = { model: 'm', system: 'sys', prompt: 'hi', maxTokens: 50 };

  it('OpenAI: system + user messages, token counts from usage', async () => {
    fetchMock.mockResolvedValue(respond({ choices: [{ message: { content: ' Hello ' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
    expect(await generateWith('openai', 'o', request)).toEqual({ text: 'Hello', inputTokens: 7, outputTokens: 3 });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(sent.max_completion_tokens).toBe(50);
  });

  it('Gemini: system instruction, text joined from parts', async () => {
    fetchMock.mockResolvedValue(
      respond({ candidates: [{ content: { parts: [{ text: 'Bon' }, { text: 'jour' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }),
    );
    expect(await generateWith('gemini', 'g', request)).toEqual({ text: 'Bonjour', inputTokens: 5, outputTokens: 2 });
    expect(fetchMock.mock.calls[0]![0]).toContain('/models/m:generateContent');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
  });

  it('Anthropic: text blocks and usage', async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Hey' }], usage: { input_tokens: 4, output_tokens: 1 } });
    expect(await generateWith('anthropic', 'a', request)).toEqual({ text: 'Hey', inputTokens: 4, outputTokens: 1 });
  });
});
