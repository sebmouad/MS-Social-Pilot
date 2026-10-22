import { describe, expect, it, vi } from 'vitest';
import { createThreadsAdapter } from '../src/platforms/threads/adapter';
import { THREADS_POLICY_DEFAULTS, THREADS_CONFIG, threadsPolicySchema } from '../src/platforms/threads/config';
import { threadsModule } from '../src/platforms/threads/module';
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => key === 'threads.policy' ? THREADS_POLICY_DEFAULTS : key === 'app.publicOrigin' ? 'https://public.example' : 'test-app'), runtimeSecret: vi.fn(async () => 'test-secret') }));
const credential = { accessToken: 'private-token' };
const target = { id: '123', name: 'example', kind: 'threads' };
function fixture(rows: unknown[]) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(rows.shift()), { status: 200 }));
  return { fetch, adapter: createThreadsAdapter({ ...THREADS_POLICY_DEFAULTS, pollAttempts: 2, pollIntervalMs: 1 }, { fetch, sleep: async () => {} }) };
}
describe('Threads staged provider', () => {
  it('derives callback from trusted Root public origin and ignores untrusted forwarded hosts', async () => {
    const { configuredThreadsOAuth } = await import('../src/platforms/threads/runtime');
    const result = await configuredThreadsOAuth(new Request('http://localhost:3100/start', { headers: { 'x-forwarded-host': 'attacker.example' } }), 'nonce');
    expect(new URL(result.authorizationUrl).searchParams.get('redirect_uri')).toBe('https://public.example/api/connections/threads/callback');
  });
  it('declares installed operations and validates Root settings', () => {
    expect(threadsModule.capabilities.connection).toBe('supported');
    for (const setting of THREADS_CONFIG) expect(setting.schema.safeParse(setting.defaultValue).success).toBe(true);
    expect(threadsPolicySchema.safeParse({ ...THREADS_POLICY_DEFAULTS, graphUrl: 'http://unsafe.test' }).success).toBe(false);
  });
  it('builds authorization with configured scopes and exact state/redirect', () => {
    const { adapter } = fixture([]); const url = new URL(adapter.getAuthorizationUrl({ appId: 'app', redirectUri: 'https://app.test/callback', state: 'random', scopes: [] }));
    expect(url.searchParams.get('state')).toBe('random'); expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/callback'); expect(url.searchParams.get('scope')).toContain('threads_content_publish');
  });
  it('exchanges short for long token and preserves expiry', async () => {
    const { adapter } = fixture([{ access_token: 'short', user_id: 123 }, { access_token: 'long', expires_in: 3600 }]);
    expect(await adapter.exchangeCode({ appId: 'app', appSecret: 'secret', code: 'code', redirectUri: 'https://app.test/callback' })).toMatchObject({ accessToken: 'long', userId: '123', expiresAt: expect.any(Date) });
  });
  it('discovers only the authorized profile', async () => {
    const { adapter, fetch } = fixture([{ id: '123', username: 'example' }]);
    expect(await adapter.discover({ credential })).toEqual({ targets: [target] });
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain('private-token');
  });
  it('publishes text once and returns receipt despite permalink failure', async () => {
    const { adapter, fetch } = fixture([{ id: '1' }, { status: 'FINISHED' }, { id: '2' }, { error: { message: 'private' } }]);
    expect(await adapter.publish({ credential, target, text: 'Hello' })).toEqual({ remoteId: '2', url: null, state: 'published' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('processes carousel children before publishing parent', async () => {
    const { adapter, fetch } = fixture([{ id: '1' }, { status: 'FINISHED' }, { id: '2' }, { status: 'FINISHED' }, { id: '3' }, { status: 'FINISHED' }, { id: '4' }, { permalink: 'https://threads.net/post/4' }]);
    expect((await adapter.publish({ credential, target, text: 'Images', media: [{ kind: 'image', url: 'https://media.test/1' }, { kind: 'video', url: 'https://media.test/2' }] })).remoteId).toBe('4');
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('never truncates content or accepts native schedules', async () => {
    const { adapter, fetch } = fixture([]);
    await expect(adapter.publish({ credential, target, text: 'x'.repeat(501) })).rejects.toMatchObject({ state: 'rejected' });
    await expect(adapter.publish({ credential, target, text: 'x', scheduledAt: new Date() })).rejects.toMatchObject({ state: 'rejected' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unsupported alt text before sending any request', async () => {
    const { adapter, fetch } = fixture([]);
    await expect(adapter.publish({ credential, target, text: 'Photo', media: [{ kind: 'image', url: 'https://media.test/photo', altText: 'A mountain' }] })).rejects.toMatchObject({ state: 'rejected' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('holds processing rather than recreating containers', async () => {
    const { adapter, fetch } = fixture([{ id: '1' }, { status: 'IN_PROGRESS' }, { status: 'IN_PROGRESS' }]);
    await expect(adapter.publish({ credential, target, text: 'x' })).rejects.toMatchObject({ state: 'processing' }); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('classifies lost write responses uncertain and never retries', async () => {
    const fetch = vi.fn(async () => { throw new Error('secret'); }); const adapter = createThreadsAdapter(THREADS_POLICY_DEFAULTS, { fetch });
    try { await adapter.publish({ credential, target, text: 'x' }); } catch (error) { expect(adapter.classifyPublishingFailure(error)).toBe('uncertain'); expect(String(error)).not.toContain('secret'); }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
