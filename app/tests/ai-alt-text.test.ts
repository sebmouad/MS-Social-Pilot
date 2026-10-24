import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: vi.fn(), image: vi.fn(), overrides: {} as Record<string, unknown>, exec: [] as string[] }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { AI_CONFIG } = await import('../src/modules/studio/config');
  const defaults = { ...Object.fromEntries(AI_CONFIG.map(e => [e.key, e.defaultValue])), 'ai.enabled': true, 'ai.model': 'test-model', 'data.workspaceOperationTimeoutMs': 30000, 'publishing.maxImageAltCharacters': 500 };
  return { runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, state.overrides[key] ?? (defaults as Record<string, unknown>)[key]])), runtimeSecret: async () => 'sk' };
});
vi.mock('@/modules/studio/server/access', () => ({ authorizeAi: state.auth }));
vi.mock('@/modules/publishing/server/media/storage', () => ({ readWorkspaceImage: state.image }));

import { suggestAltText } from '../src/modules/studio/server/alt-text';
import { aiStatus } from '../src/modules/studio/server/ai';
import { anthropicPort } from '../src/modules/studio/server/anthropic';
import { openaiPort } from '../src/modules/studio/server/openai';
import { geminiPort } from '../src/modules/studio/server/gemini';
import { llamaPort } from '../src/modules/studio/server/llama';
import { aiToolDefinitions, aiWriteTools, executeAiTool } from '../src/modules/studio/mcp';
import { altTextPolicySchema, ALT_TEXT_POLICY_DEFAULT } from '../src/modules/studio/config';

const actor = { userId: 'u1', workspaceId: 'w1' };
const id = '8b2b6a54-5f43-4d6c-9d7e-3f0a1c2b4d5e';
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const port = (text = '  A red bicycle leaning on a wall.  ') => ({ complete: vi.fn(async (_input: { image?: { mimeType: string; base64: string }; prompt: string }) => text) });

beforeEach(() => {
  vi.clearAllMocks(); state.overrides = {};
  state.auth.mockResolvedValue({ role: 'editor', allowedTargetIds: undefined });
  state.image.mockResolvedValue({ mimeType: 'image/png', bytes: png });
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray) => {
    const sql = s.join('?');
    if (sql.includes('"aiEnabled"')) return [{ aiEnabled: true, aiTone: null, aiBrandVoice: null, aiAvoidWords: null }];
    if (sql.includes('memberships m JOIN users')) return [{ role: 'editor', disabledAt: null, suspendedAt: null }];
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    return [{ ok: true }];
  });
  db.$executeRaw.mockResolvedValue(1);
});

