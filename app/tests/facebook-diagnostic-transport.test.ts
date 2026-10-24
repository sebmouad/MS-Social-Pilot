import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('../src/server/config/store', () => ({
  runtimeSecret: async (key: string) => key === 'meta.appSecret' ? 'synthetic-app-secret' : null,
  runtimeConfig: async (key: string) => state.values.get(key),
  runtimeConfigBatch: async (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, state.values.get(key)])),
}));
import { configuredFacebookEngine } from '../src/platforms/facebook/runtime';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
const setup = () => { for (const [key, entry] of CONFIG_BY_KEY) state.values.set(key, entry.defaultValue); };
afterEach(() => { state.values.clear(); vi.unstubAllGlobals(); });
describe('Facebook diagnostic request cancellation', () => {
  it('propagates suite cancellation alongside the adapter request timeout without following redirects', async () => {
    setup();
    const controller = new AbortController();
    let requestSignal!: AbortSignal;
    let options: RequestInit | undefined;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      options = init; requestSignal = init!.signal!;
      return new Promise<Response>((_resolve, reject) => requestSignal.addEventListener('abort', () => reject(new Error('private-abort-reason')), { once: true }));
    });
    vi.stubGlobal('fetch', fetch);
    const engine = await configuredFacebookEngine({ signal: controller.signal });
    const pending = engine.getCurrentUser('synthetic-credential');
    const expected = expect(pending).rejects.toMatchObject({ name: 'FacebookApiError', status: 0 });
    controller.abort(); await expected;
    expect(requestSignal.aborted).toBe(true); expect(options?.redirect).toBe('error');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
