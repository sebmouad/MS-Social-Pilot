import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/config/store', async () => {
  const { CONFIG_BY_KEY } = await import('../src/lib/config/registry');
  return { runtimeSecret: async () => null, runtimeConfig: async (key: string) => CONFIG_BY_KEY.get(key)!.defaultValue };
});
import { configuredFacebookEngine } from '../src/platforms/facebook/runtime';
afterEach(() => vi.unstubAllGlobals());
describe('Facebook diagnostic request cancellation', () => {
  it('propagates suite cancellation alongside the adapter request timeout without following redirects', async () => {
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