describe('AI alt-text suggestion (G5)', () => {
  it('sends the stored image bytes to the provider, bounds the answer and saves nothing', async () => {
    const p = port();
    expect(await suggestAltText(actor, { imageId: id, language: 'French' }, { port: p })).toEqual({ text: 'A red bicycle leaning on a wall.' });
    const call = p.complete.mock.calls[0]![0];
    expect(call.image).toEqual({ mimeType: 'image/png', base64: png.toString('base64') });
    expect(call.prompt).toContain('French');
    expect(call.prompt).toContain('500');
    expect(state.image).toHaveBeenCalledWith('w1', id);
  });

  it('requires write access, a valid stored image id and the Root switch before any provider call', async () => {
    const p = port();
    await expect(suggestAltText(actor, { imageId: 'https://evil.example/x.png' }, { port: p })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(suggestAltText(actor, { imageId: id, extra: 1 }, { port: p })).rejects.toMatchObject({ code: 'invalid_request' });
    state.auth.mockRejectedValue(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(suggestAltText(actor, { imageId: id }, { port: p })).rejects.toBeTruthy();
    state.auth.mockResolvedValue({});
    state.overrides['ai.altTextPolicy'] = { ...ALT_TEXT_POLICY_DEFAULT, enabled: false };
    await expect(suggestAltText(actor, { imageId: id }, { port: p })).rejects.toMatchObject({ code: 'unavailable' });
    expect(p.complete).not.toHaveBeenCalled();
  });

  it('refuses an image another workspace owns (tenant-bound read fails) and oversize images', async () => {
    const p = port();
    state.image.mockRejectedValue(new Error('missing'));
    await expect(suggestAltText(actor, { imageId: id }, { port: p })).rejects.toMatchObject({ code: 'not_found' });
    state.image.mockResolvedValue({ mimeType: 'image/png', bytes: Buffer.alloc(ALT_TEXT_POLICY_DEFAULT.maxImageBytes + 1) });
    await expect(suggestAltText(actor, { imageId: id }, { port: p })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(p.complete).not.toHaveBeenCalled();
  });

  it('is reported by status and the MCP tool shares the service as a write tool', async () => {
    expect(await aiStatus(actor, { port: port() })).toMatchObject({ available: true, altText: true });
    state.overrides['ai.altTextPolicy'] = { ...ALT_TEXT_POLICY_DEFAULT, enabled: false };
    expect((await aiStatus(actor, { port: port() })).altText).toBe(false);
    state.overrides = {};
    expect(aiToolDefinitions.some(tool => tool.name === 'suggest_image_alt_text')).toBe(true);
    expect(aiWriteTools.has('suggest_image_alt_text')).toBe(true);
    const p = port('A dog');
    expect(await executeAiTool(actor, 'suggest_image_alt_text', { imageId: id }, { port: p })).toEqual({ text: 'A dog' });
  });

  it('validates the policy placeholders', () => {
    expect(altTextPolicySchema.safeParse(ALT_TEXT_POLICY_DEFAULT).success).toBe(true);
    expect(altTextPolicySchema.safeParse({ ...ALT_TEXT_POLICY_DEFAULT, instruction: 'Describe this image please, thoroughly.' }).success).toBe(false);
  });
});

describe('vision input in every provider adapter', () => {
  const call = { system: 'sys', prompt: 'describe', model: 'm', maxTokens: 50, signal: new AbortController().signal, image: { mimeType: 'image/png', base64: 'QUJD' } };
  const capture = (answer: unknown) => { const seen: { body?: Record<string, unknown> } = {}; return { seen, fetchImpl: (async (_url: string, init: RequestInit) => { seen.body = JSON.parse(String(init.body)); return new Response(JSON.stringify(answer), { status: 200 }); }) as unknown as typeof fetch }; };

  it('Anthropic sends a base64 image block before the text', async () => {
    const { seen, fetchImpl } = capture({ content: [{ type: 'text', text: 'ok' }] });
    await anthropicPort({ apiKey: 'k', endpoint: 'https://a.example/', fetchImpl }).complete(call);
    expect((seen.body!.messages as Array<{ content: unknown[] }>)[0]!.content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
  });
  it('OpenAI sends an image_url data URL', async () => {
    const { seen, fetchImpl } = capture({ choices: [{ message: { content: 'ok' } }] });
    await openaiPort({ apiKey: 'k', endpoint: 'https://o.example/', fetchImpl }).complete(call);
    expect(JSON.stringify(seen.body)).toContain('data:image/png;base64,QUJD');
  });
  it('Gemini sends inlineData', async () => {
    const { seen, fetchImpl } = capture({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    await geminiPort({ apiKey: 'k', endpoint: 'https://g.example/', fetchImpl }).complete(call);
    expect(JSON.stringify(seen.body)).toContain('"inlineData":{"mimeType":"image/png","data":"QUJD"}');
  });
  it('Llama sends an image_url data URL', async () => {
    const { seen, fetchImpl } = capture({ choices: [{ message: { content: 'ok' } }] });
    await llamaPort({ apiKey: 'k', endpoint: 'https://l.example/', fetchImpl }).complete(call);
    expect(JSON.stringify(seen.body)).toContain('data:image/png;base64,QUJD');
  });
  it('text-only calls keep the plain string content', async () => {
    const { seen, fetchImpl } = capture({ choices: [{ message: { content: 'ok' } }] });
    await openaiPort({ apiKey: 'k', endpoint: 'https://o.example/', fetchImpl }).complete({ ...call, image: undefined });
    expect((seen.body!.messages as Array<{ content: unknown }>)[1]!.content).toBe('describe');
  });
});
